/**
 * Main entry point for the coding agent CLI.
 *
 * This file handles CLI argument parsing and translates them into
 * createAgentSession() options. The SDK does the heavy lifting.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createInterface } from "node:readline/promises";
import { type ImageContent, supportsXhigh } from "@oh-my-pi/pi-ai";
import { $env, postmortem } from "@oh-my-pi/pi-utils";
import chalk from "chalk";
import type { Args } from "./cli/args";
import { processFileArguments } from "./cli/file-processor";
import { listModels } from "./cli/list-models";
import { selectSession } from "./cli/session-picker";
import { findConfigFile, VERSION } from "./config";
import { ModelRegistry, ModelsConfigFile } from "./config/model-registry";
import { parseModelPattern, parseModelString, resolveModelScope, type ScopedModel } from "./config/model-resolver";
import { Settings, settings } from "./config/settings";
import { initializeWithSettings } from "./discovery";
import { exportFromFile } from "./export/html";
import type { ExtensionUIContext } from "./extensibility/extensions/types";
import { InteractiveMode, runPrintMode, runRpcMode } from "./modes";
import { initTheme, stopThemeWatcher } from "./modes/theme/theme";
import { type CreateAgentSessionOptions, createAgentSession, discoverAuthStorage } from "./sdk";
import type { AgentSession } from "./session/agent-session";
import { type SessionInfo, SessionManager } from "./session/session-manager";
import { resolvePromptInput } from "./system-prompt";
import { getChangelogPath, getNewEntries, parseChangelog } from "./utils/changelog";
import { printTimings, time } from "./utils/timings";

/** Conditional startup debug prints (stderr) when PI_DEBUG_STARTUP is set */
const debugStartup = $env.PI_DEBUG_STARTUP ? (stage: string) => process.stderr.write(`[startup] ${stage}\n`) : () => {};

async function checkForNewVersion(currentVersion: string): Promise<string | undefined> {
	try {
		const response = await fetch("https://registry.npmjs.org/@oh-my-pi/pi-coding-agent/latest");
		if (!response.ok) return undefined;

		const data = (await response.json()) as { version?: string };
		const latestVersion = data.version;

		if (latestVersion && latestVersion !== currentVersion) {
			return latestVersion;
		}

		return undefined;
	} catch {
		return undefined;
	}
}

const writeStdout = (message: string): void => {
	process.stdout.write(`${message}\n`);
};

const writeStderr = (message: string): void => {
	process.stderr.write(`${message}\n`);
};

async function readPipedInput(): Promise<string | undefined> {
	if (process.stdin.isTTY !== false) return undefined;
	try {
		const text = await Bun.stdin.text();
		if (text.trim().length === 0) return undefined;
		return text;
	} catch {
		return undefined;
	}
}

export interface InteractiveModeNotify {
	kind: "warn" | "error" | "info";
	message: string;
}

async function runInteractiveMode(
	session: AgentSession,
	version: string,
	changelogMarkdown: string | undefined,
	notifs: (InteractiveModeNotify | null)[],
	versionCheckPromise: Promise<string | undefined>,
	initialMessages: string[],
	setExtensionUIContext: (uiContext: ExtensionUIContext, hasUI: boolean) => void,
	lspServers: Array<{ name: string; status: "ready" | "error"; fileTypes: string[]; error?: string }> | undefined,
	mcpManager: import("./mcp").MCPManager | undefined,
	initialMessage?: string,
	initialImages?: ImageContent[],
): Promise<void> {
	const mode = new InteractiveMode(session, version, changelogMarkdown, setExtensionUIContext, lspServers, mcpManager);

	await mode.init();

	versionCheckPromise
		.then(newVersion => {
			if (newVersion) {
				mode.showNewVersionNotification(newVersion);
			}
		})
		.catch(() => {});

	mode.renderInitialMessages();

	for (const notify of notifs) {
		if (!notify) {
			continue;
		}
		if (notify.kind === "warn") {
			mode.showWarning(notify.message);
		} else if (notify.kind === "error") {
			mode.showError(notify.message);
		} else if (notify.kind === "info") {
			mode.showStatus(notify.message);
		}
	}

	if (initialMessage) {
		try {
			await session.prompt(initialMessage, { images: initialImages });
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
			mode.showError(errorMessage);
		}
	}

	for (const message of initialMessages) {
		try {
			await session.prompt(message);
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
			mode.showError(errorMessage);
		}
	}

	while (true) {
		const { text, images } = await mode.getUserInput();
		try {
			await session.prompt(text, { images });
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
			mode.showError(errorMessage);
		}
	}
}

