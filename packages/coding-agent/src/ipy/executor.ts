import * as path from "node:path";
import { getAgentDir, getProjectDir, isBunTestRuntime, isEnoent, logger } from "@oh-my-pi/pi-utils";
import { OutputSink } from "../session/streaming-output";
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

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_KERNEL_SESSIONS = 4;
const CLEANUP_INTERVAL_MS = 30 * 1000; // 30 seconds

export type PythonKernelMode = "session" | "per-call";

export interface PythonExecutorOptions {
	/** Working directory for command execution */
	cwd?: string;
	/** Timeout in milliseconds */
	timeoutMs?: number;
	/** Absolute wall-clock deadline in milliseconds since epoch */
	deadlineMs?: number;
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

interface KernelSessionExecutionOptions {
	useSharedGateway?: boolean;
	sessionFile?: string;
	signal?: AbortSignal;
	deadlineMs?: number;
}

class PythonExecutionCancelledError extends Error {
	readonly timedOut: boolean;

	constructor(timedOut: boolean) {
		super(timedOut ? "Command timed out" : "Command aborted");
		this.name = timedOut ? "TimeoutError" : "AbortError";
		this.timedOut = timedOut;
	}
}

function getExecutionDeadlineMs(options?: Pick<PythonExecutorOptions, "deadlineMs" | "timeoutMs">): number | undefined {
	if (options?.deadlineMs !== undefined) return options.deadlineMs;
	if (options?.timeoutMs === undefined) return undefined;
	return Date.now() + options.timeoutMs;
}

function getRemainingTimeoutMs(deadlineMs?: number): number | undefined {
	if (deadlineMs === undefined) return undefined;
	return deadlineMs - Date.now();
}

function requireRemainingTimeoutMs(deadlineMs?: number): number | undefined {
	const remainingMs = getRemainingTimeoutMs(deadlineMs);
	if (remainingMs === undefined) return undefined;
	if (remainingMs <= 0) {
		throw new PythonExecutionCancelledError(true);
	}
	return remainingMs;
}

function isCancellationError(error: unknown): boolean {
	return (
		error instanceof PythonExecutionCancelledError ||
		(error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) ||
		(error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))
	);
}

function isTimedOutCancellation(error: unknown, signal?: AbortSignal): boolean {
	if (error instanceof PythonExecutionCancelledError) return error.timedOut;
	if (error instanceof DOMException) return error.name === "TimeoutError";
	if (error instanceof Error && error.name === "TimeoutError") return true;
	const reason = signal?.reason;
	if (reason instanceof DOMException) return reason.name === "TimeoutError";
	return reason instanceof Error ? reason.name === "TimeoutError" : false;
}

async function waitForQueueTurn(
	queue: Promise<void>,
	options: Pick<KernelSessionExecutionOptions, "signal" | "deadlineMs">,
): Promise<void> {
	if (options.signal?.aborted) {
		throw new PythonExecutionCancelledError(isTimedOutCancellation(options.signal.reason, options.signal));
	}

	const remainingMs = getRemainingTimeoutMs(options.deadlineMs);
	if (remainingMs !== undefined && remainingMs <= 0) {
		throw new PythonExecutionCancelledError(true);
	}

	if (!options.signal && remainingMs === undefined) {
		await queue;
		return;
	}

	await new Promise<void>((resolve, reject) => {
		const cleanups: Array<() => void> = [];
		const finish = (callback: () => void) => {
			while (cleanups.length > 0) {
				cleanups.pop()?.();
			}
			callback();
		};

		const onAbort = () => {
			finish(() =>
				reject(new PythonExecutionCancelledError(isTimedOutCancellation(options.signal?.reason, options.signal))),
			);
		};

		if (options.signal) {
			options.signal.addEventListener("abort", onAbort, { once: true });
			cleanups.push(() => options.signal?.removeEventListener("abort", onAbort));
		}

		if (remainingMs !== undefined) {
			const timeout = setTimeout(() => {
				finish(() => reject(new PythonExecutionCancelledError(true)));
			}, remainingMs);
			timeout.unref();
			cleanups.push(() => clearTimeout(timeout));
		}

		queue.then(
			() => finish(resolve),
			error => finish(() => reject(error)),
		);
	});
}

function formatTimeoutAnnotation(timeoutMs?: number): string | undefined {
	if (timeoutMs === undefined) return "Command timed out";
	const secs = Math.max(1, Math.round(timeoutMs / 1000));
	return `Command timed out after ${secs} seconds`;
}

