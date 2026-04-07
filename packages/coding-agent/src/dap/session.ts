import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { DapClient } from "./client";
import type {
	DapAttachArguments,
	DapAttachSessionOptions,
	DapBreakpoint,
	DapBreakpointRecord,
	DapCapabilities,
	DapContinueArguments,
	DapContinueOutcome,
	DapContinueResponse,
	DapEvaluateArguments,
	DapEvaluateResponse,
	DapExitedEventBody,
	DapFunctionBreakpoint,
	DapFunctionBreakpointRecord,
	DapInitializeArguments,
	DapLaunchArguments,
	DapLaunchSessionOptions,
	DapOutputEventBody,
	DapPauseArguments,
	DapResolvedAdapter,
	DapScopesArguments,
	DapScopesResponse,
	DapSessionStatus,
	DapSessionSummary,
	DapSourceBreakpoint,
	DapStackFrame,
	DapStackTraceArguments,
	DapStackTraceResponse,
	DapStepArguments,
	DapStopLocation,
	DapStoppedEventBody,
	DapThread,
	DapThreadsResponse,
	DapVariablesArguments,
	DapVariablesResponse,
} from "./types";

interface DapSession {
	id: string;
	adapter: DapResolvedAdapter;
	cwd: string;
	program?: string;
	client: DapClient;
	status: DapSessionStatus;
	launchedAt: number;
	lastUsedAt: number;
	breakpoints: Map<string, DapBreakpointRecord[]>;
	functionBreakpoints: DapFunctionBreakpointRecord[];
	output: string;
	outputBytes: number;
	outputTruncated: boolean;
	stop: DapStopLocation;
	threads: DapThread[];
	lastStackFrames: DapStackFrame[];
	exitCode?: number;
	capabilities?: DapCapabilities;
	initializedSeen: boolean;
	needsConfigurationDone: boolean;
	configurationDoneSent: boolean;
}

interface DapEventWaitOptions {
	timeoutMs: number;
	signal?: AbortSignal;
}

export interface DapOutputSnapshot {
	snapshot: DapSessionSummary;
	output: string;
}

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 30 * 1000;
const HEARTBEAT_INTERVAL_MS = 5 * 1000;
const MAX_OUTPUT_BYTES = 128 * 1024;
const STOP_CAPTURE_TIMEOUT_MS = 5_000;

function toErrorMessage(value: unknown): string {
	if (value instanceof Error) return value.message;
	return String(value);
}

function normalizePath(filePath: string): string {
	return path.resolve(filePath);
}

function truncateOutput(session: DapSession, output: string): void {
	if (!output) return;
	session.output += output;
	session.outputBytes += Buffer.byteLength(output, "utf-8");
	while (Buffer.byteLength(session.output, "utf-8") > MAX_OUTPUT_BYTES) {
		session.output = session.output.slice(Math.min(1024, session.output.length));
		session.outputTruncated = true;
	}
}

function summarizeBreakpointCount(breakpoints: Map<string, DapBreakpointRecord[]>): number {
	let total = 0;
	for (const entries of breakpoints.values()) {
		total += entries.length;
	}
	return total;
}

function buildSummary(session: DapSession): DapSessionSummary {
	return {
		id: session.id,
		adapter: session.adapter.name,
		cwd: session.cwd,
		program: session.program,
		status: session.status,
		launchedAt: new Date(session.launchedAt).toISOString(),
		lastUsedAt: new Date(session.lastUsedAt).toISOString(),
		threadId: session.stop.threadId,
		frameId: session.stop.frameId,
		stopReason: session.stop.reason,
		stopDescription: session.stop.description ?? session.stop.text,
		frameName: session.stop.frameName,
		source: session.stop.source,
		line: session.stop.line,
		column: session.stop.column,
		breakpointFiles: session.breakpoints.size,
		breakpointCount: summarizeBreakpointCount(session.breakpoints),
		functionBreakpointCount: session.functionBreakpoints.length,
		outputBytes: session.outputBytes,
		outputTruncated: session.outputTruncated,
		exitCode: session.exitCode,
		needsConfigurationDone: session.needsConfigurationDone && !session.configurationDoneSent,
	};
}

