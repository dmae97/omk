/**
 * Extension loader - loads TypeScript extension modules using jiti.
 *
 */

import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { KeyId } from "omk-tui";
import { CONFIG_DIR_NAME, getAgentDir, isBunBinary } from "../../config.ts";
import { resolvePath } from "../../utils/paths.ts";
import { createEventBus, type EventBus } from "../event-bus.ts";
import type { ExecOptions } from "../exec.ts";
import { execCommand } from "../exec.ts";
import {
	DEFAULT_PACKAGE_MANIFEST_DIALECT,
	type PackageManifestDialect,
	resolvePackageManifestDialect,
} from "../package-manifest.ts";
import { LEGACY_PI_RUNTIME_ALIASES, legacyPiImportHint, type PiCompatibilityTarget } from "../pi-compat.ts";
import { createSyntheticSourceInfo } from "../source-info.ts";
import { transferGoalCostSink } from "./builtin/goal-cost-accounting.ts";
import { markContextHandlerNonMutating } from "./context-handler-options.ts";
import { discoverDirectExtensionsInDir, resolveDirectExtensionEntries } from "./direct-discovery-entries.ts";
import { initializeExtension } from "./initialize-extension.ts";
import { attachLoadedExtensionsAccessor, trackLoadedExtensions } from "./internal-loaded-extensions.ts";
import { buildVirtualModulesLazily, createJitiLazily } from "./lazy-imports.ts";
import { createExtensionRuntime } from "./runtime.ts";

export { createExtensionRuntime } from "./runtime.ts";

import type {
	EntryRenderer,
	Extension,
	ExtensionAPI,
	ExtensionFactory,
	ExtensionRuntime,
	LoadExtensionsResult,
	MessageRenderer,
	ProviderConfig,
	RegisteredCommand,
	ToolDefinition,
} from "./types.ts";

const require = createRequire(import.meta.url);

const aliasesByDialect: Partial<Record<PackageManifestDialect, Record<string, string>>> = {};

export interface ExtensionLoadOptions {
	packageManifestDialect?: PackageManifestDialect;
}

type PackageJsonResolver = (id: string) => string;
type ExistsSync = (path: string) => boolean;

function findPackageJsonPath(
	specifier: string,
	startDir: string,
	resolvePackageJson: PackageJsonResolver = require.resolve,
	existsSync: ExistsSync = fs.existsSync,
): string {
	try {
		return resolvePackageJson(`${specifier}/package.json`);
	} catch {
		let current = startDir;
		while (true) {
			const candidate = path.join(current, "node_modules", ...specifier.split("/"), "package.json");
			if (existsSync(candidate)) {
				return candidate;
			}
			const parent = path.dirname(current);
			if (parent === current) {
				throw new Error(
					`Unable to resolve package.json for ${specifier}. Install ${specifier} or run OMK from a workspace containing its built package.`,
				);
			}
			current = parent;
		}
	}
}

function resolveWorkspaceOrPackageFile(
	workspaceRelativePath: string,
	specifier: string,
	packageRelativePath: string,
	packagesRoot: string,
	resolvePackageJson: PackageJsonResolver,
	existsSync: ExistsSync,
	startDir: string,
): string {
	const workspacePath = path.join(packagesRoot, workspaceRelativePath);
	if (existsSync(workspacePath)) {
		return workspacePath;
	}
	const packageJsonPath = findPackageJsonPath(specifier, startDir, resolvePackageJson, existsSync);
	return path.join(path.dirname(packageJsonPath), packageRelativePath);
}

/** Internal test seam for omk-agent-core/node resolution branches. */
export function resolveOmkAgentCoreNodeEntryForTests(options: {
	packagesRoot: string;
	startDir: string;
	resolvePackageJson: PackageJsonResolver;
	existsSync: ExistsSync;
}): string {
	return resolveWorkspaceOrPackageFile(
		"agent/dist/node.js",
		"omk-agent-core",
		"dist/node.js",
		options.packagesRoot,
		options.resolvePackageJson,
		options.existsSync,
		options.startDir,
	);
}