function createCancelledPythonResult(timedOut: boolean, timeoutMs?: number): PythonResult {
	const output = timedOut ? (formatTimeoutAnnotation(timeoutMs) ?? "Command timed out") : "";
	const outputBytes = Buffer.byteLength(output, "utf-8");
	const outputLines = output.length > 0 ? 1 : 0;
	return {
		output,
		exitCode: undefined,
		cancelled: true,
		truncated: false,
		totalLines: outputLines,
		totalBytes: outputBytes,
		outputLines,
		outputBytes,
		displayOutputs: [],
		stdinRequested: false,
	};
}

function buildKernelStartOptions(
	cwd: string,
	env: Record<string, string> | undefined,
	options: KernelSessionExecutionOptions,
) {
	return {
		cwd,
		env,
		useSharedGateway: options.useSharedGateway,
		signal: options.signal,
		deadlineMs: options.deadlineMs,
	};
}

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

function getPreludeIntrospectionOptions(
	options: KernelSessionExecutionOptions = {},
): Pick<KernelExecuteOptions, "signal" | "timeoutMs"> {
	return {
		signal: options.signal,
		timeoutMs: requireRemainingTimeoutMs(options.deadlineMs),
	};
}

async function cachePreludeDocs(
	cwd: string,
	docs: PreludeHelper[],
	cacheState?: PreludeCacheState | null,
): Promise<PreludeHelper[]> {
	cachedPreludeDocs = docs;
	if (!isBunTestRuntime() && docs.length > 0) {
		const state = cacheState ?? (await buildPreludeCacheState(cwd));
		await writePreludeCache(state, docs);
	}
	return docs;
}