async function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return promise;
	if (signal.aborted) {
		throw signal.reason instanceof Error ? signal.reason : new Error("Operation aborted");
	}
	const { promise: abortPromise, reject } = Promise.withResolvers<never>();
	const onAbort = () => {
		reject(signal.reason instanceof Error ? signal.reason : new Error("Operation aborted"));
	};
	signal.addEventListener("abort", onAbort, { once: true });
	try {
		return await Promise.race([promise, abortPromise]);
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
}

export class DapSessionManager {
	#sessions = new Map<string, DapSession>();
	#activeSessionId: string | null = null;
	#cleanupTimer?: NodeJS.Timeout;
	#nextId = 0;

	constructor() {
		this.#startCleanupTimer();
	}

	getActiveSession(): DapSessionSummary | null {
		const session = this.#getActiveSessionOrNull();
		return session ? buildSummary(session) : null;
	}

	listSessions(): DapSessionSummary[] {
		return Array.from(this.#sessions.values()).map(buildSummary);
	}

	async launch(
		options: DapLaunchSessionOptions,
		signal?: AbortSignal,
		timeoutMs: number = 30_000,
	): Promise<DapSessionSummary> {
		await this.#ensureLaunchSlot();
		const client = await DapClient.spawn({ adapter: options.adapter, cwd: options.cwd });
		const session = this.#registerSession(client, options.adapter, options.cwd, options.program);
		try {
			session.capabilities = await client.initialize(
				this.#buildInitializeArguments(options.adapter),
				signal,
				timeoutMs,
			);
			session.needsConfigurationDone = session.capabilities.supportsConfigurationDoneRequest === true;
			const launchArguments: DapLaunchArguments = {
				...options.adapter.launchDefaults,
				program: options.program,
				cwd: options.cwd,
				args: options.args,
			};
			// DAP spec: many adapters do not respond to launch until after
			// configurationDone. Fire launch, complete the config handshake,
			// then await the launch response.
			const launchPromise = client.sendRequest("launch", launchArguments, signal, timeoutMs);
			await this.#completeConfigurationHandshake(session, signal, timeoutMs);
			await launchPromise;
			await this.#captureInitialState(session, {
				timeoutMs: Math.min(timeoutMs, STOP_CAPTURE_TIMEOUT_MS),
				signal,
			});
			return buildSummary(session);
		} catch (error) {
			await this.#disposeSession(session);
			throw error;
		}
	}

	async attach(
		options: DapAttachSessionOptions,
		signal?: AbortSignal,
		timeoutMs: number = 30_000,
	): Promise<DapSessionSummary> {
		await this.#ensureLaunchSlot();
		const client = await DapClient.spawn({ adapter: options.adapter, cwd: options.cwd });
		const session = this.#registerSession(client, options.adapter, options.cwd);
		try {
			session.capabilities = await client.initialize(
				this.#buildInitializeArguments(options.adapter),
				signal,
				timeoutMs,
			);
			session.needsConfigurationDone = session.capabilities.supportsConfigurationDoneRequest === true;
			const attachArguments: DapAttachArguments = {
				...options.adapter.attachDefaults,
				cwd: options.cwd,
				...(options.pid !== undefined ? { pid: options.pid, processId: options.pid } : {}),
				...(options.port !== undefined ? { port: options.port } : {}),
				...(options.host ? { host: options.host } : {}),
			};
			const attachPromise = client.sendRequest("attach", attachArguments, signal, timeoutMs);
			await this.#completeConfigurationHandshake(session, signal, timeoutMs);
			await attachPromise;
			await this.#captureInitialState(session, {
				timeoutMs: Math.min(timeoutMs, STOP_CAPTURE_TIMEOUT_MS),
				signal,
			});
			return buildSummary(session);
		} catch (error) {
			await this.#disposeSession(session);
			throw error;
		}
	}

	async setBreakpoint(
		file: string,
		line: number,
		condition?: string,
		signal?: AbortSignal,
		timeoutMs: number = 30_000,
	) {
		const session = this.#touchActiveSession();
		const sourcePath = normalizePath(file);
		const current = [...(session.breakpoints.get(sourcePath) ?? [])];
		const deduped = current.filter(entry => entry.line !== line);
		deduped.push({ verified: false, line, condition });
		deduped.sort((left, right) => left.line - right.line);
		const response = await this.#sendRequestWithConfig<{ breakpoints?: DapBreakpoint[] }>(
			session,
			"setBreakpoints",
			{
				source: { path: sourcePath, name: path.basename(sourcePath) },
				breakpoints: deduped.map<DapSourceBreakpoint>(entry => ({
					line: entry.line,
					...(entry.condition ? { condition: entry.condition } : {}),
				})),
			},
			signal,
			timeoutMs,
		);
		session.breakpoints.set(sourcePath, this.#mapSourceBreakpoints(deduped, response?.breakpoints));
		return {
			snapshot: buildSummary(session),
			breakpoints: session.breakpoints.get(sourcePath) ?? [],
			sourcePath,
		};
	}

	async removeBreakpoint(file: string, line: number, signal?: AbortSignal, timeoutMs: number = 30_000) {
		const session = this.#touchActiveSession();
		const sourcePath = normalizePath(file);
		const current = [...(session.breakpoints.get(sourcePath) ?? [])].filter(entry => entry.line !== line);
		const response = await this.#sendRequestWithConfig<{ breakpoints?: DapBreakpoint[] }>(
			session,
			"setBreakpoints",
			{
				source: { path: sourcePath, name: path.basename(sourcePath) },
				breakpoints: current.map<DapSourceBreakpoint>(entry => ({
					line: entry.line,
					...(entry.condition ? { condition: entry.condition } : {}),
				})),
			},
			signal,
			timeoutMs,
		);
		if (current.length === 0) {
			session.breakpoints.delete(sourcePath);
		} else {
			session.breakpoints.set(sourcePath, this.#mapSourceBreakpoints(current, response?.breakpoints));
		}
		return {
			snapshot: buildSummary(session),
			breakpoints: session.breakpoints.get(sourcePath) ?? [],
			sourcePath,
		};
	}

	async setFunctionBreakpoint(name: string, condition?: string, signal?: AbortSignal, timeoutMs: number = 30_000) {
		const session = this.#touchActiveSession();
		const current = session.functionBreakpoints.filter(entry => entry.name !== name);
		current.push({ verified: false, name, condition });
		current.sort((left, right) => left.name.localeCompare(right.name));
		const response = await this.#sendRequestWithConfig<{ breakpoints?: DapBreakpoint[] }>(
			session,
			"setFunctionBreakpoints",
			{
				breakpoints: current.map<DapFunctionBreakpoint>(entry => ({
					name: entry.name,
					...(entry.condition ? { condition: entry.condition } : {}),
				})),
			},
			signal,
			timeoutMs,
		);
		session.functionBreakpoints = this.#mapFunctionBreakpoints(current, response?.breakpoints);
		return { snapshot: buildSummary(session), breakpoints: session.functionBreakpoints };
	}

	async removeFunctionBreakpoint(name: string, signal?: AbortSignal, timeoutMs: number = 30_000) {
		const session = this.#touchActiveSession();
		const current = session.functionBreakpoints.filter(entry => entry.name !== name);
		const response = await this.#sendRequestWithConfig<{ breakpoints?: DapBreakpoint[] }>(
			session,
			"setFunctionBreakpoints",
			{
				breakpoints: current.map<DapFunctionBreakpoint>(entry => ({
					name: entry.name,
					...(entry.condition ? { condition: entry.condition } : {}),
				})),
			},
			signal,
			timeoutMs,
		);
		session.functionBreakpoints = this.#mapFunctionBreakpoints(current, response?.breakpoints);
		return { snapshot: buildSummary(session), breakpoints: session.functionBreakpoints };
	}

	async continue(signal?: AbortSignal, timeoutMs: number = 30_000): Promise<DapContinueOutcome> {
		const session = this.#touchActiveSession();
		const threadId = await this.#resolveThreadId(session, signal, timeoutMs);
		await this.#sendRequestWithConfig<DapContinueResponse>(
			session,
			"continue",
			{ threadId } satisfies DapContinueArguments,
			signal,
			timeoutMs,
		);
		session.status = "running";
		session.stop = {};
		return this.#waitForStopOutcome(session, signal, timeoutMs);
	}

	async pause(signal?: AbortSignal, timeoutMs: number = 30_000): Promise<DapSessionSummary> {
		const session = this.#touchActiveSession();
		if (session.status === "stopped") {
			return buildSummary(session);
		}
		const threadId = await this.#resolveThreadId(session, signal, timeoutMs);
		await this.#sendRequestWithConfig(session, "pause", { threadId } satisfies DapPauseArguments, signal, timeoutMs);
		// The stopped event may already have been processed by #handleStoppedEvent
		// between the request and here. Wait for it, but tolerate timeout if the
		// session already transitioned.
		try {
			await raceAbort(
				session.client.waitForEvent<DapStoppedEventBody>("stopped", undefined, signal, timeoutMs),
				signal,
			);
		} catch {
			// Timeout or abort — report current state regardless
		}
		return buildSummary(session);
	}

	async stepIn(signal?: AbortSignal, timeoutMs: number = 30_000): Promise<DapContinueOutcome> {
		return this.#step("stepIn", signal, timeoutMs);
	}

	async stepOut(signal?: AbortSignal, timeoutMs: number = 30_000): Promise<DapContinueOutcome> {
		return this.#step("stepOut", signal, timeoutMs);
	}

	async stepOver(signal?: AbortSignal, timeoutMs: number = 30_000): Promise<DapContinueOutcome> {
		return this.#step("next", signal, timeoutMs);
	}

	async threads(
		signal?: AbortSignal,
		timeoutMs: number = 30_000,
	): Promise<{ snapshot: DapSessionSummary; threads: DapThread[] }> {
		const session = this.#touchActiveSession();
		const response = await this.#sendRequestWithConfig<DapThreadsResponse>(
			session,
			"threads",
			undefined,
			signal,
			timeoutMs,
		);
		session.threads = response?.threads ?? [];
		return { snapshot: buildSummary(session), threads: session.threads };
	}

	async stackTrace(
		frameCount: number | undefined,
		signal?: AbortSignal,
		timeoutMs: number = 30_000,
	): Promise<{ snapshot: DapSessionSummary; stackFrames: DapStackFrame[]; totalFrames?: number }> {
		const session = this.#touchActiveSession();
		const threadId = await this.#resolveThreadId(session, signal, timeoutMs);
		const response = await this.#sendRequestWithConfig<DapStackTraceResponse>(
			session,
			"stackTrace",
			{
				threadId,
				...(frameCount !== undefined ? { levels: frameCount } : {}),
			} satisfies DapStackTraceArguments,
			signal,
			timeoutMs,
		);
		session.lastStackFrames = response?.stackFrames ?? [];
		this.#applyTopFrame(session, session.lastStackFrames[0]);
		return {
			snapshot: buildSummary(session),
			stackFrames: session.lastStackFrames,
			totalFrames: response?.totalFrames,
		};
	}

	async scopes(frameId: number | undefined, signal?: AbortSignal, timeoutMs: number = 30_000) {
		const session = this.#touchActiveSession();
		const resolvedFrameId = frameId ?? session.stop.frameId;
		if (resolvedFrameId === undefined) {
			throw new Error("No active stack frame. Run stack_trace first or supply frame_id.");
		}
		const response = await this.#sendRequestWithConfig<DapScopesResponse>(
			session,
			"scopes",
			{ frameId: resolvedFrameId } satisfies DapScopesArguments,
			signal,
			timeoutMs,
		);
		return { snapshot: buildSummary(session), scopes: response?.scopes ?? [] };
	}

	async variables(variableReference: number, signal?: AbortSignal, timeoutMs: number = 30_000) {
		const session = this.#touchActiveSession();
		const response = await this.#sendRequestWithConfig<DapVariablesResponse>(
			session,
			"variables",
			{ variablesReference: variableReference } satisfies DapVariablesArguments,
			signal,
			timeoutMs,
		);
		return { snapshot: buildSummary(session), variables: response?.variables ?? [] };
	}

	async evaluate(
		expression: string,
		context: DapEvaluateArguments["context"],
		frameId: number | undefined,
		signal?: AbortSignal,
		timeoutMs: number = 30_000,
	) {
		const session = this.#touchActiveSession();
		const response = await this.#sendRequestWithConfig<DapEvaluateResponse>(
			session,
			"evaluate",
			{ expression, context, ...(frameId !== undefined ? { frameId } : {}) } satisfies DapEvaluateArguments,
			signal,
			timeoutMs,
		);
		return { snapshot: buildSummary(session), evaluation: response };
	}

	getOutput(limitBytes?: number): DapOutputSnapshot {
		const session = this.#touchActiveSession();
		if (!limitBytes || limitBytes <= 0 || Buffer.byteLength(session.output, "utf-8") <= limitBytes) {
			return { snapshot: buildSummary(session), output: session.output };
		}
		let sliceStart = session.output.length;
		let remaining = limitBytes;
		while (sliceStart > 0 && remaining > 0) {
			sliceStart -= 1;
			remaining -= Buffer.byteLength(session.output[sliceStart] ?? "", "utf-8");
		}
		return { snapshot: buildSummary(session), output: session.output.slice(sliceStart) };
	}

	async terminate(signal?: AbortSignal, timeoutMs: number = 30_000): Promise<DapSessionSummary | null> {
		const session = this.#getActiveSessionOrNull();
		if (!session) return null;
		session.lastUsedAt = Date.now();
		if (session.status !== "terminated") {
			if (session.capabilities?.supportsTerminateRequest) {
				await raceAbort(
					session.client.sendRequest("terminate", undefined, signal, timeoutMs).catch(() => undefined),
					signal,
				);
			}
			await raceAbort(
				session.client
					.sendRequest("disconnect", { terminateDebuggee: true }, signal, timeoutMs)
					.catch(() => undefined),
				signal,
			);
		}
		session.status = "terminated";
		const summary = buildSummary(session);
		await this.#disposeSession(session);
		return summary;
	}

	#startCleanupTimer(): void {
		if (this.#cleanupTimer) return;
		this.#cleanupTimer = setInterval(() => {
			void this.#cleanupIdleSessions();
		}, CLEANUP_INTERVAL_MS);
		this.#cleanupTimer.unref?.();
	}

	async #cleanupIdleSessions(): Promise<void> {
		const now = Date.now();
		for (const session of Array.from(this.#sessions.values())) {
			if (
				session.status === "terminated" ||
				now - session.lastUsedAt > IDLE_TIMEOUT_MS ||
				!session.client.isAlive()
			) {
				await this.#disposeSession(session);
			}
		}
	}

	async #ensureLaunchSlot(): Promise<void> {
		const active = this.#getActiveSessionOrNull();
		if (!active) return;
		if (active.status === "terminated" || !active.client.isAlive()) {
			await this.#disposeSession(active);
			return;
		}
		throw new Error(`Debug session ${active.id} is still active. Terminate it before launching another.`);
	}

	#registerSession(client: DapClient, adapter: DapResolvedAdapter, cwd: string, program?: string): DapSession {
		const session: DapSession = {
			id: `debug-${++this.#nextId}`,
			adapter,
			cwd,
			program,
			client,
			status: "launching",
			launchedAt: Date.now(),
			lastUsedAt: Date.now(),
			breakpoints: new Map(),
			functionBreakpoints: [],
			output: "",
			outputBytes: 0,
			outputTruncated: false,
			stop: {},
			threads: [],
			lastStackFrames: [],
			initializedSeen: false,
			needsConfigurationDone: false,
			configurationDoneSent: false,
		};
		client.onEvent("output", body => {
			truncateOutput(session, (body as DapOutputEventBody | undefined)?.output ?? "");
		});
		client.onEvent("initialized", async () => {
			session.initializedSeen = true;
			session.status = session.configurationDoneSent ? session.status : "configuring";
		});
		client.onEvent("stopped", async body => {
			await this.#handleStoppedEvent(session, body as DapStoppedEventBody);
		});
		client.onEvent("continued", body => {
			const continued = body as { threadId?: number } | undefined;
			session.status = "running";
			session.stop = { threadId: continued?.threadId };
			session.lastStackFrames = [];
		});
		client.onEvent("exited", body => {
			session.exitCode = (body as DapExitedEventBody | undefined)?.exitCode;
		});
		client.onEvent("terminated", () => {
			session.status = "terminated";
		});
		this.#sessions.set(session.id, session);
		this.#activeSessionId = session.id;
		const heartbeat = setInterval(() => {
			if (!client.isAlive()) {
				session.status = "terminated";
			}
		}, HEARTBEAT_INTERVAL_MS);
		heartbeat.unref?.();
		client.proc.exited.finally(() => clearInterval(heartbeat));
		return session;
	}

	#buildInitializeArguments(adapter: DapResolvedAdapter): DapInitializeArguments {
		return {
			clientID: "omp",
			clientName: "Oh My Pi",
			adapterID: adapter.name,
			locale: "en-US",
			linesStartAt1: true,
			columnsStartAt1: true,
			pathFormat: "path",
			supportsRunInTerminalRequest: false,
			supportsVariableType: true,
			supportsInvalidatedEvent: true,
		};
	}

	/**
	 * Wait for the adapter's `initialized` event (if not already received),
	 * then send `configurationDone`. Many adapters block the `launch`/`attach`
	 * response until this handshake completes.
	 */
	async #completeConfigurationHandshake(
		session: DapSession,
		signal?: AbortSignal,
		timeoutMs: number = 30_000,
	): Promise<void> {
		if (!session.needsConfigurationDone || session.configurationDoneSent) {
			return;
		}
		// Wait for the initialized event if we haven't seen it yet.
		if (!session.initializedSeen) {
			try {
				await raceAbort(session.client.waitForEvent("initialized", undefined, signal, timeoutMs), signal);
			} catch {
				// Adapter may not send initialized (e.g. it already terminated).
				// Proceed anyway — the launch/attach response will surface any real error.
				return;
			}
		}
		await session.client.sendRequest("configurationDone", {}, signal, timeoutMs);
		session.configurationDoneSent = true;
		if (session.status === "configuring") {
			session.status = "running";
		}
	}

	async #captureInitialState(session: DapSession, options: DapEventWaitOptions): Promise<void> {
		try {
			await raceAbort(
				Promise.race([
					session.client.waitForEvent("stopped", undefined, options.signal, options.timeoutMs),
					session.client.waitForEvent("initialized", undefined, options.signal, options.timeoutMs),
					session.client.waitForEvent("terminated", undefined, options.signal, options.timeoutMs),
				]),
				options.signal,
			);
		} catch {
			if (session.initializedSeen) {
				session.status = session.configurationDoneSent ? "running" : "configuring";
			}
		}
	}

	async #handleStoppedEvent(session: DapSession, stopped: DapStoppedEventBody): Promise<void> {
		session.status = "stopped";
		session.stop = {
			threadId: stopped.threadId,
			reason: stopped.reason,
			description: stopped.description,
			text: stopped.text,
		};
		session.lastStackFrames = [];
		if (stopped.threadId === undefined) {
			return;
		}
		try {
			const response = await session.client.sendRequest<DapStackTraceResponse>(
				"stackTrace",
				{ threadId: stopped.threadId, levels: 1 } satisfies DapStackTraceArguments,
				undefined,
				5_000,
			);
			session.lastStackFrames = response?.stackFrames ?? [];
			this.#applyTopFrame(session, session.lastStackFrames[0]);
		} catch (error) {
			logger.debug("Failed to capture stopped frame", {
				sessionId: session.id,
				error: toErrorMessage(error),
			});
		}
	}

	#applyTopFrame(session: DapSession, frame: DapStackFrame | undefined): void {
		if (!frame) return;
		session.stop.frameId = frame.id;
		session.stop.frameName = frame.name;
		session.stop.source = frame.source;
		session.stop.line = frame.line;
		session.stop.column = frame.column;
	}

	async #step(command: "stepIn" | "stepOut" | "next", signal?: AbortSignal, timeoutMs: number = 30_000) {
		const session = this.#touchActiveSession();
		const threadId = await this.#resolveThreadId(session, signal, timeoutMs);
		await this.#sendRequestWithConfig(session, command, { threadId } satisfies DapStepArguments, signal, timeoutMs);
		session.status = "running";
		return this.#waitForStopOutcome(session, signal, timeoutMs);
	}

	async #waitForStopOutcome(
		session: DapSession,
		signal?: AbortSignal,
		timeoutMs: number = 30_000,
	): Promise<DapContinueOutcome> {
		try {
			await raceAbort(
				Promise.race([
					session.client.waitForEvent("stopped", undefined, signal, timeoutMs),
					session.client.waitForEvent("terminated", undefined, signal, timeoutMs),
					session.client.waitForEvent("exited", undefined, signal, timeoutMs),
				]),
				signal,
			);
			const state =
				session.status === "stopped" ? "stopped" : session.status === "terminated" ? "terminated" : "running";
			return { snapshot: buildSummary(session), state, timedOut: false };
		} catch (error) {
			if (signal?.aborted) {
				throw error;
			}
			return { snapshot: buildSummary(session), state: "running", timedOut: session.status === "running" };
		}
	}

	async #resolveThreadId(session: DapSession, signal?: AbortSignal, timeoutMs: number = 30_000): Promise<number> {
		if (session.stop.threadId !== undefined) {
			return session.stop.threadId;
		}
		if (session.threads.length > 0) {
			return session.threads[0].id;
		}
		const response = await session.client.sendRequest<DapThreadsResponse>("threads", undefined, signal, timeoutMs);
		session.threads = response?.threads ?? [];
		const threadId = session.threads[0]?.id;
		if (threadId === undefined) {
			throw new Error("Debugger reported no threads.");
		}
		return threadId;
	}

	async #sendRequestWithConfig<TBody>(
		session: DapSession,
		command: string,
		args: unknown,
		signal?: AbortSignal,
		timeoutMs: number = 30_000,
	): Promise<TBody> {
		await this.#ensureConfigurationDone(session, signal, timeoutMs);
		const body = await session.client.sendRequest<TBody>(command, args, signal, timeoutMs);
		session.lastUsedAt = Date.now();
		return body;
	}

	async #ensureConfigurationDone(
		session: DapSession,
		signal?: AbortSignal,
		timeoutMs: number = 30_000,
	): Promise<void> {
		if (!session.needsConfigurationDone || session.configurationDoneSent) {
			return;
		}
		await session.client.sendRequest("configurationDone", {}, signal, timeoutMs);
		session.configurationDoneSent = true;
		if (session.status === "configuring") {
			session.status = "running";
		}
	}

	#mapSourceBreakpoints(
		input: DapBreakpointRecord[],
		responseBreakpoints: DapBreakpoint[] | undefined,
	): DapBreakpointRecord[] {
		return input.map((entry, index) => ({
			line: entry.line,
			condition: entry.condition,
			id: responseBreakpoints?.[index]?.id,
			verified: responseBreakpoints?.[index]?.verified ?? false,
			message: responseBreakpoints?.[index]?.message,
		}));
	}

	#mapFunctionBreakpoints(
		input: DapFunctionBreakpointRecord[],
		responseBreakpoints: DapBreakpoint[] | undefined,
	): DapFunctionBreakpointRecord[] {
		return input.map((entry, index) => ({
			name: entry.name,
			condition: entry.condition,
			id: responseBreakpoints?.[index]?.id,
			verified: responseBreakpoints?.[index]?.verified ?? false,
			message: responseBreakpoints?.[index]?.message,
		}));
	}

	#touchActiveSession(): DapSession {
		const session = this.#getActiveSessionOrThrow();
		session.lastUsedAt = Date.now();
		if (session.status !== "terminated" && !session.client.isAlive()) {
			session.status = "terminated";
		}
		return session;
	}

	#getActiveSessionOrNull(): DapSession | null {
		if (!this.#activeSessionId) {
			return null;
		}
		const session = this.#sessions.get(this.#activeSessionId) ?? null;
		if (!session) {
			this.#activeSessionId = null;
		}
		return session;
	}

	#getActiveSessionOrThrow(): DapSession {
		const session = this.#getActiveSessionOrNull();
		if (!session) {
			throw new Error("No active debug session. Launch or attach first.");
		}
		return session;
	}

	async #disposeSession(session: DapSession): Promise<void> {
		if (this.#activeSessionId === session.id) {
			this.#activeSessionId = null;
		}
		this.#sessions.delete(session.id);
		await session.client.dispose().catch(() => {});
	}
}

export const dapSessionManager = new DapSessionManager();
