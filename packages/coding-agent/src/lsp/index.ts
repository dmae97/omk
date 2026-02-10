import * as fs from "node:fs";
import path from "node:path";
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { logger, once, untilAborted } from "@oh-my-pi/pi-utils";
import type { BunFile } from "bun";
import { renderPromptTemplate } from "../config/prompt-templates";
import { type Theme, theme } from "../modes/theme/theme";
import lspDescription from "../prompts/tools/lsp.md" with { type: "text" };
import type { ToolSession } from "../tools";
import { resolveToCwd } from "../tools/path-utils";
import { throwIfAborted } from "../tools/tool-errors";
import {
	ensureFileOpen,
	getActiveClients,
	getOrCreateClient,
	type LspServerStatus,
	notifySaved,
	refreshFile,
	sendRequest,
	setIdleTimeout,
	syncContent,
	WARMUP_TIMEOUT_MS,
} from "./client";
import { getLinterClient } from "./clients";
import { getServersForFile, type LspConfig, loadConfig } from "./config";
import { applyTextEditsToString, applyWorkspaceEdit } from "./edits";
import { detectLspmux } from "./lspmux";
import { renderCall, renderResult } from "./render";
import {
	type Diagnostic,
	type DocumentSymbol,
	type Hover,
	type Location,
	type LocationLink,
	type LspClient,
	type LspParams,
	type LspToolDetails,
	lspSchema,
	type ServerConfig,
	type SymbolInformation,
	type TextEdit,
	type WorkspaceEdit,
} from "./types";
import {
	extractHoverText,
	fileToUri,
	formatDiagnostic,
	formatDiagnosticsSummary,
	formatDocumentSymbol,
	formatLocation,
	formatSymbolInformation,
	formatWorkspaceEdit,
	sortDiagnostics,
	symbolKindToIcon,
} from "./utils";

export type { LspServerStatus } from "./client";
export type { LspToolDetails } from "./types";

/** Result from warming up LSP servers */
export interface LspWarmupResult {
	servers: Array<{
		name: string;
		status: "ready" | "error";
		fileTypes: string[];
		error?: string;
	}>;
}

/** Options for warming up LSP servers */
export interface LspWarmupOptions {
	/** Called when starting to connect to servers */
	onConnecting?: (serverNames: string[]) => void;
}

/**
 * Warm up LSP servers for a directory by connecting to all detected servers.
 * This should be called at startup to avoid cold-start delays.
 *
 * @param cwd - Working directory to detect and start servers for
 * @param options - Optional callbacks for progress reporting
 * @returns Status of each server that was started
 */
export async function warmupLspServers(cwd: string, options?: LspWarmupOptions): Promise<LspWarmupResult> {
	const config = loadConfig(cwd);
	setIdleTimeout(config.idleTimeoutMs);
	const servers: LspWarmupResult["servers"] = [];
	const lspServers = getLspServers(config);

	// Notify caller which servers we're connecting to
	if (lspServers.length > 0 && options?.onConnecting) {
		options.onConnecting(lspServers.map(([name]) => name));
	}

	// Start all detected servers in parallel with a short timeout
	// Servers that don't respond quickly will be initialized lazily on first use
	const results = await Promise.allSettled(
		lspServers.map(async ([name, serverConfig]) => {
			const client = await getOrCreateClient(serverConfig, cwd, serverConfig.warmupTimeoutMs ?? WARMUP_TIMEOUT_MS);
			return { name, client, fileTypes: serverConfig.fileTypes };
		}),
	);

	for (let i = 0; i < results.length; i++) {
		const result = results[i];
		const [name, serverConfig] = lspServers[i];
		if (result.status === "fulfilled") {
			servers.push({
				name: result.value.name,
				status: "ready",
				fileTypes: result.value.fileTypes,
			});
		} else {
			const errorMsg = result.reason?.message ?? String(result.reason);
			logger.warn("LSP server failed to start", { server: name, error: errorMsg });
			servers.push({
				name,
				status: "error",
				fileTypes: serverConfig.fileTypes,
				error: errorMsg,
			});
		}
	}

	return { servers };
}

/**
 * Get status of currently active LSP servers.
 */
export function getLspStatus(): LspServerStatus[] {
	return getActiveClients();
}

/**
 * Sync in-memory file content to all applicable LSP servers.
 * Sends didOpen (if new) or didChange (if already open).
 *
 * @param absolutePath - Absolute path to the file
 * @param content - The new file content
 * @param cwd - Working directory for LSP config resolution
 * @param servers - Servers to sync to
 */