async function ensurePreludeDocsLoaded(
	kernel: PythonKernel,
	cwd: string,
	options: KernelSessionExecutionOptions = {},
	cacheState?: PreludeCacheState | null,
): Promise<PreludeHelper[]> {
	if (cachedPreludeDocs && cachedPreludeDocs.length > 0) {
		return cachedPreludeDocs;
	}
	const docs = await kernel.introspectPrelude(getPreludeIntrospectionOptions(options));
	if (docs.length === 0) {
		throw new Error("Python prelude helpers unavailable");
	}
	return cachePreludeDocs(cwd, docs, cacheState);
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
	let cacheState: PreludeCacheState | null = null;
	try {
		await logger.time("warmPython:ensureKernelAvailable", ensureKernelAvailable, cwd);
	} catch (err: unknown) {
		const reason = err instanceof Error ? err.message : String(err);
		cachedPreludeDocs = [];
		return { ok: false, reason, docs: [] };
	}
	if (!isBunTestRuntime()) {
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
		const docs = await logger.time(
			"warmPython:withKernelSession",
			withKernelSession,
			resolvedSessionId,
			cwd,
			kernel => ensurePreludeDocsLoaded(kernel, cwd, { useSharedGateway, sessionFile }, cacheState),
			{
				useSharedGateway,
				sessionFile,
			},
		);
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
	options: KernelSessionExecutionOptions = {},
	isRetry?: boolean,
): Promise<KernelSession> {
	requireRemainingTimeoutMs(options.deadlineMs);
	const env: Record<string, string> | undefined = options.sessionFile
		? { PI_SESSION_FILE: options.sessionFile }
		: undefined;
	const startOptions = buildKernelStartOptions(cwd, env, options);

	let kernel: PythonKernel;
	try {
		kernel = await logger.time("createKernelSession:PythonKernel.start", PythonKernel.start, startOptions);
	} catch (err) {
		if (!isRetry && isResourceExhaustionError(err)) {
			await recoverFromResourceExhaustion();
			return createKernelSession(sessionId, cwd, options, true);
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
	options: KernelSessionExecutionOptions = {},
): Promise<void> {
	session.restartCount += 1;
	if (session.restartCount > 1) {
		throw new Error("Python kernel restarted too many times in this session");
	}
	requireRemainingTimeoutMs(options.deadlineMs);
	try {
		await session.kernel.shutdown();
	} catch (err) {
		logger.warn("Failed to shutdown crashed kernel", { error: err instanceof Error ? err.message : String(err) });
	}
	const env: Record<string, string> | undefined = options.sessionFile
		? { PI_SESSION_FILE: options.sessionFile }
		: undefined;
	const startOptions = buildKernelStartOptions(cwd, env, options);
	const kernel = await PythonKernel.start(startOptions);
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
	options: KernelSessionExecutionOptions = {},
): Promise<T> {
	let session = kernelSessions.get(sessionId);
	if (!session) {
		if (kernelSessions.size >= MAX_KERNEL_SESSIONS) {
			await evictOldestSession();
		}
		requireRemainingTimeoutMs(options.deadlineMs);
		if (options.signal?.aborted) {
			throw new PythonExecutionCancelledError(isTimedOutCancellation(options.signal.reason, options.signal));
		}
		session = await logger.time("kernel:createKernelSession", createKernelSession, sessionId, cwd, options);
		kernelSessions.set(sessionId, session);
		startCleanupTimer();
	}

	const run = async (): Promise<T> => {
		session!.lastUsedAt = Date.now();
		if (session!.dead || !session!.kernel.isAlive()) {
			await logger.time("kernel:restartKernelSession", restartKernelSession, session!, cwd, options);
		}
		try {
			const result = await logger.time("kernel:withSession:handler", handler, session!.kernel);
			session!.restartCount = 0;
			return result;
		} catch (err) {
			if (!session!.dead && session!.kernel.isAlive()) {
				throw err;
			}
			await logger.time("kernel:restartKernelSession", restartKernelSession, session!, cwd, options);
			const result = await logger.time("kernel:postRestart:handler", handler, session!.kernel);
			session!.restartCount = 0;
			return result;
		}
	};

	const queue = session.queue;
	let releaseTurn: (() => void) | undefined;
	const turn = new Promise<void>(resolve => {
		releaseTurn = resolve;
	});
	session.queue = queue
		.then(
			() => turn,
			() => turn,
		)
		.then(
			() => undefined,
			() => undefined,
		);

	try {
		await waitForQueueTurn(queue, options);
		return await run();
	} finally {
		releaseTurn?.();
	}
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
	const deadlineMs = getExecutionDeadlineMs(options);
	let executionTimeoutMs: number | undefined;

	try {
		executionTimeoutMs = requireRemainingTimeoutMs(deadlineMs);
		const result = await kernel.execute(code, {
			signal: options?.signal,
			timeoutMs: executionTimeoutMs,
			onChunk: text => sink.push(text),
			onDisplay: output => void displayOutputs.push(output),
		});

		if (result.cancelled) {
			const annotation = result.timedOut ? formatTimeoutAnnotation(executionTimeoutMs) : undefined;
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
		if (isCancellationError(err) || options?.signal?.aborted) {
			const timedOut = isTimedOutCancellation(err, options?.signal);
			return {
				exitCode: undefined,
				cancelled: true,
				displayOutputs,
				stdinRequested: false,
				...(await sink.dump(timedOut ? formatTimeoutAnnotation(executionTimeoutMs) : undefined)),
			};
		}
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
	const cwd = options?.cwd ?? getProjectDir();
	const deadlineMs = getExecutionDeadlineMs(options);
	const executionOptions: PythonExecutorOptions = {
		...(options ?? {}),
		deadlineMs,
	};

	try {
		requireRemainingTimeoutMs(deadlineMs);
		if (executionOptions.signal?.aborted) {
			throw new PythonExecutionCancelledError(
				isTimedOutCancellation(executionOptions.signal.reason, executionOptions.signal),
			);
		}

		await ensureKernelAvailable(cwd);

		const kernelMode = executionOptions.kernelMode ?? "session";
		const sessionFile = executionOptions.sessionFile;

		if (kernelMode === "per-call") {
			const env: Record<string, string> | undefined = sessionFile ? { PI_SESSION_FILE: sessionFile } : undefined;
			requireRemainingTimeoutMs(deadlineMs);
			const startOptions = buildKernelStartOptions(cwd, env, executionOptions);
			const kernel = await PythonKernel.start(startOptions);
			try {
				return await executeWithKernel(kernel, code, executionOptions);
			} finally {
				await kernel.shutdown();
			}
		}

		const sessionId = executionOptions.sessionId ?? `session:${cwd}`;
		if (executionOptions.reset) {
			const existing = kernelSessions.get(sessionId);
			if (existing) {
				await disposeKernelSession(existing);
			}
		}
		return await withKernelSession(
			sessionId,
			cwd,
			async kernel => executeWithKernel(kernel, code, executionOptions),
			executionOptions,
		);
	} catch (err) {
		if (isCancellationError(err) || executionOptions.signal?.aborted) {
			return createCancelledPythonResult(isTimedOutCancellation(err, executionOptions.signal));
		}
		throw err;
	}
}