/**
 * Get aliases for jiti (used in Node.js/development mode).
 * In Bun binary mode, virtualModules is used instead.
 */
function getAliases(dialect: PackageManifestDialect): Record<string, string> {
	const cached = aliasesByDialect[dialect];
	if (cached) return cached;

	const __dirname = path.dirname(fileURLToPath(import.meta.url));
	const packageIndex = path.resolve(__dirname, "../..", "index.js");

	const typeboxEntry = require.resolve("typebox");
	const typeboxCompileEntry = require.resolve("typebox/compile");
	const typeboxValueEntry = require.resolve("typebox/value");

	const packagesRoot = path.resolve(__dirname, "../../../../");
	const omkCodingAgentEntry = packageIndex;
	const omkAgentCoreEntry = resolveWorkspaceOrPackageFile(
		"agent/dist/index.js",
		"omk-agent-core",
		"dist/index.js",
		packagesRoot,
		require.resolve,
		fs.existsSync,
		__dirname,
	);
	const omkAgentCoreNodeEntry = resolveWorkspaceOrPackageFile(
		"agent/dist/node.js",
		"omk-agent-core",
		"dist/node.js",
		packagesRoot,
		require.resolve,
		fs.existsSync,
		__dirname,
	);
	const omkTuiEntry = resolveWorkspaceOrPackageFile(
		"tui/dist/index.js",
		"omk-tui",
		"dist/index.js",
		packagesRoot,
		require.resolve,
		fs.existsSync,
		__dirname,
	);
	const omkAiEntry = resolveWorkspaceOrPackageFile(
		"ai/dist/index.js",
		"omk-ai",
		"dist/index.js",
		packagesRoot,
		require.resolve,
		fs.existsSync,
		__dirname,
	);
	const omkAiOauthEntry = resolveWorkspaceOrPackageFile(
		"ai/dist/oauth.js",
		"omk-ai",
		"dist/oauth.js",
		packagesRoot,
		require.resolve,
		fs.existsSync,
		__dirname,
	);

	const legacyPiAliasTargets: Record<PiCompatibilityTarget, string> = {
		"coding-agent": omkCodingAgentEntry,
		"agent-core": omkAgentCoreEntry,
		"agent-core-node": omkAgentCoreNodeEntry,
		ai: omkAiEntry,
		"ai-oauth": omkAiOauthEntry,
		tui: omkTuiEntry,
	};
	const aliases = {
		...(dialect === "omk+pi"
			? Object.fromEntries(
					Object.entries(LEGACY_PI_RUNTIME_ALIASES).map(([specifier, target]) => [
						specifier,
						legacyPiAliasTargets[target],
					]),
				)
			: {}),
		"open-multi-agent-kit": omkCodingAgentEntry,
		"omk-agent-core": omkAgentCoreEntry,
		"omk-agent-core/node": omkAgentCoreNodeEntry,
		"omk-tui": omkTuiEntry,
		"omk-ai": omkAiEntry,
		"omk-ai/oauth": omkAiOauthEntry,
		"omk-ai/prompt-hash": path.join(path.dirname(omkAiEntry), "prompt-hash.js"),
		typebox: typeboxEntry,
		"typebox/compile": typeboxCompileEntry,
		"typebox/value": typeboxValueEntry,
		"@sinclair/typebox": typeboxEntry,
		"@sinclair/typebox/compile": typeboxCompileEntry,
		"@sinclair/typebox/value": typeboxValueEntry,
	};

	aliasesByDialect[dialect] = aliases;
	return aliases;
}

type HandlerFn = (...args: unknown[]) => Promise<unknown>;

/**
 * Create the ExtensionAPI for an extension.
 * Registration methods write to the extension object.
 * Action methods delegate to the shared runtime.
 */
