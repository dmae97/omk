import net from "node:net";
import path from "node:path";

export type HerdrAgentState = "working" | "blocked" | "idle";

export interface HerdrConfig {
	readonly paneId: string;
	readonly socketEndpoint: string;
}

export type HerdrSessionRef = { readonly agent_session_path: string } | { readonly agent_session_id: string };

export interface HerdrBlockedEvent {
	readonly active?: boolean;
	readonly label?: string;
}

export interface HerdrTransport {
	queueState(state: HerdrAgentState, message: string | undefined, sessionRef: HerdrSessionRef | undefined): void;
	reportSession(sessionRef: HerdrSessionRef | undefined, sessionStartSource?: string): void;
	release(): Promise<void>;
}

const SOURCE = "omk";
const AGENT = "omk";
const RESUME_COMMAND = "omk";
const MAX_RESUME_ARGS = 64;
const MAX_RESUME_BYTES = 8192;
const FIRST_TIMEOUT_MS = 500;
const RETRY_TIMEOUT_MS = 1500;
const RELEASE_TIMEOUT_MS = 500;

export function resolveHerdrConfig(
	env: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform,
): HerdrConfig | undefined {
	if (env.HERDR_ENV !== "1") return undefined;
	const paneId = env.HERDR_PANE_ID?.trim();
	const socketPath = env.HERDR_SOCKET_PATH?.trim();
	if (!paneId || !socketPath) return undefined;
	const socketEndpoint =
		platform === "win32" && !socketPath.startsWith("\\\\.\\pipe\\") ? `\\\\.\\pipe\\${socketPath}` : socketPath;
	return { paneId, socketEndpoint };
}

export function extractHerdrSessionRef(
	sessionManager: { getSessionFile?: () => string | undefined; getSessionId?: () => string | undefined } | undefined,
): HerdrSessionRef | undefined {
	try {
		const file = sessionManager?.getSessionFile?.();
		if (typeof file === "string" && (path.posix.isAbsolute(file) || path.win32.isAbsolute(file))) {
			return { agent_session_path: file };
		}
	} catch {
		// Ignore session file accessor failures and fall back to session ID.
	}
	try {
		const id = sessionManager?.getSessionId?.();
		if (typeof id === "string" && id.length > 0) {
			return { agent_session_id: id };
		}
	} catch {
		// Ignore session ID accessor failures.
	}
	return undefined;
}

function isSafeResumeArg(arg: string): boolean {
	if (arg.length === 0 || arg.includes("'")) return false;
	for (let i = 0; i < arg.length; i += 1) {
		const code = arg.charCodeAt(i);
		if (code < 0x20 || code === 0x7f) return false;
	}
	return true;
}

export function buildHerdrResumeArgv(sessionRef: HerdrSessionRef | undefined): readonly string[] | undefined {
	if (!sessionRef || !("agent_session_path" in sessionRef)) return undefined;
	const argv = [RESUME_COMMAND, "--session", sessionRef.agent_session_path];
	if (argv.length > MAX_RESUME_ARGS) return undefined;
	if (!argv.every(isSafeResumeArg)) return undefined;
	const totalBytes = argv.reduce((sum, item) => sum + Buffer.byteLength(item, "utf8"), 0);
	if (totalBytes > MAX_RESUME_BYTES) return undefined;
	return argv;
}

function sendSocketAttempt(endpoint: string, payload: string, timeoutMs: number): Promise<boolean> {
	return new Promise((resolve) => {
		let done = false;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const socket = net.createConnection(endpoint);

		const finish = (delivered: boolean) => {
			if (done) return;
			done = true;
			if (timeout) clearTimeout(timeout);
			socket.destroy();
			resolve(delivered);
		};

		socket.on("error", () => finish(false));
		socket.on("connect", () => {
			socket.write(payload);
		});
		socket.on("data", () => finish(true));
		socket.on("end", () => finish(false));
		timeout = setTimeout(() => finish(false), timeoutMs);
		timeout.unref?.();
	});
}