async function prepareInitialMessage(
	parsed: Args,
	autoResizeImages: boolean,
): Promise<{
	initialMessage?: string;
	initialImages?: ImageContent[];
}> {
	if (parsed.fileArgs.length === 0) {
		return {};
	}

	const { text, images } = await processFileArguments(parsed.fileArgs, { autoResizeImages });

	let initialMessage: string;
	if (parsed.messages.length > 0) {
		initialMessage = text + parsed.messages[0];
		parsed.messages.shift();
	} else {
		initialMessage = text;
	}

	return {
		initialMessage,
		initialImages: images.length > 0 ? images : undefined,
	};
}

/**
 * Resolve a session argument to a local or global session match.
 */
async function resolveSessionMatch(
	sessionArg: string,
	cwd: string,
	sessionDir?: string,
): Promise<SessionInfo | undefined> {
	const sessions = await SessionManager.list(cwd, sessionDir);
	let matches = sessions.filter(session => session.id.startsWith(sessionArg));

	if (matches.length === 0 && !sessionDir) {
		const globalSessions = await SessionManager.listAll();
		matches = globalSessions.filter(session => session.id.startsWith(sessionArg));
	}

	return matches[0];
}

async function promptForkSession(session: SessionInfo): Promise<boolean> {
	if (!process.stdin.isTTY) {
		return false;
	}
	const message = `Session found in different project: ${session.cwd}. Fork into current directory? [y/N] `;
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const answer = (await rl.question(message)).trim().toLowerCase();
		return answer === "y" || answer === "yes";
	} finally {
		rl.close();
	}
}

async function getChangelogForDisplay(parsed: Args): Promise<string | undefined> {
	if (parsed.continue || parsed.resume) {
		return undefined;
	}

	const lastVersion = settings.get("lastChangelogVersion");
	const changelogPath = getChangelogPath();
	const entries = await parseChangelog(changelogPath);

	if (!lastVersion) {
		if (entries.length > 0) {
			settings.set("lastChangelogVersion", VERSION);
			return entries.map(e => e.content).join("\n\n");
		}
	} else {
		const newEntries = getNewEntries(entries, lastVersion);
		if (newEntries.length > 0) {
			settings.set("lastChangelogVersion", VERSION);
			return newEntries.map(e => e.content).join("\n\n");
		}
	}

	return undefined;
}

async function createSessionManager(parsed: Args, cwd: string): Promise<SessionManager | undefined> {
	if (parsed.noSession) {
		return SessionManager.inMemory();
	}
	if (typeof parsed.resume === "string") {
		const sessionArg = parsed.resume;
		if (sessionArg.includes("/") || sessionArg.includes("\\") || sessionArg.endsWith(".jsonl")) {
			return await SessionManager.open(sessionArg, parsed.sessionDir);
		}
		const match = await resolveSessionMatch(sessionArg, cwd, parsed.sessionDir);
		if (!match) {
			throw new Error(`Session "${sessionArg}" not found.`);
		}
		const normalizedCwd = path.resolve(cwd);
		const normalizedMatchCwd = path.resolve(match.cwd || cwd);
		if (normalizedCwd !== normalizedMatchCwd) {
			const shouldFork = await promptForkSession(match);
			if (!shouldFork) {
				throw new Error(`Session "${sessionArg}" is in another project (${match.cwd}).`);
			}
			return await SessionManager.forkFrom(match.path, cwd, parsed.sessionDir);
		}
		return await SessionManager.open(match.path, parsed.sessionDir);
	}
	if (parsed.continue) {
		return await SessionManager.continueRecent(cwd, parsed.sessionDir);
	}
	// --resume without value is handled separately (needs picker UI)
	// If --session-dir provided without --continue/--resume, create new session there
	if (parsed.sessionDir) {
		return SessionManager.create(cwd, parsed.sessionDir);
	}
	// Default case (new session) returns undefined, SDK will create one
	return undefined;
}