async function syncFileContent(
	absolutePath: string,
	content: string,
	cwd: string,
	servers: Array<[string, ServerConfig]>,
	signal?: AbortSignal,
): Promise<void> {
	throwIfAborted(signal);
	await Promise.allSettled(
		servers.map(async ([_serverName, serverConfig]) => {
			throwIfAborted(signal);
			if (serverConfig.createClient) {
				return;
			}
			const client = await getOrCreateClient(serverConfig, cwd);
			throwIfAborted(signal);
			await syncContent(client, absolutePath, content, signal);
		}),
	);
}

/**
 * Notify all LSP servers that a file was saved.
 * Assumes content was already synced via syncFileContent.
 *
 * @param absolutePath - Absolute path to the file
 * @param cwd - Working directory for LSP config resolution
 * @param servers - Servers to notify
 */
async function notifyFileSaved(
	absolutePath: string,
	cwd: string,
	servers: Array<[string, ServerConfig]>,
	signal?: AbortSignal,
): Promise<void> {
	throwIfAborted(signal);
	await Promise.allSettled(
		servers.map(async ([_serverName, serverConfig]) => {
			throwIfAborted(signal);
			if (serverConfig.createClient) {
				return;
			}
			const client = await getOrCreateClient(serverConfig, cwd);
			await notifySaved(client, absolutePath, signal);
		}),
	);
}

// Cache config per cwd to avoid repeated file I/O
const configCache = new Map<string, LspConfig>();

function getConfig(cwd: string): LspConfig {
	let config = configCache.get(cwd);
	if (!config) {
		config = loadConfig(cwd);
		setIdleTimeout(config.idleTimeoutMs);
		configCache.set(cwd, config);
	}
	return config;
}

function isCustomLinter(serverConfig: ServerConfig): boolean {
	return Boolean(serverConfig.createClient);
}

function splitServers(servers: Array<[string, ServerConfig]>): {
	lspServers: Array<[string, ServerConfig]>;
	customLinterServers: Array<[string, ServerConfig]>;
} {
	const lspServers: Array<[string, ServerConfig]> = [];
	const customLinterServers: Array<[string, ServerConfig]> = [];
	for (const entry of servers) {
		if (isCustomLinter(entry[1])) {
			customLinterServers.push(entry);
		} else {
			lspServers.push(entry);
		}
	}
	return { lspServers, customLinterServers };
}

function getLspServers(config: LspConfig): Array<[string, ServerConfig]> {
	return (Object.entries(config.servers) as Array<[string, ServerConfig]>).filter(
		([, serverConfig]) => !isCustomLinter(serverConfig),
	);
}

function getLspServersForFile(config: LspConfig, filePath: string): Array<[string, ServerConfig]> {
	return getServersForFile(config, filePath).filter(([, serverConfig]) => !isCustomLinter(serverConfig));
}

function getLspServerForFile(config: LspConfig, filePath: string): [string, ServerConfig] | null {
	const servers = getLspServersForFile(config, filePath);
	return servers.length > 0 ? servers[0] : null;
}

const DIAGNOSTIC_MESSAGE_LIMIT = 50;

function limitDiagnosticMessages(messages: string[]): string[] {
	if (messages.length <= DIAGNOSTIC_MESSAGE_LIMIT) {
		return messages;
	}
	return messages.slice(0, DIAGNOSTIC_MESSAGE_LIMIT);
}

function getServerForWorkspaceAction(config: LspConfig, action: string): [string, ServerConfig] | null {
	const entries = getLspServers(config);
	if (entries.length === 0) return null;

	if (action === "symbols" || action === "reload") {
		return entries[0];
	}

	return null;
}

async function waitForDiagnostics(
	client: LspClient,
	uri: string,
	timeoutMs = 3000,
	signal?: AbortSignal,
	minVersion?: number,
): Promise<Diagnostic[]> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		throwIfAborted(signal);
		const diagnostics = client.diagnostics.get(uri);
		const versionOk = minVersion === undefined || client.diagnosticsVersion > minVersion;
		if (diagnostics !== undefined && versionOk) return diagnostics;
		await Bun.sleep(100);
	}
	return client.diagnostics.get(uri) ?? [];
}

/** Project type detection result */
interface ProjectType {
	type: "rust" | "typescript" | "go" | "python" | "unknown";
	command?: string[];
	description: string;
}

/** Detect project type from root markers */
function detectProjectType(cwd: string): ProjectType {
	// Check for Rust (Cargo.toml)
	if (fs.existsSync(path.join(cwd, "Cargo.toml"))) {
		return { type: "rust", command: ["cargo", "check", "--message-format=short"], description: "Rust (cargo check)" };
	}

	// Check for TypeScript (tsconfig.json)
	if (fs.existsSync(path.join(cwd, "tsconfig.json"))) {
		return { type: "typescript", command: ["npx", "tsc", "--noEmit"], description: "TypeScript (tsc --noEmit)" };
	}

	// Check for Go (go.mod)
	if (fs.existsSync(path.join(cwd, "go.mod"))) {
		return { type: "go", command: ["go", "build", "./..."], description: "Go (go build)" };
	}

	// Check for Python (pyproject.toml or pyrightconfig.json)
	if (fs.existsSync(path.join(cwd, "pyproject.toml")) || fs.existsSync(path.join(cwd, "pyrightconfig.json"))) {
		return { type: "python", command: ["pyright"], description: "Python (pyright)" };
	}

	return { type: "unknown", description: "Unknown project type" };
}