function createExtensionAPI(
	extension: Extension,
	runtime: ExtensionRuntime,
	cwd: string,
	eventBus: EventBus,
): ExtensionAPI {
	const api = {
		// Registration methods - write to extension
		on(event: string, handler: HandlerFn, options?: { mutatesMessages?: boolean }): void {
			runtime.assertActive();
			if (event === "context" && options?.mutatesMessages === false) markContextHandlerNonMutating(handler);
			(extension.handlers.get(event) ?? extension.handlers.set(event, []).get(event)!).push(handler);
		},

		registerTool(tool: ToolDefinition): void {
			runtime.assertActive();
			extension.tools.set(tool.name, {
				definition: tool,
				sourceInfo: extension.sourceInfo,
			});
			runtime.refreshTools();
		},

		registerCommand(name: string, options: Omit<RegisteredCommand, "name" | "sourceInfo">): void {
			runtime.assertActive();
			extension.commands.set(name, {
				name,
				sourceInfo: extension.sourceInfo,
				...options,
			});
		},

		registerShortcut(
			shortcut: KeyId,
			options: {
				description?: string;
				handler: (ctx: import("./types.ts").ExtensionContext) => Promise<void> | void;
			},
		): void {
			runtime.assertActive();
			extension.shortcuts.set(shortcut, { shortcut, extensionPath: extension.path, ...options });
		},

		registerFlag(
			name: string,
			options: { description?: string; type: "boolean" | "string"; default?: boolean | string },
		): void {
			runtime.assertActive();
			extension.flags.set(name, { name, extensionPath: extension.path, ...options });
			if (options.default !== undefined && !runtime.flagValues.has(name)) {
				runtime.flagValues.set(name, options.default);
			}
		},

		registerMessageRenderer<T>(customType: string, renderer: MessageRenderer<T>): void {
			runtime.assertActive();
			extension.messageRenderers.set(customType, renderer as MessageRenderer);
		},
		registerEntryRenderer<T>(customType: string, renderer: EntryRenderer<T>): void {
			runtime.assertActive();
			if (extension.entryRenderers === undefined) extension.entryRenderers = new Map();
			extension.entryRenderers.set(customType, renderer as EntryRenderer);
		},

		// Flag access - checks extension registered it, reads from runtime
		getFlag(name: string): boolean | string | undefined {
			runtime.assertActive();
			if (!extension.flags.has(name)) return undefined;
			return runtime.flagValues.get(name);
		},

		// Action methods - delegate to shared runtime
		sendMessage(message, options): void {
			runtime.assertActive();
			runtime.sendMessage(message, options);
		},

		sendUserMessage(content, options): void {
			runtime.assertActive();
			runtime.sendUserMessage(content, options);
		},

		appendEntry(customType: string, data?: unknown): void {
			runtime.assertActive();
			runtime.appendEntry(customType, data);
		},

		setSessionName(name: string): void {
			runtime.assertActive();
			runtime.setSessionName(name);
		},

		getSessionName(): string | undefined {
			runtime.assertActive();
			return runtime.getSessionName();
		},

		setLabel(entryId: string, label: string | undefined): void {
			runtime.assertActive();
			runtime.setLabel(entryId, label);
		},

		exec(command: string, args: string[], options?: ExecOptions) {
			runtime.assertActive();
			return execCommand(command, args, options?.cwd ?? cwd, options);
		},

		// Always expose the method so load-time factories can capture it (typeof === "function").
		// The bound handler is resolved at call time after bindCore; until then callers get a clear error.
		async callMcpTool(server: string, name: string, args: Record<string, unknown>): Promise<unknown> {
			runtime.assertActive();
			const handler = runtime.callMcpTool;
			if (typeof handler !== "function") {
				throw new Error(
					"Extension callMcpTool is not bound. The session must provide a callMcpTool handler via bindCore.",
				);
			}
			return handler(server, name, args);
		},

		isMcpToolBound(): boolean {
			runtime.assertActive();
			return typeof runtime.callMcpTool === "function";
		},

		getActiveTools(): string[] {
			runtime.assertActive();
			return runtime.getActiveTools();
		},

		getAllTools() {
			runtime.assertActive();
			return runtime.getAllTools();
		},

		setActiveTools(toolNames: string[]): void {
			runtime.assertActive();
			runtime.setActiveTools(toolNames);
		},

		getCommands() {
			runtime.assertActive();
			return runtime.getCommands();
		},

		setModel(model) {
			runtime.assertActive();
			return runtime.setModel(model);
		},

		getThinkingLevel() {
			runtime.assertActive();
			return runtime.getThinkingLevel();
		},

		setThinkingLevel(level) {
			runtime.assertActive();
			runtime.setThinkingLevel(level);
		},

		// Owner is recorded here, before delegating, so it covers the pre-bind queue and post-bind calls (spec 057 R9).
		registerProvider(name: string, config: ProviderConfig) {
			runtime.assertActive();
			runtime.providerOwners.set(name, extension.resolvedPath);
			runtime.registerProvider(name, config, extension.path);
		},

		unregisterProvider(name: string) {
			runtime.assertActive();
			if (runtime.providerOwners.get(name) === extension.resolvedPath) runtime.providerOwners.delete(name);
			runtime.unregisterProvider(name, extension.path);
		},

		// Track extension event subscriptions so they can be
		// unsubscribed on reload instead of stacking duplicate listeners
		// on the shared event bus.
		events: {
			emit: (channel, data) => {
				eventBus.emit(channel, data);
			},
			on: (channel, handler) => {
				const unsubscribe = eventBus.on(channel, handler);
				extension.eventBusSubscriptions?.push(unsubscribe);
				return unsubscribe;
			},
		},
	} as ExtensionAPI;

	// Internal, symbol-keyed loaded-extension list for the bundled subagent (spec 057 R10); not on ExtensionAPI.
	return attachLoadedExtensionsAccessor(api, runtime);
}

