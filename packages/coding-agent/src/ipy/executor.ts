import * as path from "node:path";
import { $env, isEnoent, logger } from "@oh-my-pi/pi-utils";
import { getAgentDir } from "../config";
import { OutputSink } from "../session/streaming-output";
import { time } from "../utils/timings";
import { shutdownSharedGateway } from "./gateway-coordinator";
import {
	checkPythonKernelAvailability,
	type KernelDisplayOutput,
	type KernelExecuteOptions,
	type KernelExecuteResult,
	type PreludeHelper,
	PythonKernel,
} from "./kernel";
import { discoverPythonModules } from "./modules";
import { PYTHON_PRELUDE } from "./prelude";

const debugStartup = $env.PI_DEBUG_STARTUP ? (stage: string) => process.stderr.write(`[startup] ${stage}\n`) : () => {};

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_KERNEL_SESSIONS = 4;
const CLEANUP_INTERVAL_MS = 30 * 1000; // 30 seconds

export type PythonKernelMode = "session" | "per-call";

export interface PythonExecutorOptions {
	/** Working directory for command execution */
	cwd?: string;
	/** Timeout in milliseconds */
	timeoutMs?: number;
	/** Callback for streaming output chunks (already sanitized) */
	onChunk?: (chunk: string) => Promise<void> | void;
	/** AbortSignal for cancellation */
	signal?: AbortSignal;
	/** Session identifier for kernel reuse */
	sessionId?: string;
	/** Kernel mode (session reuse vs per-call) */
	kernelMode?: PythonKernelMode;
	/** Restart the kernel before executing */
	reset?: boolean;
	/** Use shared gateway across pi instances (default: true) */
	useSharedGateway?: boolean;
	/** Session file path for accessing task outputs */
	sessionFile?: string;
	/** Artifacts directory for $ARTIFACTS env var and artifact storage */
	artifactsDir?: string;
	/** Artifact path/id for full output storage */
	artifactPath?: string;
	artifactId?: string;
}

export interface PythonKernelExecutor {
	execute: (code: string, options?: KernelExecuteOptions) => Promise<KernelExecuteResult>;
}

export interface PythonResult {
	/** Combined stdout + stderr output (sanitized, possibly truncated) */
	output: string;
	/** Execution exit code (0 ok, 1 error, undefined if cancelled) */
	exitCode: number | undefined;
	/** Whether the execution was cancelled via signal */
	cancelled: boolean;
	/** Whether the output was truncated */
	truncated: boolean;
	/** Artifact ID if full output was saved to artifact storage */
	artifactId?: string;
	/** Total number of lines in the output stream */
	totalLines: number;
	/** Total number of bytes in the output stream */
	totalBytes: number;
	/** Number of lines included in the output text */
	outputLines: number;
	/** Number of bytes included in the output text */
	outputBytes: number;
	/** Rich display outputs captured from display_data/execute_result */
	displayOutputs: KernelDisplayOutput[];
	/** Whether stdin was requested */
	stdinRequested: boolean;
}

interface KernelSession {
	id: string;
	kernel: PythonKernel;
	queue: Promise<void>;
	restartCount: number;
	dead: boolean;
	lastUsedAt: number;
	heartbeatTimer?: NodeJS.Timeout;
}

const kernelSessions = new Map<string, KernelSession>();
let cachedPreludeDocs: PreludeHelper[] | null = null;
let cleanupTimer: NodeJS.Timeout | null = null;

interface PreludeCacheSource {
	path: string;
	hash: string;
}

interface PreludeCachePayload {
	helpers: PreludeHelper[];
	sources: PreludeCacheSource[];
}

interface PreludeCacheState {
	cacheKey: string;
	cachePath: string;
	sources: PreludeCacheSource[];
}

const PRELUDE_CACHE_DIR = "pycache";

function hashPreludeContent(content: string): string {
	return Bun.hash(content).toString(16);
}

async function buildPreludeCacheState(cwd: string): Promise<PreludeCacheState> {
	const modules = await discoverPythonModules({ cwd });
	const moduleSources = modules
		.map(module => ({ path: module.path, hash: hashPreludeContent(module.content) }))
		.sort((a, b) => a.path.localeCompare(b.path));
	const sources: PreludeCacheSource[] = [
		{ path: "omp:prelude", hash: hashPreludeContent(PYTHON_PRELUDE) },
		...moduleSources,
	];
	const composite = sources.map(source => `${source.path}:${source.hash}`).join("|");
	const cacheKey = Bun.hash(composite).toString(16);
	const cachePath = path.join(getAgentDir(), PRELUDE_CACHE_DIR, `${cacheKey}.json`);
	return { cacheKey, cachePath, sources };
}