async function maybeAutoChdir(parsed: Args): Promise<void> {
	if (parsed.allowHome || parsed.cwd) {
		return;
	}

	const home = os.homedir();
	if (!home) {
		return;
	}

	const normalizePath = (value: string) => {
		const resolved = path.resolve(value);
		return process.platform === "win32" ? resolved.toLowerCase() : resolved;
	};

	const cwd = normalizePath(process.cwd());
	const normalizedHome = normalizePath(home);
	if (cwd !== normalizedHome) {
		return;
	}

	const isDirectory = async (p: string) => {
		try {
			const s = await fs.stat(p);
			return s.isDirectory();
		} catch {
			return false;
		}
	};

	const candidates = [path.join(home, "tmp"), "/tmp", "/var/tmp"];
	for (const candidate of candidates) {
		try {
			if (!(await isDirectory(candidate))) {
				continue;
			}
			process.chdir(candidate);
			return;
		} catch {
			// Try next candidate.
		}
	}

	try {
		const fallback = os.tmpdir();
		if (fallback && normalizePath(fallback) !== cwd && (await isDirectory(fallback))) {
			process.chdir(fallback);
		}
	} catch {
		// Ignore fallback errors.
	}
}

/** Discover SYSTEM.md file if no CLI system prompt was provided */
function discoverSystemPromptFile(): string | undefined {
	// Check project-local first (.omp/SYSTEM.md, .pi/SYSTEM.md legacy)
	const projectPath = findConfigFile("SYSTEM.md", { user: false });
	if (projectPath) {
		return projectPath;
	}
	// If not found, check SYSTEM.md file in the global directory.
	const globalPath = findConfigFile("SYSTEM.md", { user: true });
	if (globalPath) {
		return globalPath;
	}
	return undefined;
}

/** Discover APPEND_SYSTEM.md file if no CLI append system prompt was provided */
function discoverAppendSystemPromptFile(): string | undefined {
	const projectPath = findConfigFile("APPEND_SYSTEM.md", { user: false });
	if (projectPath) {
		return projectPath;
	}
	const globalPath = findConfigFile("APPEND_SYSTEM.md", { user: true });
	if (globalPath) {
		return globalPath;
	}
	return undefined;
}