/** Run workspace diagnostics command and parse output */
async function runWorkspaceDiagnostics(cwd: string): Promise<{ output: string; projectType: ProjectType }> {
	const projectType = detectProjectType(cwd);

	if (!projectType.command) {
		return {
			output: `Cannot detect project type. Supported: Rust (Cargo.toml), TypeScript (tsconfig.json), Go (go.mod), Python (pyproject.toml)`,
			projectType,
		};
	}

	try {
		const proc = Bun.spawn(projectType.command, {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
			windowsHide: true,
		});

		const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
		await proc.exited;

		const combined = (stdout + stderr).trim();
		if (!combined) {
			return { output: "No issues found", projectType };
		}

		// Limit output length
		const lines = combined.split("\n");
		if (lines.length > 50) {
			return { output: `${lines.slice(0, 50).join("\n")}\n... and ${lines.length - 50} more lines`, projectType };
		}

		return { output: combined, projectType };
	} catch (e) {
		return { output: `Failed to run ${projectType.command.join(" ")}: ${e}`, projectType };
	}
}

/** Result from getDiagnosticsForFile */
export interface FileDiagnosticsResult {
	/** Name of the LSP server used (if available) */
	server?: string;
	/** Formatted diagnostic messages */
	messages: string[];
	/** Summary string (e.g., "2 error(s), 1 warning(s)") */
	summary: string;
	/** Whether there are any errors (severity 1) */
	errored: boolean;
	/** Whether the file was formatted */
	formatter?: FileFormatResult;
}

/** Captured diagnostic versions per server (before sync) */
type DiagnosticVersions = Map<string, number>;

/**
 * Capture current diagnostic versions for all LSP servers.
 * Call this BEFORE syncing content to detect stale diagnostics later.
 */
async function captureDiagnosticVersions(
	cwd: string,
	servers: Array<[string, ServerConfig]>,
): Promise<DiagnosticVersions> {
	const versions = new Map<string, number>();
	await Promise.allSettled(
		servers.map(async ([serverName, serverConfig]) => {
			if (serverConfig.createClient) return;
			const client = await getOrCreateClient(serverConfig, cwd);
			versions.set(serverName, client.diagnosticsVersion);
		}),
	);
	return versions;
}

/**
 * Get diagnostics for a file using LSP or custom linter client.
 *
 * @param absolutePath - Absolute path to the file
 * @param cwd - Working directory for LSP config resolution
 * @param servers - Servers to query diagnostics for
 * @param minVersions - Minimum diagnostic versions per server (to detect stale results)
 * @returns Diagnostic results or undefined if no servers
 */
async function getDiagnosticsForFile(
	absolutePath: string,
	cwd: string,
	servers: Array<[string, ServerConfig]>,
	signal?: AbortSignal,
	minVersions?: DiagnosticVersions,
): Promise<FileDiagnosticsResult | undefined> {
	if (servers.length === 0) {
		return undefined;
	}

	const uri = fileToUri(absolutePath);
	const relPath = path.relative(cwd, absolutePath);
	const allDiagnostics: Diagnostic[] = [];
	const serverNames: string[] = [];

	// Wait for diagnostics from all servers in parallel
	const results = await Promise.allSettled(
		servers.map(async ([serverName, serverConfig]) => {
			throwIfAborted(signal);
			// Use custom linter client if configured
			if (serverConfig.createClient) {
				const linterClient = getLinterClient(serverName, serverConfig, cwd);
				const diagnostics = await linterClient.lint(absolutePath);
				return { serverName, diagnostics };
			}

			// Default: use LSP
			const client = await getOrCreateClient(serverConfig, cwd);
			throwIfAborted(signal);
			// Content already synced + didSave sent, wait for fresh diagnostics
			const minVersion = minVersions?.get(serverName);
			const diagnostics = await waitForDiagnostics(client, uri, 3000, signal, minVersion);
			return { serverName, diagnostics };
		}),
	);

	for (const result of results) {
		if (result.status === "fulfilled") {
			serverNames.push(result.value.serverName);
			allDiagnostics.push(...result.value.diagnostics);
		}
	}

	if (serverNames.length === 0) {
		return undefined;
	}

	if (allDiagnostics.length === 0) {
		return {
			server: serverNames.join(", "),
			messages: [],
			summary: "OK",
			errored: false,
		};
	}

	// Deduplicate diagnostics by range + message (different servers might report similar issues)
	const seen = new Set<string>();
	const uniqueDiagnostics: Diagnostic[] = [];
	for (const d of allDiagnostics) {
		const key = `${d.range.start.line}:${d.range.start.character}:${d.range.end.line}:${d.range.end.character}:${d.message}`;
		if (!seen.has(key)) {
			seen.add(key);
			uniqueDiagnostics.push(d);
		}
	}

	sortDiagnostics(uniqueDiagnostics);
	const formatted = uniqueDiagnostics.map(d => formatDiagnostic(d, relPath));
	const limited = limitDiagnosticMessages(formatted);
	const summary = formatDiagnosticsSummary(uniqueDiagnostics);
	const hasErrors = uniqueDiagnostics.some(d => d.severity === 1);

	return {
		server: serverNames.join(", "),
		messages: limited,
		summary,
		errored: hasErrors,
	};
}