async function readPreludeCache(state: PreludeCacheState): Promise<PreludeHelper[] | null> {
	let raw: string;
	try {
		raw = await Bun.file(state.cachePath).text();
	} catch (err) {
		if (isEnoent(err)) return null;
		logger.warn("Failed to read Python prelude cache", { path: state.cachePath, error: String(err) });
		return null;
	}
	try {
		const parsed = JSON.parse(raw) as PreludeCachePayload | PreludeHelper[];
		const helpers = Array.isArray(parsed) ? parsed : parsed.helpers;
		if (!Array.isArray(helpers) || helpers.length === 0) return null;
		return helpers;
	} catch (err) {
		logger.warn("Failed to parse Python prelude cache", { path: state.cachePath, error: String(err) });
		return null;
	}
}

async function writePreludeCache(state: PreludeCacheState, helpers: PreludeHelper[]): Promise<void> {
	const payload: PreludeCachePayload = { helpers, sources: state.sources };
	try {
		await Bun.write(state.cachePath, JSON.stringify(payload));
	} catch (err) {
		logger.warn("Failed to write Python prelude cache", { path: state.cachePath, error: String(err) });
	}
}

function startCleanupTimer(): void {
	if (cleanupTimer) return;
	cleanupTimer = setInterval(() => {
		void cleanupIdleSessions();
	}, CLEANUP_INTERVAL_MS);
	cleanupTimer.unref();
}

function stopCleanupTimer(): void {
	if (cleanupTimer) {
		clearInterval(cleanupTimer);
		cleanupTimer = null;
	}
}

async function cleanupIdleSessions(): Promise<void> {
	const now = Date.now();
	const toDispose: KernelSession[] = [];

	for (const session of kernelSessions.values()) {
		if (session.dead || now - session.lastUsedAt > IDLE_TIMEOUT_MS) {
			toDispose.push(session);
		}
	}

	if (toDispose.length > 0) {
		logger.debug("Cleaning up idle kernel sessions", { count: toDispose.length });
		await Promise.allSettled(toDispose.map(session => disposeKernelSession(session)));
	}

	if (kernelSessions.size === 0) {
		stopCleanupTimer();
	}
}

async function evictOldestSession(): Promise<void> {
	let oldest: KernelSession | null = null;
	for (const session of kernelSessions.values()) {
		if (!oldest || session.lastUsedAt < oldest.lastUsedAt) {
			oldest = session;
		}
	}
	if (oldest) {
		logger.debug("Evicting oldest kernel session", { id: oldest.id });
		await disposeKernelSession(oldest);
	}
}

export async function disposeAllKernelSessions(): Promise<void> {
	stopCleanupTimer();
	const sessions = Array.from(kernelSessions.values());
	await Promise.allSettled(sessions.map(session => disposeKernelSession(session)));
}

async function ensureKernelAvailable(cwd: string): Promise<void> {
	const availability = await checkPythonKernelAvailability(cwd);
	if (!availability.ok) {
		throw new Error(availability.reason ?? "Python kernel unavailable");
	}
}

export async function warmPythonEnvironment(
	cwd: string,
	sessionId?: string,
	useSharedGateway?: boolean,
	sessionFile?: string,
): Promise<{ ok: boolean; reason?: string; docs: PreludeHelper[] }> {
	const isTestEnv = process.env.BUN_ENV === "test" || process.env.NODE_ENV === "test";
	let cacheState: PreludeCacheState | null = null;
	try {
		debugStartup("warmPython:ensureKernel:start");
		await ensureKernelAvailable(cwd);
		debugStartup("warmPython:ensureKernel:done");
		time("warmPython:ensureKernelAvailable");
	} catch (err: unknown) {
		const reason = err instanceof Error ? err.message : String(err);
		cachedPreludeDocs = [];
		return { ok: false, reason, docs: [] };
	}
	if (!isTestEnv) {
		try {
			cacheState = await buildPreludeCacheState(cwd);
			const cached = await readPreludeCache(cacheState);
			if (cached) {
				cachedPreludeDocs = cached;
				return { ok: true, docs: cached };
			}
		} catch (err) {
			logger.warn("Failed to resolve Python prelude cache", { error: String(err) });
			cacheState = null;
		}
	}
	if (cachedPreludeDocs && cachedPreludeDocs.length > 0) {
		return { ok: true, docs: cachedPreludeDocs };
	}
	const resolvedSessionId = sessionId ?? `session:${cwd}`;
	try {
		debugStartup("warmPython:withKernelSession:start");
		const docs = await withKernelSession(
			resolvedSessionId,
			cwd,
			async kernel => kernel.introspectPrelude(),
			useSharedGateway,
			sessionFile,
		);
		debugStartup("warmPython:withKernelSession:done");
		time("warmPython:withKernelSession");
		cachedPreludeDocs = docs;
		if (!isTestEnv && docs.length > 0) {
			const state = cacheState ?? (await buildPreludeCacheState(cwd));
			await writePreludeCache(state, docs);
		}
		return { ok: true, docs };
	} catch (err: unknown) {
		const reason = err instanceof Error ? err.message : String(err);
		cachedPreludeDocs = [];
		return { ok: false, reason, docs: [] };
	}
}