async function loadExtensionModule(
	extensionPath: string,
	binaryMode = isBunBinary,
	dialect: PackageManifestDialect = DEFAULT_PACKAGE_MANIFEST_DIALECT,
) {
	const jiti = await createJitiLazily(import.meta.url, {
		moduleCache: false,
		// Native mode removes implicit aliases, not ordinary user-installed dependency resolution.
		...(binaryMode
			? { virtualModules: await buildVirtualModulesLazily(dialect), tryNative: false }
			: { alias: getAliases(dialect) }),
	});

	const module = await jiti.import(extensionPath, { default: true });
	const factory = module as ExtensionFactory;
	return typeof factory !== "function" ? undefined : factory;
}
/** Internal test seam for loading extensions through Bun binary virtual modules. */
export async function loadExtensionModuleWithVirtualModulesForTests(
	extensionPath: string,
	options: ExtensionLoadOptions = {},
) {
	return loadExtensionModule(extensionPath, true, resolvePackageManifestDialect(options.packageManifestDialect));
}

/**
 * Create an Extension object with empty collections.
 */
function createExtension(extensionPath: string, resolvedPath: string): Extension {
	const source =
		extensionPath.startsWith("<") && extensionPath.endsWith(">")
			? extensionPath.slice(1, -1).split(":")[0] || "temporary"
			: "local";
	const baseDir = extensionPath.startsWith("<") ? undefined : path.dirname(resolvedPath);

	return {
		path: extensionPath,
		resolvedPath,
		sourceInfo: createSyntheticSourceInfo(extensionPath, { source, baseDir }),
		handlers: new Map(),
		tools: new Map(),
		messageRenderers: new Map(),
		entryRenderers: new Map(),
		commands: new Map(),
		flags: new Map(),
		shortcuts: new Map(),
		eventBusSubscriptions: [],
	};
}