async function sendWithRetry(endpoint: string, request: Record<string, unknown>, retry: boolean): Promise<void> {
	const payload = `${JSON.stringify(request)}\n`;
	if (await sendSocketAttempt(endpoint, payload, retry ? FIRST_TIMEOUT_MS : RELEASE_TIMEOUT_MS)) {
		return;
	}
	if (retry) {
		await sendSocketAttempt(endpoint, payload, RETRY_TIMEOUT_MS);
	}
}

interface QueuedStateItem {
	readonly state: HerdrAgentState;
	readonly message: string | undefined;
	readonly sessionRef: HerdrSessionRef | undefined;
}

interface QueuedSessionItem {
	readonly sessionRef: HerdrSessionRef;
	readonly sessionStartSource: string | undefined;
}

export function createHerdrTransport(config: HerdrConfig): HerdrTransport {
	let seq = Date.now() * 1000;
	let inFlight: Promise<void> | undefined;
	let pendingState: QueuedStateItem | undefined;
	let pendingSession: QueuedSessionItem | undefined;
	let released = false;

	const nextSeq = () => {
		seq += 1;
		return seq;
	};

	const makeId = (kind: string) => `${SOURCE}:${kind}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

	const buildStateRequest = (item: QueuedStateItem) => {
		const resumeArgv = buildHerdrResumeArgv(item.sessionRef);
		return {
			id: makeId("state"),
			method: "pane.report_agent",
			params: {
				pane_id: config.paneId,
				source: SOURCE,
				agent: AGENT,
				state: item.state,
				...(item.message ? { message: item.message } : {}),
				seq: nextSeq(),
				...(item.sessionRef ?? {}),
				...(resumeArgv ? { resume_argv: resumeArgv } : {}),
			},
		};
	};

	const buildSessionRequest = (item: QueuedSessionItem) => {
		const resumeArgv = buildHerdrResumeArgv(item.sessionRef);
		return {
			id: makeId("session"),
			method: "pane.report_agent_session",
			params: {
				pane_id: config.paneId,
				source: SOURCE,
				agent: AGENT,
				seq: nextSeq(),
				...(item.sessionStartSource ? { session_start_source: item.sessionStartSource } : {}),
				...item.sessionRef,
				...(resumeArgv ? { resume_argv: resumeArgv } : {}),
			},
		};
	};

	const startDrain = () => {
		if (inFlight || released) return;
		inFlight = (async () => {
			try {
				while (!released && (pendingState || pendingSession)) {
					// Send state first so this source holds the pane before session-only updates.
					if (pendingState) {
						const item = pendingState;
						pendingState = undefined;
						await sendWithRetry(config.socketEndpoint, buildStateRequest(item), true);
						continue;
					}
					if (pendingSession) {
						const item = pendingSession;
						pendingSession = undefined;
						await sendWithRetry(config.socketEndpoint, buildSessionRequest(item), true);
					}
				}
			} finally {
				inFlight = undefined;
				if (!released && (pendingState || pendingSession)) {
					startDrain();
				}
			}
		})();
	};

	return {
		queueState(state, message, sessionRef) {
			if (released) return;
			pendingState = { state, message, sessionRef };
			startDrain();
		},
		reportSession(sessionRef, sessionStartSource) {
			if (released || !sessionRef) return;
			pendingSession = { sessionRef, sessionStartSource };
			startDrain();
		},
		async release() {
			if (released) return;
			released = true;
			pendingState = undefined;
			pendingSession = undefined;
			if (inFlight) {
				await inFlight.catch(() => {});
			}
			await sendWithRetry(
				config.socketEndpoint,
				{
					id: makeId("release"),
					method: "pane.release_agent",
					params: {
						pane_id: config.paneId,
						source: SOURCE,
						agent: AGENT,
						seq: nextSeq(),
					},
				},
				false,
			);
		},
	};
}