export function getPreludeDocs(): PreludeHelper[] {
	return cachedPreludeDocs ?? [];
}

export function setPreludeDocsCache(docs: PreludeHelper[]): void {
	cachedPreludeDocs = docs;
}

export function resetPreludeDocsCache(): void {
	cachedPreludeDocs = null;
}

function isResourceExhaustionError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return (
		message.includes("Too many open files") ||
		message.includes("EMFILE") ||
		message.includes("ENFILE") ||
		message.includes("resource temporarily unavailable")
	);
}

async function recoverFromResourceExhaustion(): Promise<void> {
	logger.warn("Resource exhaustion detected, recovering by restarting shared gateway");
	stopCleanupTimer();
	const sessions = Array.from(kernelSessions.values());
	for (const session of sessions) {
		if (session.heartbeatTimer) {
			clearInterval(session.heartbeatTimer);
		}
		kernelSessions.delete(session.id);
	}
	await shutdownSharedGateway();
}

async function createKernelSession(
	sessionId: string,
	cwd: string,
	useSharedGateway?: boolean,
	sessionFile?: string,
	artifactsDir?: string,
	isRetry?: boolean,
): Promise<KernelSession> {
	debugStartup("kernel:createSession:entry");
	const env: Record<string, string> | undefined =
		sessionFile || artifactsDir
			? {
					...(sessionFile ? { PI_SESSION_FILE: sessionFile } : {}),
					...(artifactsDir ? { ARTIFACTS: artifactsDir } : {}),
				}
			: undefined;

	let kernel: PythonKernel;
	try {
		debugStartup("kernel:PythonKernel.start:start");
		kernel = await PythonKernel.start({ cwd, useSharedGateway, env });
		debugStartup("kernel:PythonKernel.start:done");
		time("createKernelSession:PythonKernel.start");
	} catch (err) {
		if (!isRetry && isResourceExhaustionError(err)) {
			await recoverFromResourceExhaustion();
			return createKernelSession(sessionId, cwd, useSharedGateway, sessionFile, artifactsDir, true);
		}
		throw err;
	}

	const session: KernelSession = {
		id: sessionId,
		kernel,
		queue: Promise.resolve(),
		restartCount: 0,
		dead: false,
		lastUsedAt: Date.now(),
	};

	session.heartbeatTimer = setInterval(() => {
		if (session.dead) return;
		if (!session.kernel.isAlive()) {
			session.dead = true;
		}
	}, 5000);

	return session;
}

async function restartKernelSession(
	session: KernelSession,
	cwd: string,
	useSharedGateway?: boolean,
	sessionFile?: string,
	artifactsDir?: string,
): Promise<void> {
	session.restartCount += 1;
	if (session.restartCount > 1) {
		throw new Error("Python kernel restarted too many times in this session");
	}
	try {
		await session.kernel.shutdown();
	} catch (err) {
		logger.warn("Failed to shutdown crashed kernel", { error: err instanceof Error ? err.message : String(err) });
	}
	const env: Record<string, string> | undefined =
		sessionFile || artifactsDir
			? {
					...(sessionFile ? { PI_SESSION_FILE: sessionFile } : {}),
					...(artifactsDir ? { ARTIFACTS: artifactsDir } : {}),
				}
			: undefined;
	const kernel = await PythonKernel.start({ cwd, useSharedGateway, env });
	session.kernel = kernel;
	session.dead = false;
	session.lastUsedAt = Date.now();
}

async function disposeKernelSession(session: KernelSession): Promise<void> {
	if (session.heartbeatTimer) {
		clearInterval(session.heartbeatTimer);
	}
	try {
		await session.kernel.shutdown();
	} catch (err) {
		logger.warn("Failed to shutdown kernel", { error: err instanceof Error ? err.message : String(err) });
	}
	kernelSessions.delete(session.id);
}