async function buildSessionOptions(
	parsed: Args,
	scopedModels: ScopedModel[],
	sessionManager: SessionManager | undefined,
	modelRegistry: ModelRegistry,
): Promise<CreateAgentSessionOptions> {
	const options: CreateAgentSessionOptions = {
		cwd: parsed.cwd ?? process.cwd(),
	};

	// Auto-discover SYSTEM.md if no CLI system prompt provided
	const systemPromptSource = parsed.systemPrompt ?? discoverSystemPromptFile();
	const resolvedSystemPrompt = await resolvePromptInput(systemPromptSource, "system prompt");
	const appendPromptSource = parsed.appendSystemPrompt ?? discoverAppendSystemPromptFile();
	const resolvedAppendPrompt = await resolvePromptInput(appendPromptSource, "append system prompt");

	if (sessionManager) {
		options.sessionManager = sessionManager;
	}

	// Model from CLI (--model) - uses same fuzzy matching as --models
	if (parsed.model) {
		const available = modelRegistry.getAvailable();
		const modelMatchPreferences = {
			usageOrder: settings.getStorage()?.getModelUsageOrder(),
		};
		const { model, warning } = parseModelPattern(parsed.model, available, modelMatchPreferences);
		if (warning) {
			writeStderr(chalk.yellow(`Warning: ${warning}`));
		}
		if (!model) {
			writeStderr(chalk.red(`Model "${parsed.model}" not found`));
			process.exit(1);
		}
		options.model = model;
		settings.overrideModelRoles({ default: `${model.provider}/${model.id}` });
	} else if (scopedModels.length > 0 && !parsed.continue && !parsed.resume) {
		const remembered = settings.getModelRole("default");
		if (remembered) {
			const parsedModel = parseModelString(remembered);
			const rememberedModel = parsedModel
				? scopedModels.find(
						scopedModel =>
							scopedModel.model.provider === parsedModel.provider && scopedModel.model.id === parsedModel.id,
					)
				: scopedModels.find(scopedModel => scopedModel.model.id.toLowerCase() === remembered.toLowerCase());
			if (rememberedModel) {
				options.model = rememberedModel.model;
			}
		}
		if (!options.model) {
			options.model = scopedModels[0].model;
		}
	}

	// Thinking level
	if (parsed.thinking) {
		options.thinkingLevel = parsed.thinking;
	} else if (
		scopedModels.length > 0 &&
		scopedModels[0].explicitThinkingLevel === true &&
		!parsed.continue &&
		!parsed.resume
	) {
		options.thinkingLevel = scopedModels[0].thinkingLevel;
	}

	// Scoped models for Ctrl+P cycling - fill in default thinking levels when not explicit
	if (scopedModels.length > 0) {
		const defaultThinkingLevel = settings.get("defaultThinkingLevel");
		options.scopedModels = scopedModels.map(scopedModel => ({
			model: scopedModel.model,
			thinkingLevel: scopedModel.explicitThinkingLevel
				? (scopedModel.thinkingLevel ?? defaultThinkingLevel)
				: defaultThinkingLevel,
		}));
	}

	// API key from CLI - set in authStorage
	// (handled by caller before createAgentSession)

	// System prompt
	if (resolvedSystemPrompt && resolvedAppendPrompt) {
		options.systemPrompt = `${resolvedSystemPrompt}\n\n${resolvedAppendPrompt}`;
	} else if (resolvedSystemPrompt) {
		options.systemPrompt = resolvedSystemPrompt;
	} else if (resolvedAppendPrompt) {
		options.systemPrompt = defaultPrompt => `${defaultPrompt}\n\n${resolvedAppendPrompt}`;
	}

	// Tools
	if (parsed.noTools) {
		options.toolNames = parsed.tools && parsed.tools.length > 0 ? parsed.tools : [];
	} else if (parsed.tools) {
		options.toolNames = parsed.tools;
	}

	if (parsed.noLsp) {
		options.enableLsp = false;
	}

	// Skills
	if (parsed.noSkills) {
		options.skills = [];
	} else if (parsed.skills && parsed.skills.length > 0) {
		// Override includeSkills for this session
		settings.override("skills.includeSkills", parsed.skills as string[]);
	}

	// Additional extension paths from CLI
	const cliExtensionPaths = parsed.noExtensions ? [] : [...(parsed.extensions ?? []), ...(parsed.hooks ?? [])];
	if (cliExtensionPaths.length > 0) {
		options.additionalExtensionPaths = cliExtensionPaths;
	}

	if (parsed.noExtensions) {
		options.disableExtensionDiscovery = true;
		options.additionalExtensionPaths = [];
	}

	return options;
}