export enum FileFormatResult {
	UNCHANGED = "unchanged",
	FORMATTED = "formatted",
}

/** Default formatting options for LSP */
const DEFAULT_FORMAT_OPTIONS = {
	tabSize: 3,
	insertSpaces: true,
	trimTrailingWhitespace: true,
	insertFinalNewline: true,
	trimFinalNewlines: true,
};

/**
 * Format content using LSP or custom linter client.
 *
 * @param absolutePath - Absolute path (for URI)
 * @param content - Content to format
 * @param cwd - Working directory for LSP config resolution
 * @param servers - Servers to try formatting with
 * @returns Formatted content, or original if no formatter available
 */
async function formatContent(
	absolutePath: string,
	content: string,
	cwd: string,
	servers: Array<[string, ServerConfig]>,
	signal?: AbortSignal,
): Promise<string> {
	if (servers.length === 0) {
		return content;
	}

	const uri = fileToUri(absolutePath);

	for (const [serverName, serverConfig] of servers) {
		try {
			throwIfAborted(signal);
			// Use custom linter client if configured
			if (serverConfig.createClient) {
				const linterClient = getLinterClient(serverName, serverConfig, cwd);
				return await linterClient.format(absolutePath, content);
			}

			// Default: use LSP
			const client = await getOrCreateClient(serverConfig, cwd);
			throwIfAborted(signal);

			const caps = client.serverCapabilities;
			if (!caps?.documentFormattingProvider) {
				continue;
			}

			// Request formatting (content already synced)
			const edits = (await sendRequest(
				client,
				"textDocument/formatting",
				{
					textDocument: { uri },
					options: DEFAULT_FORMAT_OPTIONS,
				},
				signal,
			)) as TextEdit[] | null;

			if (!edits || edits.length === 0) {
				return content;
			}

			// Apply edits in-memory and return
			return applyTextEditsToString(content, edits);
		} catch {}
	}

	return content;
}

/** Options for creating the LSP writethrough callback */
export interface WritethroughOptions {
	/** Whether to format the file using LSP after writing */
	enableFormat?: boolean;
	/** Whether to get LSP diagnostics after writing */
	enableDiagnostics?: boolean;
}

/** Callback type for the LSP writethrough */
export type WritethroughCallback = (
	dst: string,
	content: string,
	signal?: AbortSignal,
	file?: BunFile,
	batch?: LspWritethroughBatchRequest,
) => Promise<FileDiagnosticsResult | undefined>;

/** No-op writethrough callback */
export async function writethroughNoop(
	dst: string,
	content: string,
	_signal?: AbortSignal,
	file?: BunFile,
): Promise<FileDiagnosticsResult | undefined> {
	if (file) {
		await file.write(content);
	} else {
		await Bun.write(dst, content);
	}
	return undefined;
}

interface PendingWritethrough {
	dst: string;
	content: string;
	file?: BunFile;
}

interface LspWritethroughBatchRequest {
	id: string;
	flush: boolean;
}

interface LspWritethroughBatchState {
	entries: Map<string, PendingWritethrough>;
	options: Required<WritethroughOptions>;
}

const writethroughBatches = new Map<string, LspWritethroughBatchState>();

function getOrCreateWritethroughBatch(id: string, options: Required<WritethroughOptions>): LspWritethroughBatchState {
	const existing = writethroughBatches.get(id);
	if (existing) {
		existing.options.enableFormat ||= options.enableFormat;
		existing.options.enableDiagnostics ||= options.enableDiagnostics;
		return existing;
	}
	const batch: LspWritethroughBatchState = {
		entries: new Map<string, PendingWritethrough>(),
		options: { ...options },
	};
	writethroughBatches.set(id, batch);
	return batch;
}

