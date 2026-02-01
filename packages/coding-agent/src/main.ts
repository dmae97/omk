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
import { postmortem } from "@oh-my-pi/pi-utils";
import chalk from "chalk";
import { type Args, parseArgs, printHelp } from "./cli/args";
import { parseConfigArgs, printConfigHelp, runConfigCommand } from "./cli/config-cli";
import { processFileArguments } from "./cli/file-processor";
import { parseGrepArgs, printGrepHelp, runGrepCommand } from "./cli/grep-cli";
import { parseShellArgs, printShellHelp, runShellCommand } from "./cli/shell-cli";
import { parseJupyterArgs, printJupyterHelp, runJupyterCommand } from "./cli/jupyter-cli";
import { listModels } from "./cli/list-models";
import { parsePluginArgs, printPluginHelp, runPluginCommand } from "./cli/plugin-cli";
import { selectSession } from "./cli/session-picker";
import { parseSetupArgs, printSetupHelp, runSetupCommand } from "./cli/setup-cli";
import { parseStatsArgs, printStatsHelp, runStatsCommand } from "./cli/stats-cli";
import { parseUpdateArgs, printUpdateHelp, runUpdateCommand } from "./cli/update-cli";
import { runCommitCommand } from "./commit";
import { parseCommitArgs, printCommitHelp } from "./commit/cli";
import { findConfigFile, getModelsPath, VERSION } from "./config";
import type { ModelRegistry } from "./config/model-registry";
import { parseModelPattern, parseModelString, resolveModelScope, type ScopedModel } from "./config/model-resolver";
import { Settings, settings } from "./config/settings";
import { initializeWithSettings } from "./discovery";
import { exportFromFile } from "./export/html";
import type { ExtensionUIContext } from "./extensibility/extensions/types";
import { runMigrations, showDeprecationWarnings } from "./migrations";
import { InteractiveMode, runPrintMode, runRpcMode } from "./modes";
import { initTheme, stopThemeWatcher } from "./modes/theme/theme";
import { type CreateAgentSessionOptions, createAgentSession, discoverAuthStorage, discoverModels } from "./sdk";
import type { AgentSession } from "./session/agent-session";
import { type SessionInfo, SessionManager } from "./session/session-manager";
import { resolvePromptInput } from "./system-prompt";
import { getChangelogPath, getNewEntries, parseChangelog } from "./utils/changelog";
import { printTimings, time } from "./utils/timings";

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

