import { logger } from "@oh-my-pi/pi-utils";
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
	try {
		await ensureKernelAvailable(cwd);
		time("warmPython:ensureKernelAvailable");
	} catch (err: unknown) {
		const reason = err instanceof Error ? err.message : String(err);
		cachedPreludeDocs = [];
		return { ok: false, reason, docs: [] };
	}
	if (cachedPreludeDocs && cachedPreludeDocs.length > 0) {
		return { ok: true, docs: cachedPreludeDocs };
	}
	const resolvedSessionId = sessionId ?? `session:${cwd}`;
	try {
		const docs = await withKernelSession(
			resolvedSessionId,
			cwd,
			async kernel => kernel.introspectPrelude(),
			useSharedGateway,
			sessionFile,
		);
		time("warmPython:withKernelSession");
		cachedPreludeDocs = docs;
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
	const env: Record<string, string> | undefined =
		sessionFile || artifactsDir
			? {
					...(sessionFile ? { OMP_SESSION_FILE: sessionFile } : {}),
					...(artifactsDir ? { ARTIFACTS: artifactsDir } : {}),
				}
			: undefined;

	let kernel: PythonKernel;
	try {
		kernel = await PythonKernel.start({ cwd, useSharedGateway, env });
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

	session.heartbeatTimer = setInterval(async () => {
		if (session.dead) return;
		const ok = await session.kernel.ping().catch(() => false);
		if (!ok) {
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
					...(sessionFile ? { OMP_SESSION_FILE: sessionFile } : {}),
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
	let session = kernelSessions.get(sessionId);
	if (!session) {
		// Evict oldest session if at capacity
		if (kernelSessions.size >= MAX_KERNEL_SESSIONS) {
			await evictOldestSession();
		}
		session = await createKernelSession(sessionId, cwd, useSharedGateway, sessionFile, artifactsDir);
		kernelSessions.set(sessionId, session);
		startCleanupTimer();
	}

	const run = async (): Promise<T> => {
		session!.lastUsedAt = Date.now();
		if (session!.dead || !session!.kernel.isAlive()) {
			await restartKernelSession(session!, cwd, useSharedGateway, sessionFile, artifactsDir);
		}
		try {
			const result = await handler(session!.kernel);
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
						...(sessionFile ? { OMP_SESSION_FILE: sessionFile } : {}),
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