export async function runRootCommand(parsed: Args, rawArgs: string[]): Promise<void> {
	time("start");
	debugStartup("main:entry");

	// Initialize theme early with defaults (CLI commands need symbols)
	// Will be re-initialized with user preferences later
	await initTheme();
	debugStartup("main:initTheme");

	const parsedArgs = parsed;
	debugStartup("main:parseArgs");
	time("parseArgs");
	await maybeAutoChdir(parsedArgs);

	const notifs: (InteractiveModeNotify | null)[] = [];

	// Create AuthStorage and ModelRegistry upfront
	const authStorage = await discoverAuthStorage();
	const modelRegistry = new ModelRegistry(authStorage);
	await modelRegistry.refresh();
	debugStartup("main:discoverModels");
	time("discoverModels");

	if (parsedArgs.version) {
		writeStdout(VERSION);
		process.exit(0);
	}

	if (parsedArgs.listModels !== undefined) {
		const searchPattern = typeof parsedArgs.listModels === "string" ? parsedArgs.listModels : undefined;
		await listModels(modelRegistry, searchPattern);
		process.exit(0);
	}

	if (parsedArgs.export) {
		let result: string;
		try {
			const outputPath = parsedArgs.messages.length > 0 ? parsedArgs.messages[0] : undefined;
			result = await exportFromFile(parsedArgs.export, outputPath);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Failed to export session";
			writeStderr(chalk.red(`Error: ${message}`));
			process.exit(1);
		}
		writeStdout(`Exported to: ${result}`);
		process.exit(0);
	}

	if (parsedArgs.mode === "rpc" && parsedArgs.fileArgs.length > 0) {
		writeStderr(chalk.red("Error: @file arguments are not supported in RPC mode"));
		process.exit(1);
	}

	const cwd = process.cwd();
	await Settings.init({ cwd });
	debugStartup("main:Settings.init");
	time("Settings.init");
	if (parsedArgs.noPty) {
		settings.override("bash.virtualTerminal", "off");
		Bun.env.PI_NO_PTY = "1";
	}
	const pipedInput = await readPipedInput();
	let { initialMessage, initialImages } = await prepareInitialMessage(parsedArgs, settings.get("images.autoResize"));
	if (pipedInput) {
		initialMessage = initialMessage ? `${initialMessage}\n${pipedInput}` : pipedInput;
	}
	time("prepareInitialMessage");
	const autoPrint = pipedInput !== undefined && !parsedArgs.print && parsedArgs.mode === undefined;
	const isInteractive = !parsedArgs.print && !autoPrint && parsedArgs.mode === undefined;
	const mode = parsedArgs.mode || "text";

	// Initialize discovery system with settings for provider persistence
	initializeWithSettings(settings);
	time("initializeWithSettings");

	// Apply model role overrides from CLI args or env vars (ephemeral, not persisted)
	const smolModel = parsedArgs.smol ?? $env.PI_SMOL_MODEL;
	const slowModel = parsedArgs.slow ?? $env.PI_SLOW_MODEL;
	const planModel = parsedArgs.plan ?? $env.PI_PLAN_MODEL;
	if (smolModel || slowModel || planModel) {
		settings.overrideModelRoles({
			smol: smolModel,
			slow: slowModel,
			plan: planModel,
		});
	}

	await initTheme(settings.get("theme"), isInteractive, settings.get("symbolPreset"), settings.get("colorBlindMode"));
	debugStartup("main:initTheme2");
	time("initTheme");

	let scopedModels: ScopedModel[] = [];
	const modelPatterns = parsedArgs.models ?? settings.get("enabledModels");
	const modelMatchPreferences = {
		usageOrder: settings.getStorage()?.getModelUsageOrder(),
	};
	if (modelPatterns && modelPatterns.length > 0) {
		scopedModels = await resolveModelScope(modelPatterns, modelRegistry, modelMatchPreferences);
		time("resolveModelScope");
	}

	// Create session manager based on CLI flags
	let sessionManager = await createSessionManager(parsedArgs, cwd);
	debugStartup("main:createSessionManager");
	time("createSessionManager");

	// Handle --resume (no value): show session picker
	if (parsedArgs.resume === true) {
		const sessions = await SessionManager.list(cwd, parsedArgs.sessionDir);
		time("SessionManager.list");
		if (sessions.length === 0) {
			writeStdout(chalk.dim("No sessions found"));
			return;
		}
		const selectedPath = await selectSession(sessions);
		time("selectSession");
		if (!selectedPath) {
			writeStdout(chalk.dim("No session selected"));
			return;
		}
		sessionManager = await SessionManager.open(selectedPath);
	}

	const sessionOptions = await buildSessionOptions(parsedArgs, scopedModels, sessionManager, modelRegistry);
	debugStartup("main:buildSessionOptions");
	sessionOptions.authStorage = authStorage;
	sessionOptions.modelRegistry = modelRegistry;
	sessionOptions.hasUI = isInteractive;

	// Handle CLI --api-key as runtime override (not persisted)
	if (parsedArgs.apiKey) {
		if (!sessionOptions.model) {
			writeStderr(chalk.red("--api-key requires a model to be specified via --provider/--model or -m/--models"));
			process.exit(1);
		}
		authStorage.setRuntimeApiKey(sessionOptions.model.provider, parsedArgs.apiKey);
	}

	time("buildSessionOptions");
	const { session, setToolUIContext, modelFallbackMessage, lspServers, mcpManager } =
		await createAgentSession(sessionOptions);
	debugStartup("main:createAgentSession");
	time("createAgentSession");

	if (modelFallbackMessage) {
		notifs.push({ kind: "warn", message: modelFallbackMessage });
	}

	const modelRegistryError = modelRegistry.getError();
	if (modelRegistryError) {
		notifs.push({ kind: "error", message: modelRegistryError.message });
	}

	// Re-parse CLI args with extension flags and apply values
	if (session.extensionRunner) {
		const extFlags = session.extensionRunner.getFlags();
		if (extFlags.size > 0) {
			for (let i = 0; i < rawArgs.length; i++) {
				const arg = rawArgs[i];
				if (!arg.startsWith("--")) {
					continue;
				}
				const flagName = arg.slice(2);
				const extFlag = extFlags.get(flagName);
				if (!extFlag) {
					continue;
				}
				if (extFlag.type === "boolean") {
					session.extensionRunner.setFlagValue(flagName, true);
					continue;
				}
				if (i + 1 < rawArgs.length) {
					session.extensionRunner.setFlagValue(flagName, rawArgs[++i]);
				}
			}
		}
	}
	time("applyExtensionFlags");
	debugStartup("main:applyExtensionFlags");

	if (!isInteractive && !session.model) {
		writeStderr(chalk.red("No models available."));
		writeStderr(chalk.yellow("\nSet an API key environment variable:"));
		writeStderr("  ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, etc.");
		writeStderr(chalk.yellow(`\nOr create ${ModelsConfigFile.path()}`));
		process.exit(1);
	}

	// Clamp thinking level to model capabilities (for CLI override case)
	if (session.model && parsedArgs.thinking) {
		let effectiveThinking = parsedArgs.thinking;
		if (!session.model.reasoning) {
			effectiveThinking = "off";
		} else if (effectiveThinking === "xhigh" && !supportsXhigh(session.model)) {
			effectiveThinking = "high";
		}
		if (effectiveThinking !== session.thinkingLevel) {
			session.setThinkingLevel(effectiveThinking);
		}
	}

	if (mode === "rpc") {
		await runRpcMode(session);
	} else if (isInteractive) {
		const versionCheckPromise = checkForNewVersion(VERSION).catch(() => undefined);
		const changelogMarkdown = await getChangelogForDisplay(parsedArgs);

		const scopedModelsForDisplay = sessionOptions.scopedModels ?? scopedModels;
		if (scopedModelsForDisplay.length > 0) {
			const modelList = scopedModelsForDisplay
				.map(scopedModel => {
					const thinkingStr = scopedModel.thinkingLevel !== "off" ? `:${scopedModel.thinkingLevel}` : "";
					return `${scopedModel.model.id}${thinkingStr}`;
				})
				.join(", ");
			writeStdout(chalk.dim(`Model scope: ${modelList} ${chalk.gray("(Ctrl+P to cycle)")}`));
		}

		printTimings();
		debugStartup("main:runInteractiveMode:start");
		await runInteractiveMode(
			session,
			VERSION,
			changelogMarkdown,
			notifs,
			versionCheckPromise,
			parsedArgs.messages,
			setToolUIContext,
			lspServers,
			mcpManager,
			initialMessage,
			initialImages,
		);
	} else {
		await runPrintMode(session, {
			mode,
			messages: parsedArgs.messages,
			initialMessage,
			initialImages,
		});
		await session.dispose();
		stopThemeWatcher();
		await postmortem.quit(0);
	}
}

export async function main(args: string[]): Promise<void> {
	const { runCli } = await import("./cli");
	await runCli(args.length === 0 ? ["launch"] : args);
}