async function runInteractiveMode(
	session: AgentSession,
	version: string,
	changelogMarkdown: string | undefined,
	modelFallbackMessage: string | undefined,
	modelsJsonError: string | undefined,
	migratedProviders: string[],
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

	if (migratedProviders.length > 0) {
		mode.showWarning(`Migrated credentials to agent.db: ${migratedProviders.join(", ")}`);
	}

	if (modelsJsonError) {
		mode.showError(`models.json error: ${modelsJsonError}`);
	}

	if (modelFallbackMessage) {
		mode.showWarning(modelFallbackMessage);
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
	if (parsed.session) {
		const sessionArg = parsed.session;
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
	// --resume is handled separately (needs picker UI)
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
		const currentRoles = settings.get("modelRoles") as Record<string, string>;
		settings.override("modelRoles", { ...currentRoles, default: `${model.provider}/${model.id}` });
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

export async function main(args: string[]) {
	time("start");

	// Initialize theme early with defaults (CLI commands need symbols)
	// Will be re-initialized with user preferences later
	await initTheme();

	// Handle plugin subcommand before regular parsing
	const pluginCmd = parsePluginArgs(args);
	if (pluginCmd) {
		if (args.includes("--help") || args.includes("-h")) {
			printPluginHelp();
			return;
		}
		await runPluginCommand(pluginCmd);
		return;
	}

	// Handle update subcommand
	const updateCmd = parseUpdateArgs(args);
	if (updateCmd) {
		if (args.includes("--help") || args.includes("-h")) {
			printUpdateHelp();
			return;
		}
		await runUpdateCommand(updateCmd);
		return;
	}

	// Handle config subcommand
	const configCmd = parseConfigArgs(args);
	if (configCmd) {
		if (args.includes("--help") || args.includes("-h")) {
			printConfigHelp();
			return;
		}
		await runConfigCommand(configCmd);
		return;
	}

	// Handle setup subcommand
	const setupCmd = parseSetupArgs(args);
	if (setupCmd) {
		if (args.includes("--help") || args.includes("-h")) {
			printSetupHelp();
			return;
		}
		await runSetupCommand(setupCmd);
		return;
	}

	// Handle jupyter subcommand
	const jupyterCmd = parseJupyterArgs(args);
	if (jupyterCmd) {
		if (args.includes("--help") || args.includes("-h")) {
			printJupyterHelp();
			return;
		}
		await runJupyterCommand(jupyterCmd);
		return;
	}

	// Handle stats subcommand
	const statsCmd = parseStatsArgs(args);
	if (statsCmd) {
		if (args.includes("--help") || args.includes("-h")) {
			printStatsHelp();
			return;
		}
		await runStatsCommand(statsCmd);
		return;
	}

	// Handle grep subcommand (for testing grep tool)
	const grepCmd = parseGrepArgs(args);
	if (grepCmd) {
		if (args.includes("--help") || args.includes("-h")) {
			printGrepHelp();
			return;
		}
		await runGrepCommand(grepCmd);
		return;
	}

	// Handle shell subcommand (for testing brush-core shell)
	const shellCmd = parseShellArgs(args);
	if (shellCmd) {
		if (args.includes("--help") || args.includes("-h")) {
			printShellHelp();
			return;
		}
		await runShellCommand(shellCmd);
		return;
	}

	// Handle commit subcommand
	const commitCmd = parseCommitArgs(args);
	if (commitCmd) {
		if (args.includes("--help") || args.includes("-h")) {
			printCommitHelp();
			return;
		}
		await runCommitCommand(commitCmd);
		process.exit(0);
	}

	const parsed = parseArgs(args);
	time("parseArgs");
	await maybeAutoChdir(parsed);

	// Run migrations (pass cwd for project-local migrations)
	const { migratedAuthProviders: migratedProviders, deprecationWarnings } = await runMigrations(process.cwd());

	// Create AuthStorage and ModelRegistry upfront
	const authStorage = await discoverAuthStorage();
	const modelRegistry = discoverModels(authStorage);
	time("discoverModels");

	if (parsed.version) {
		writeStdout(VERSION);
		return;
	}

	if (parsed.help) {
		printHelp();
		return;
	}

	if (parsed.listModels !== undefined) {
		const searchPattern = typeof parsed.listModels === "string" ? parsed.listModels : undefined;
		await listModels(modelRegistry, searchPattern);
		return;
	}

	if (parsed.export) {
		try {
			const outputPath = parsed.messages.length > 0 ? parsed.messages[0] : undefined;
			const result = await exportFromFile(parsed.export, outputPath);
			writeStdout(`Exported to: ${result}`);
			return;
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Failed to export session";
			writeStderr(chalk.red(`Error: ${message}`));
			process.exit(1);
		}
	}

	if (parsed.mode === "rpc" && parsed.fileArgs.length > 0) {
		writeStderr(chalk.red("Error: @file arguments are not supported in RPC mode"));
		process.exit(1);
	}

	const cwd = process.cwd();
	await Settings.init({ cwd });
	time("Settings.init");
	const pipedInput = await readPipedInput();
	let { initialMessage, initialImages } = await prepareInitialMessage(parsed, settings.get("images.autoResize"));
	if (pipedInput) {
		initialMessage = initialMessage ? `${initialMessage}\n${pipedInput}` : pipedInput;
	}
	time("prepareInitialMessage");
	const autoPrint = pipedInput !== undefined && !parsed.print && parsed.mode === undefined;
	const isInteractive = !parsed.print && !autoPrint && parsed.mode === undefined;
	const mode = parsed.mode || "text";

	// Initialize discovery system with settings for provider persistence
	initializeWithSettings(settings);
	time("initializeWithSettings");

	// Apply model role overrides from CLI args or env vars (ephemeral, not persisted)
	const smolModel = parsed.smol ?? process.env.OMP_SMOL_MODEL;
	const slowModel = parsed.slow ?? process.env.OMP_SLOW_MODEL;
	const planModel = parsed.plan ?? process.env.OMP_PLAN_MODEL;
	if (smolModel || slowModel || planModel) {
		const currentRoles = settings.get("modelRoles") as Record<string, string>;
		if (smolModel) currentRoles.smol = smolModel;
		if (slowModel) currentRoles.slow = slowModel;
		if (planModel) currentRoles.plan = planModel;
		settings.override("modelRoles", currentRoles);
	}

	await initTheme(settings.get("theme"), isInteractive, settings.get("symbolPreset"), settings.get("colorBlindMode"));
	time("initTheme");

	// Show deprecation warnings in interactive mode
	if (isInteractive && deprecationWarnings.length > 0) {
		await showDeprecationWarnings(deprecationWarnings);
	}

	let scopedModels: ScopedModel[] = [];
	const modelPatterns = parsed.models ?? settings.get("enabledModels");
	const modelMatchPreferences = {
		usageOrder: settings.getStorage()?.getModelUsageOrder(),
	};
	if (modelPatterns && modelPatterns.length > 0) {
		scopedModels = await resolveModelScope(modelPatterns, modelRegistry, modelMatchPreferences);
		time("resolveModelScope");
	}

	// Create session manager based on CLI flags
	let sessionManager = await createSessionManager(parsed, cwd);
	time("createSessionManager");

	// Handle --resume: show session picker
	if (parsed.resume) {
		const sessions = await SessionManager.list(cwd, parsed.sessionDir);
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

	const sessionOptions = await buildSessionOptions(parsed, scopedModels, sessionManager, modelRegistry);
	sessionOptions.authStorage = authStorage;
	sessionOptions.modelRegistry = modelRegistry;
	sessionOptions.hasUI = isInteractive;

	// Handle CLI --api-key as runtime override (not persisted)
	if (parsed.apiKey) {
		if (!sessionOptions.model) {
			writeStderr(chalk.red("--api-key requires a model to be specified via --provider/--model or -m/--models"));
			process.exit(1);
		}
		authStorage.setRuntimeApiKey(sessionOptions.model.provider, parsed.apiKey);
	}

	time("buildSessionOptions");
	const { session, setToolUIContext, modelFallbackMessage, lspServers, mcpManager } =
		await createAgentSession(sessionOptions);
	time("createAgentSession");

	// Re-parse CLI args with extension flags and apply values
	if (session.extensionRunner) {
		const extFlags = session.extensionRunner.getFlags();
		if (extFlags.size > 0) {
			const flagDefs = new Map<string, { type: "boolean" | "string" }>();
			for (const [name, flag] of extFlags) {
				flagDefs.set(name, { type: flag.type });
			}
			const reparsed = parseArgs(args, flagDefs);
			for (const [name, value] of reparsed.unknownFlags) {
				session.extensionRunner.setFlagValue(name, value);
			}
		}
	}
	time("applyExtensionFlags");

	if (!isInteractive && !session.model) {
		writeStderr(chalk.red("No models available."));
		writeStderr(chalk.yellow("\nSet an API key environment variable:"));
		writeStderr("  ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, etc.");
		writeStderr(chalk.yellow(`\nOr create ${getModelsPath()}`));
		process.exit(1);
	}

	// Clamp thinking level to model capabilities (for CLI override case)
	if (session.model && parsed.thinking) {
		let effectiveThinking = parsed.thinking;
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
		const changelogMarkdown = await getChangelogForDisplay(parsed);

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
		await runInteractiveMode(
			session,
			VERSION,
			changelogMarkdown,
			modelFallbackMessage,
			modelRegistry.getError(),
			migratedProviders,
			versionCheckPromise,
			parsed.messages,
			setToolUIContext,
			lspServers,
			mcpManager,
			initialMessage,
			initialImages,
		);
	} else {
		await runPrintMode(session, {
			mode,
			messages: parsed.messages,
			initialMessage,
			initialImages,
		});
		await session.dispose();
		stopThemeWatcher();
		await postmortem.quit(0);
	}
}