export async function flushLspWritethroughBatch(
	id: string,
	cwd: string,
	signal?: AbortSignal,
): Promise<FileDiagnosticsResult | undefined> {
	const state = writethroughBatches.get(id);
	if (!state) {
		return undefined;
	}
	writethroughBatches.delete(id);
	return flushWritethroughBatch(Array.from(state.entries.values()), cwd, state.options, signal);
}

function summarizeDiagnosticMessages(messages: string[]): { summary: string; errored: boolean } {
	const counts = { error: 0, warning: 0, info: 0, hint: 0 };
	for (const message of messages) {
		const match = message.match(/\[(error|warning|info|hint)\]/i);
		if (!match) continue;
		const key = match[1].toLowerCase() as keyof typeof counts;
		counts[key] += 1;
	}

	const parts: string[] = [];
	if (counts.error > 0) parts.push(`${counts.error} error(s)`);
	if (counts.warning > 0) parts.push(`${counts.warning} warning(s)`);
	if (counts.info > 0) parts.push(`${counts.info} info(s)`);
	if (counts.hint > 0) parts.push(`${counts.hint} hint(s)`);

	return {
		summary: parts.length > 0 ? parts.join(", ") : "no issues",
		errored: counts.error > 0,
	};
}

function mergeDiagnostics(
	results: Array<FileDiagnosticsResult | undefined>,
	options: Required<WritethroughOptions>,
): FileDiagnosticsResult | undefined {
	const messages: string[] = [];
	const servers = new Set<string>();
	let hasResults = false;
	let hasFormatter = false;
	let formatted = false;

	for (const result of results) {
		if (!result) continue;
		hasResults = true;
		if (result.server) {
			for (const server of result.server.split(",")) {
				const trimmed = server.trim();
				if (trimmed) {
					servers.add(trimmed);
				}
			}
		}
		if (result.messages.length > 0) {
			messages.push(...result.messages);
		}
		if (result.formatter !== undefined) {
			hasFormatter = true;
			if (result.formatter === FileFormatResult.FORMATTED) {
				formatted = true;
			}
		}
	}

	if (!hasResults && !hasFormatter) {
		return undefined;
	}

	let summary = options.enableDiagnostics ? "no issues" : "OK";
	let errored = false;
	let limitedMessages = messages;
	if (messages.length > 0) {
		const summaryInfo = summarizeDiagnosticMessages(messages);
		summary = summaryInfo.summary;
		errored = summaryInfo.errored;
		limitedMessages = limitDiagnosticMessages(messages);
	}
	const formatter = hasFormatter ? (formatted ? FileFormatResult.FORMATTED : FileFormatResult.UNCHANGED) : undefined;

	return {
		server: servers.size > 0 ? Array.from(servers).join(", ") : undefined,
		messages: limitedMessages,
		summary,
		errored,
		formatter,
	};
}

async function runLspWritethrough(
	dst: string,
	content: string,
	cwd: string,
	options: Required<WritethroughOptions>,
	signal?: AbortSignal,
	file?: BunFile,
): Promise<FileDiagnosticsResult | undefined> {
	const { enableFormat, enableDiagnostics } = options;
	const config = getConfig(cwd);
	const servers = getServersForFile(config, dst);
	if (servers.length === 0) {
		return writethroughNoop(dst, content, signal, file);
	}
	const { lspServers, customLinterServers } = splitServers(servers);

	let finalContent = content;
	const writeContent = async (value: string) => (file ? file.write(value) : Bun.write(dst, value));
	const getWritePromise = once(() => writeContent(finalContent));
	const useCustomFormatter = enableFormat && customLinterServers.length > 0;

	// Capture diagnostic versions BEFORE syncing to detect stale diagnostics
	const minVersions = enableDiagnostics ? await captureDiagnosticVersions(cwd, servers) : undefined;

	let formatter: FileFormatResult | undefined;
	let diagnostics: FileDiagnosticsResult | undefined;
	let timedOut = false;
	try {
		const timeoutSignal = AbortSignal.timeout(10_000);
		timeoutSignal.addEventListener(
			"abort",
			() => {
				timedOut = true;
			},
			{ once: true },
		);
		const operationSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
		await untilAborted(operationSignal, async () => {
			if (useCustomFormatter) {
				// Custom linters (e.g. Biome CLI) require on-disk input.
				await writeContent(content);
				finalContent = await formatContent(dst, content, cwd, customLinterServers, operationSignal);
				formatter = finalContent !== content ? FileFormatResult.FORMATTED : FileFormatResult.UNCHANGED;
				await writeContent(finalContent);
				await syncFileContent(dst, finalContent, cwd, lspServers, operationSignal);
			} else {
				// 1. Sync original content to LSP servers
				await syncFileContent(dst, content, cwd, lspServers, operationSignal);

				// 2. Format in-memory via LSP
				if (enableFormat) {
					finalContent = await formatContent(dst, content, cwd, lspServers, operationSignal);
					formatter = finalContent !== content ? FileFormatResult.FORMATTED : FileFormatResult.UNCHANGED;
				}

				// 3. If formatted, sync formatted content to LSP servers
				if (finalContent !== content) {
					await syncFileContent(dst, finalContent, cwd, lspServers, operationSignal);
				}

				// 4. Write to disk
				await getWritePromise();
			}

			// 5. Notify saved to LSP servers
			await notifyFileSaved(dst, cwd, lspServers, operationSignal);

			// 6. Get diagnostics from all servers (wait for fresh results)
			if (enableDiagnostics) {
				diagnostics = await getDiagnosticsForFile(dst, cwd, servers, operationSignal, minVersions);
			}
		});
	} catch {
		if (timedOut) {
			formatter = undefined;
			diagnostics = undefined;
		}
		await getWritePromise();
	}

	if (formatter !== undefined) {
		diagnostics ??= {
			server: servers.map(([name]) => name).join(", "),
			messages: [],
			summary: "OK",
			errored: false,
		};
		diagnostics.formatter = formatter;
	}

	return diagnostics;
}