async function withKernelSession<T>(
	sessionId: string,
	cwd: string,
	handler: (kernel: PythonKernel) => Promise<T>,
	useSharedGateway?: boolean,
	sessionFile?: string,
	artifactsDir?: string,
): Promise<T> {
	debugStartup("kernel:withSession:entry");
	let session = kernelSessions.get(sessionId);
	if (!session) {
		// Evict oldest session if at capacity
		if (kernelSessions.size >= MAX_KERNEL_SESSIONS) {
			await evictOldestSession();
		}
		session = await createKernelSession(sessionId, cwd, useSharedGateway, sessionFile, artifactsDir);
		debugStartup("kernel:withSession:created");
		kernelSessions.set(sessionId, session);
		startCleanupTimer();
	}

	const run = async (): Promise<T> => {
		debugStartup("kernel:withSession:run");
		session!.lastUsedAt = Date.now();
		if (session!.dead || !session!.kernel.isAlive()) {
			await restartKernelSession(session!, cwd, useSharedGateway, sessionFile, artifactsDir);
		}
		try {
			debugStartup("kernel:withSession:handler:start");
			const result = await handler(session!.kernel);
			debugStartup("kernel:withSession:handler:done");
			session!.restartCount = 0;
			return result;
		} catch (err) {
			if (!session!.dead && session!.kernel.isAlive()) {
				throw err;
			}
			await restartKernelSession(session!, cwd, useSharedGateway, sessionFile, artifactsDir);
			const result = await handler(session!.kernel);
			session!.restartCount = 0;
			return result;
		}
	};

	const task = session.queue.then(run, run);
	session.queue = task.then(
		() => undefined,
		() => undefined,
	);
	return task;
}

async function executeWithKernel(
	kernel: PythonKernelExecutor,
	code: string,
	options: PythonExecutorOptions | undefined,
): Promise<PythonResult> {
	const sink = new OutputSink({
		onChunk: options?.onChunk,
		artifactPath: options?.artifactPath,
		artifactId: options?.artifactId,
	});
	const displayOutputs: KernelDisplayOutput[] = [];

	try {
		const result = await kernel.execute(code, {
			signal: options?.signal,
			timeoutMs: options?.timeoutMs,
			onChunk: text => sink.push(text),
			onDisplay: output => void displayOutputs.push(output),
		});

		if (result.cancelled) {
			const secs = options?.timeoutMs ? Math.round(options.timeoutMs / 1000) : undefined;
			const annotation =
				result.timedOut && secs !== undefined ? `Command timed out after ${secs} seconds` : undefined;
			return {
				exitCode: undefined,
				cancelled: true,
				displayOutputs,
				stdinRequested: result.stdinRequested,
				...(await sink.dump(annotation)),
			};
		}

		if (result.stdinRequested) {
			return {
				exitCode: 1,
				cancelled: false,
				displayOutputs,
				stdinRequested: true,
				...(await sink.dump("Kernel requested stdin; interactive input is not supported.")),
			};
		}

		const exitCode = result.status === "ok" ? 0 : 1;
		return {
			exitCode,
			cancelled: false,
			displayOutputs,
			stdinRequested: false,
			...(await sink.dump()),
		};
	} catch (err) {
		const error = err instanceof Error ? err : new Error(String(err));
		logger.error("Python execution failed", { error: error.message });
		throw error;
	}
}

export async function executePythonWithKernel(
	kernel: PythonKernelExecutor,
	code: string,
	options?: PythonExecutorOptions,
): Promise<PythonResult> {
	return await executeWithKernel(kernel, code, options);
}

export async function executePython(code: string, options?: PythonExecutorOptions): Promise<PythonResult> {
	const cwd = options?.cwd ?? process.cwd();
	await ensureKernelAvailable(cwd);

	const kernelMode = options?.kernelMode ?? "session";
	const useSharedGateway = options?.useSharedGateway;
	const sessionFile = options?.sessionFile;
	const artifactsDir = options?.artifactsDir;

	if (kernelMode === "per-call") {
		const env: Record<string, string> | undefined =
			sessionFile || artifactsDir
				? {
						...(sessionFile ? { PI_SESSION_FILE: sessionFile } : {}),
						...(artifactsDir ? { ARTIFACTS: artifactsDir } : {}),
					}
				: undefined;
		const kernel = await PythonKernel.start({ cwd, useSharedGateway, env });
		try {
			return await executeWithKernel(kernel, code, options);
		} finally {
			await kernel.shutdown();
		}
	}

	const sessionId = options?.sessionId ?? `session:${cwd}`;
	if (options?.reset) {
		const existing = kernelSessions.get(sessionId);
		if (existing) {
			await disposeKernelSession(existing);
		}
	}
	return await withKernelSession(
		sessionId,
		cwd,
		async kernel => executeWithKernel(kernel, code, options),
		useSharedGateway,
		sessionFile,
		artifactsDir,
	);
}