async function loadExtension(
	extensionPath: string,
	cwd: string,
	eventBus: EventBus,
	runtime: ExtensionRuntime,
	dialect: PackageManifestDialect,
): Promise<{ extension: Extension | null; error: string | null }> {
	const resolvedPath = resolvePath(extensionPath, cwd, { normalizeUnicodeSpaces: true });

	try {
		const factory = await loadExtensionModule(resolvedPath, isBunBinary, dialect);
		if (!factory) {
			return { extension: null, error: `Extension does not export a valid factory function: ${extensionPath}` };
		}

		const extension = createExtension(extensionPath, resolvedPath);
		const api = createExtensionAPI(extension, runtime, cwd, eventBus);
		await initializeExtension(factory, api, extension);

		return { extension: transferGoalCostSink(api, extension), error: null };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { extension: null, error: `Failed to load extension: ${message}${legacyPiImportHint(message, dialect)}` };
	}
}

/**
 * Create an Extension from an inline factory function.
 */
export async function loadExtensionFromFactory(
	factory: ExtensionFactory,
	cwd: string,
	eventBus: EventBus,
	runtime: ExtensionRuntime,
	extensionPath = "<inline>",
): Promise<Extension> {
	const extension = createExtension(extensionPath, extensionPath);
	const resolvedCwd = resolvePath(cwd);
	const api = createExtensionAPI(extension, runtime, resolvedCwd, eventBus);
	await initializeExtension(factory, api, extension);
	return transferGoalCostSink(api, extension);
}

/**
 * Load extensions from paths.
 */
export async function loadExtensions(
	paths: string[],
	cwd: string,
	eventBus?: EventBus,
	options: ExtensionLoadOptions = {},
): Promise<LoadExtensionsResult> {
	const dialect = resolvePackageManifestDialect(options.packageManifestDialect);
	const runtime = createExtensionRuntime();
	const extensions = trackLoadedExtensions(runtime, []);
	const errors: Array<{ path: string; error: string }> = [];
	const resolvedCwd = resolvePath(cwd);
	const resolvedEventBus = eventBus ?? createEventBus();

	for (const extPath of paths) {
		const { extension, error } = await loadExtension(extPath, resolvedCwd, resolvedEventBus, runtime, dialect);

		if (error) {
			errors.push({ path: extPath, error });
			continue;
		}

		if (extension) extensions.push(extension);
	}

	return { extensions, errors, runtime };
}

/**
 * Discover and load extensions from standard locations.
 */
export async function discoverAndLoadExtensions(
	configuredPaths: string[],
	cwd: string,
	agentDir: string = getAgentDir(),
	eventBus?: EventBus,
	options: ExtensionLoadOptions = {},
): Promise<LoadExtensionsResult> {
	const dialect = resolvePackageManifestDialect(options.packageManifestDialect);
	const resolvedCwd = resolvePath(cwd);
	const resolvedAgentDir = resolvePath(agentDir);
	const allPaths: string[] = [];
	const seen = new Set<string>();

	const addPaths = (paths: string[]) => {
		for (const p of paths) {
			const resolved = path.resolve(p);
			if (!seen.has(resolved)) {
				seen.add(resolved);
				allPaths.push(p);
			}
		}
	};

	// 1. Project-local extensions: cwd/${CONFIG_DIR_NAME}/extensions/
	const localExtDir = path.join(resolvedCwd, CONFIG_DIR_NAME, "extensions");
	addPaths(discoverDirectExtensionsInDir(localExtDir, dialect));

	// 2. Global extensions: agentDir/extensions/
	const globalExtDir = path.join(resolvedAgentDir, "extensions");
	addPaths(discoverDirectExtensionsInDir(globalExtDir, dialect));

	// 3. Explicitly configured paths
	for (const p of configuredPaths) {
		const resolved = resolvePath(p, resolvedCwd, { normalizeUnicodeSpaces: true });
		if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
			// Check for package.json with omk manifest or index.ts
			const entries = resolveDirectExtensionEntries(resolved, dialect);
			if (entries) {
				addPaths(entries);
				continue;
			}
			// No explicit entries - discover individual files in directory
			addPaths(discoverDirectExtensionsInDir(resolved, dialect));
			continue;
		}

		addPaths([resolved]);
	}

	return loadExtensions(allPaths, resolvedCwd, eventBus, { packageManifestDialect: dialect });
}