async function flushWritethroughBatch(
	batch: PendingWritethrough[],
	cwd: string,
	options: Required<WritethroughOptions>,
	signal?: AbortSignal,
): Promise<FileDiagnosticsResult | undefined> {
	if (batch.length === 0) {
		return undefined;
	}
	const results: Array<FileDiagnosticsResult | undefined> = [];
	for (const entry of batch) {
		results.push(await runLspWritethrough(entry.dst, entry.content, cwd, options, signal, entry.file));
	}
	return mergeDiagnostics(results, options);
}

/** Create a writethrough callback for LSP aware write operations */
export function createLspWritethrough(cwd: string, options?: WritethroughOptions): WritethroughCallback {
	const resolvedOptions: Required<WritethroughOptions> = {
		enableFormat: options?.enableFormat ?? false,
		enableDiagnostics: options?.enableDiagnostics ?? false,
	};
	if (!resolvedOptions.enableFormat && !resolvedOptions.enableDiagnostics) {
		return writethroughNoop;
	}
	return async (
		dst: string,
		content: string,
		signal?: AbortSignal,
		file?: BunFile,
		batch?: LspWritethroughBatchRequest,
	) => {
		if (!batch) {
			return runLspWritethrough(dst, content, cwd, resolvedOptions, signal, file);
		}

		const state = getOrCreateWritethroughBatch(batch.id, resolvedOptions);
		state.entries.set(dst, { dst, content, file });

		if (!batch.flush) {
			await writethroughNoop(dst, content, signal, file);
			return undefined;
		}

		writethroughBatches.delete(batch.id);
		return flushWritethroughBatch(Array.from(state.entries.values()), cwd, state.options, signal);
	};
}

/**
 * LSP tool for language server protocol operations.
 */
export class LspTool implements AgentTool<typeof lspSchema, LspToolDetails, Theme> {
	readonly name = "lsp";
	readonly label = "LSP";
	readonly description: string;
	readonly parameters = lspSchema;
	readonly renderCall = renderCall;
	readonly renderResult = renderResult;
	readonly mergeCallAndResult = true;
	readonly inline = true;

	constructor(private readonly session: ToolSession) {
		this.description = renderPromptTemplate(lspDescription);
	}

	static createIf(session: ToolSession): LspTool | null {
		return session.enableLsp === false ? null : new LspTool(session);
	}

	async execute(
		_toolCallId: string,
		params: LspParams,
		_signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<LspToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<LspToolDetails>> {
		const { action, file, files, line, column, query, new_name, apply, include_declaration } = params;

		const config = getConfig(this.session.cwd);

		// Status action doesn't need a file
		if (action === "status") {
			const servers = Object.keys(config.servers);
			const lspmuxState = await detectLspmux();
			const lspmuxStatus = lspmuxState.available
				? lspmuxState.running
					? "lspmux: active (multiplexing enabled)"
					: "lspmux: installed but server not running"
				: "";

			const serverStatus =
				servers.length > 0
					? `Active language servers: ${servers.join(", ")}`
					: "No language servers configured for this project";

			const output = lspmuxStatus ? `${serverStatus}\n${lspmuxStatus}` : serverStatus;
			return {
				content: [{ type: "text", text: output }],
				details: { action, success: true, request: params },
			};
		}

		// Diagnostics can be batch or single-file - queries all applicable servers
		if (action === "diagnostics") {
			const targets = files?.length ? files : file ? [file] : null;
			if (!targets) {
				// No file specified - run workspace diagnostics
				const result = await runWorkspaceDiagnostics(this.session.cwd);
				return {
					content: [
						{
							type: "text",
							text: `Workspace diagnostics (${result.projectType.description}):\n${result.output}`,
						},
					],
					details: { action, success: true, request: params },
				};
			}

			const detailed = Boolean(files?.length);
			const results: string[] = [];
			const allServerNames = new Set<string>();

			for (const target of targets) {
				const resolved = resolveToCwd(target, this.session.cwd);
				const servers = getServersForFile(config, resolved);
				if (servers.length === 0) {
					results.push(`${theme.status.error} ${target}: No language server found`);
					continue;
				}

				const uri = fileToUri(resolved);
				const relPath = path.relative(this.session.cwd, resolved);
				const allDiagnostics: Diagnostic[] = [];

				// Query all applicable servers for this file
				for (const [serverName, serverConfig] of servers) {
					allServerNames.add(serverName);
					try {
						if (serverConfig.createClient) {
							const linterClient = getLinterClient(serverName, serverConfig, this.session.cwd);
							const diagnostics = await linterClient.lint(resolved);
							allDiagnostics.push(...diagnostics);
							continue;
						}
						const client = await getOrCreateClient(serverConfig, this.session.cwd);
						const minVersion = client.diagnosticsVersion;
						await refreshFile(client, resolved);
						const diagnostics = await waitForDiagnostics(client, uri, 3000, undefined, minVersion);
						allDiagnostics.push(...diagnostics);
					} catch {
						// Server failed, continue with others
					}
				}

				// Deduplicate diagnostics
				const seen = new Set<string>();
				const uniqueDiagnostics: Diagnostic[] = [];
				for (const d of allDiagnostics) {
					const key = `${d.range.start.line}:${d.range.start.character}:${d.range.end.line}:${d.range.end.character}:${d.message}`;
					if (!seen.has(key)) {
						seen.add(key);
						uniqueDiagnostics.push(d);
					}
				}

				sortDiagnostics(uniqueDiagnostics);

				if (!detailed && targets.length === 1) {
					if (uniqueDiagnostics.length === 0) {
						return {
							content: [{ type: "text", text: "No diagnostics" }],
							details: { action, serverName: Array.from(allServerNames).join(", "), success: true },
						};
					}

					const summary = formatDiagnosticsSummary(uniqueDiagnostics);
					const formatted = uniqueDiagnostics.map(d => formatDiagnostic(d, relPath));
					const output = `${summary}:\n${formatted.map(f => `  ${f}`).join("\n")}`;
					return {
						content: [{ type: "text", text: output }],
						details: { action, serverName: Array.from(allServerNames).join(", "), success: true },
					};
				}

				if (uniqueDiagnostics.length === 0) {
					results.push(`${theme.status.success} ${relPath}: no issues`);
				} else {
					const summary = formatDiagnosticsSummary(uniqueDiagnostics);
					results.push(`${theme.status.error} ${relPath}: ${summary}`);
					for (const diag of uniqueDiagnostics) {
						results.push(`  ${formatDiagnostic(diag, relPath)}`);
					}
				}
			}

			return {
				content: [{ type: "text", text: results.join("\n") }],
				details: { action, serverName: Array.from(allServerNames).join(", "), success: true },
			};
		}

		const requiresFile = !file && action !== "symbols" && action !== "reload";

		if (requiresFile) {
			return {
				content: [{ type: "text", text: "Error: file parameter required for this action" }],
				details: { action, success: false },
			};
		}

		const resolvedFile = file ? resolveToCwd(file, this.session.cwd) : null;
		const serverInfo = resolvedFile
			? getLspServerForFile(config, resolvedFile)
			: getServerForWorkspaceAction(config, action);

		if (!serverInfo) {
			return {
				content: [{ type: "text", text: "No language server found for this action" }],
				details: { action, success: false },
			};
		}

		const [serverName, serverConfig] = serverInfo;

		try {
			const client = await getOrCreateClient(serverConfig, this.session.cwd);
			const targetFile = resolvedFile;

			if (targetFile) {
				await ensureFileOpen(client, targetFile);
			}

			const uri = targetFile ? fileToUri(targetFile) : "";
			const position = { line: (line || 1) - 1, character: (column || 1) - 1 };

			let output: string;

			switch (action) {
				// =====================================================================
				// Standard LSP Operations
				// =====================================================================

				case "definition": {
					const result = (await sendRequest(client, "textDocument/definition", {
						textDocument: { uri },
						position,
					})) as Location | Location[] | LocationLink | LocationLink[] | null;

					if (!result) {
						output = "No definition found";
					} else {
						const raw = Array.isArray(result) ? result : [result];
						const locations = raw.flatMap(loc => {
							if ("uri" in loc) {
								return [loc as Location];
							}
							if ("targetUri" in loc) {
								// Use targetSelectionRange (the precise identifier range) with fallback to targetRange
								const link = loc as LocationLink;
								return [{ uri: link.targetUri, range: link.targetSelectionRange ?? link.targetRange }];
							}
							return [];
						});

						if (locations.length === 0) {
							output = "No definition found";
						} else {
							output = `Found ${locations.length} definition(s):\n${locations
								.map(loc => `  ${formatLocation(loc, this.session.cwd)}`)
								.join("\n")}`;
						}
					}
					break;
				}

				case "references": {
					const result = (await sendRequest(client, "textDocument/references", {
						textDocument: { uri },
						position,
						context: { includeDeclaration: include_declaration ?? true },
					})) as Location[] | null;

					if (!result || result.length === 0) {
						output = "No references found";
					} else {
						const lines = result.map(loc => `  ${formatLocation(loc, this.session.cwd)}`);
						output = `Found ${result.length} reference(s):\n${lines.join("\n")}`;
					}
					break;
				}

				case "hover": {
					const result = (await sendRequest(client, "textDocument/hover", {
						textDocument: { uri },
						position,
					})) as Hover | null;

					if (!result || !result.contents) {
						output = "No hover information";
					} else {
						output = extractHoverText(result.contents);
					}
					break;
				}

				case "symbols": {
					// If no file, do workspace symbol search (requires query)
					if (!targetFile) {
						if (!query) {
							return {
								content: [
									{ type: "text", text: "Error: query parameter required for workspace symbol search" },
								],
								details: { action, serverName, success: false },
							};
						}
						const result = (await sendRequest(client, "workspace/symbol", { query })) as
							| SymbolInformation[]
							| null;
						if (!result || result.length === 0) {
							output = `No symbols matching "${query}"`;
						} else {
							const lines = result.map(s => formatSymbolInformation(s, this.session.cwd));
							output = `Found ${result.length} symbol(s) matching "${query}":\n${lines.map(l => `  ${l}`).join("\n")}`;
						}
					} else {
						// File-based document symbols
						const result = (await sendRequest(client, "textDocument/documentSymbol", {
							textDocument: { uri },
						})) as (DocumentSymbol | SymbolInformation)[] | null;

						if (!result || result.length === 0) {
							output = "No symbols found";
						} else {
							const relPath = path.relative(this.session.cwd, targetFile);
							if ("selectionRange" in result[0]) {
								const lines = (result as DocumentSymbol[]).flatMap(s => formatDocumentSymbol(s));
								output = `Symbols in ${relPath}:\n${lines.join("\n")}`;
							} else {
								const lines = (result as SymbolInformation[]).map(s => {
									const line = s.location.range.start.line + 1;
									const icon = symbolKindToIcon(s.kind);
									return `${icon} ${s.name} @ line ${line}`;
								});
								output = `Symbols in ${relPath}:\n${lines.join("\n")}`;
							}
						}
					}
					break;
				}

				case "rename": {
					if (!new_name) {
						return {
							content: [{ type: "text", text: "Error: new_name parameter required for rename" }],
							details: { action, serverName, success: false },
						};
					}

					const result = (await sendRequest(client, "textDocument/rename", {
						textDocument: { uri },
						position,
						newName: new_name,
					})) as WorkspaceEdit | null;

					if (!result) {
						output = "Rename returned no edits";
					} else {
						const shouldApply = apply !== false;
						if (shouldApply) {
							const applied = await applyWorkspaceEdit(result, this.session.cwd);
							output = `Applied rename:\n${applied.map(a => `  ${a}`).join("\n")}`;
						} else {
							const preview = formatWorkspaceEdit(result, this.session.cwd);
							output = `Rename preview:\n${preview.map(p => `  ${p}`).join("\n")}`;
						}
					}
					break;
				}

				case "reload": {
					// Try graceful reload first, fall back to kill
					output = `Restarted ${serverName}`;
					const reloadMethods = ["rust-analyzer/reloadWorkspace", "workspace/didChangeConfiguration"];
					for (const method of reloadMethods) {
						try {
							await sendRequest(client, method, method.includes("Configuration") ? { settings: {} } : null);
							output = `Reloaded ${serverName}`;
							break;
						} catch {
							// Method not supported, try next
						}
					}
					if (output.startsWith("Restarted")) {
						client.proc.kill();
					}
					break;
				}

				default:
					output = `Unknown action: ${action}`;
			}

			return {
				content: [{ type: "text", text: output }],
				details: { serverName, action, success: true, request: params },
			};
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : String(err);
			return {
				content: [{ type: "text", text: `LSP error: ${errorMessage}` }],
				details: { serverName, action, success: false, request: params },
			};
		}
	}
}
