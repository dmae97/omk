import { $env, logger } from "@oh-my-pi/pi-utils";
import { $ } from "bun";
import { nanoid } from "nanoid";
import { Settings } from "../config/settings";
import { time } from "../utils/timings";
import { htmlToBasicMarkdown } from "../web/scrapers/types";
import { acquireSharedGateway, releaseSharedGateway, shutdownSharedGateway } from "./gateway-coordinator";
import { loadPythonModules } from "./modules";
import { PYTHON_PRELUDE } from "./prelude";
import { filterEnv, resolvePythonRuntime } from "./runtime";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const TRACE_IPC = $env.PI_PYTHON_IPC_TRACE === "1";
const PRELUDE_INTROSPECTION_SNIPPET = "import json\nprint(json.dumps(__omp_prelude_docs__()))";

const debugStartup = $env.PI_DEBUG_STARTUP ? (stage: string) => process.stderr.write(`[startup] ${stage}\n`) : () => {};

class SharedGatewayCreateError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

interface ExternalGatewayConfig {
	url: string;
	token?: string;
}

function getExternalGatewayConfig(): ExternalGatewayConfig | null {
	const url = $env.PI_PYTHON_GATEWAY_URL;
	if (!url) return null;
	return {
		url: url.replace(/\/$/, ""),
		token: $env.PI_PYTHON_GATEWAY_TOKEN,
	};
}

export interface JupyterHeader {
	msg_id: string;
	session: string;
	username: string;
	date: string;
	msg_type: string;
	version: string;
}

export interface JupyterMessage {
	channel: string;
	header: JupyterHeader;
	parent_header: Record<string, unknown>;
	metadata: Record<string, unknown>;
	content: Record<string, unknown>;
	buffers?: Uint8Array[];
}

/** Status event emitted by prelude helpers for TUI rendering. */
export interface PythonStatusEvent {
	/** Operation name (e.g., "find", "read", "write") */
	op: string;
	/** Additional data fields (count, path, pattern, etc.) */
	[key: string]: unknown;
}

export type KernelDisplayOutput =
	| { type: "json"; data: unknown }
	| { type: "image"; data: string; mimeType: string }
	| { type: "status"; event: PythonStatusEvent };

export interface KernelExecuteOptions {
	signal?: AbortSignal;
	onChunk?: (text: string) => Promise<void> | void;
	onDisplay?: (output: KernelDisplayOutput) => Promise<void> | void;
	timeoutMs?: number;
	silent?: boolean;
	storeHistory?: boolean;
	allowStdin?: boolean;
}

export interface KernelExecuteResult {
	status: "ok" | "error";
	executionCount?: number;
	error?: { name: string; value: string; traceback: string[] };
	cancelled: boolean;
	timedOut: boolean;
	stdinRequested: boolean;
}

export interface PreludeHelper {
	name: string;
	signature: string;
	docstring: string;
	category: string;
}

interface KernelStartOptions {
	cwd: string;
	env?: Record<string, string | undefined>;
	useSharedGateway?: boolean;
}

export interface PythonKernelAvailability {
	ok: boolean;
	pythonPath?: string;
	reason?: string;
}

export async function checkPythonKernelAvailability(cwd: string): Promise<PythonKernelAvailability> {
	if (process.env.BUN_ENV === "test" || process.env.NODE_ENV === "test" || $env.PI_PYTHON_SKIP_CHECK === "1") {
		return { ok: true };
	}

	const externalConfig = getExternalGatewayConfig();
	if (externalConfig) {
		return checkExternalGatewayAvailability(externalConfig);
	}

	try {
		const settings = await Settings.init();
		const { env } = settings.getShellConfig();
		const baseEnv = filterEnv(env);
		const runtime = resolvePythonRuntime(cwd, baseEnv);
		const checkScript =
			"import importlib.util,sys;sys.exit(0 if importlib.util.find_spec('kernel_gateway') and importlib.util.find_spec('ipykernel') else 1)";
		const result = await $`${runtime.pythonPath} -c ${checkScript}`.quiet().nothrow().cwd(cwd).env(runtime.env);
		if (result.exitCode === 0) {
			return { ok: true, pythonPath: runtime.pythonPath };
		}
		return {
			ok: false,
			pythonPath: runtime.pythonPath,
			reason:
				"kernel_gateway (jupyter-kernel-gateway) or ipykernel not installed. Run: python -m pip install jupyter_kernel_gateway ipykernel",
		};
	} catch (err: unknown) {
		return { ok: false, reason: err instanceof Error ? err.message : String(err) };
	}
}

async function checkExternalGatewayAvailability(config: ExternalGatewayConfig): Promise<PythonKernelAvailability> {
	try {
		const headers: Record<string, string> = {};
		if (config.token) {
			headers.Authorization = `token ${config.token}`;
		}

		const controller = new AbortController();

		const response = await fetch(`${config.url}/api/kernelspecs`, {
			headers,
			signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
		});

		if (response.ok) {
			return { ok: true };
		}

		if (response.status === 401 || response.status === 403) {
			return {
				ok: false,
				reason: `External gateway at ${config.url} requires authentication. Set PI_PYTHON_GATEWAY_TOKEN.`,
			};
		}

		return {
			ok: false,
			reason: `External gateway at ${config.url} returned status ${response.status}`,
		};
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.includes("abort") || message.includes("timeout")) {
			return {
				ok: false,
				reason: `External gateway at ${config.url} is not reachable (timeout)`,
			};
		}
		return {
			ok: false,
			reason: `External gateway at ${config.url} is not reachable: ${message}`,
		};
	}
}

function normalizeDisplayText(text: string): string {
	return text.endsWith("\n") ? text : `${text}\n`;
}

export function deserializeWebSocketMessage(data: ArrayBuffer): JupyterMessage | null {
	const view = new DataView(data);
	const offsetCount = view.getUint32(0, true);

	if (offsetCount < 1) return null;

	const offsets: number[] = [];
	for (let i = 0; i < offsetCount; i++) {
		offsets.push(view.getUint32(4 + i * 4, true));
	}

	const msgStart = offsets[0];
	const msgEnd = offsets.length > 1 ? offsets[1] : data.byteLength;
	const msgBytes = new Uint8Array(data, msgStart, msgEnd - msgStart);
	const msgText = TEXT_DECODER.decode(msgBytes);

	try {
		const msg = JSON.parse(msgText) as {
			channel: string;
			header: JupyterHeader;
			parent_header: Record<string, unknown>;
			metadata: Record<string, unknown>;
			content: Record<string, unknown>;
		};

		const buffers: Uint8Array[] = [];
		for (let i = 1; i < offsets.length; i++) {
			const start = offsets[i];
			const end = i + 1 < offsets.length ? offsets[i + 1] : data.byteLength;
			buffers.push(new Uint8Array(data, start, end - start));
		}

		return { ...msg, buffers };
	} catch {
		return null;
	}
}

export function serializeWebSocketMessage(msg: JupyterMessage): ArrayBuffer {
	const msgText = JSON.stringify({
		channel: msg.channel,
		header: msg.header,
		parent_header: msg.parent_header,
		metadata: msg.metadata,
		content: msg.content,
	});
	const msgBytes = TEXT_ENCODER.encode(msgText);

	const buffers = msg.buffers ?? [];
	const offsetCount = 1 + buffers.length;
	const headerSize = 4 + offsetCount * 4;

	let totalSize = headerSize + msgBytes.length;
	for (const buf of buffers) {
		totalSize += buf.length;
	}

	const result = new ArrayBuffer(totalSize);
	const view = new DataView(result);
	const bytes = new Uint8Array(result);

	view.setUint32(0, offsetCount, true);

	let offset = headerSize;
	view.setUint32(4, offset, true);
	bytes.set(msgBytes, offset);
	offset += msgBytes.length;

	for (let i = 0; i < buffers.length; i++) {
		view.setUint32(4 + (i + 1) * 4, offset, true);
		bytes.set(buffers[i], offset);
		offset += buffers[i].length;
	}

	return result;
}

export class PythonKernel {
	readonly id: string;
	readonly kernelId: string;
	readonly gatewayUrl: string;
	readonly sessionId: string;
	readonly username: string;
	readonly isSharedGateway: boolean;
	readonly #authToken?: string;

	#ws: WebSocket | null = null;
	#disposed = false;
	#alive = true;
	#messageHandlers = new Map<string, (msg: JupyterMessage) => void>();
	#channelHandlers = new Map<string, Set<(msg: JupyterMessage) => void>>();
	#pendingExecutions = new Map<string, (reason: string) => void>();

	private constructor(
		id: string,
		kernelId: string,
		gatewayUrl: string,
		sessionId: string,
		username: string,
		isSharedGateway: boolean,
		authToken?: string,
	) {
		this.id = id;
		this.kernelId = kernelId;
		this.gatewayUrl = gatewayUrl;
		this.sessionId = sessionId;
		this.username = username;
		this.isSharedGateway = isSharedGateway;
		this.#authToken = authToken;
	}

	#authHeaders(): Record<string, string> {
		if (!this.#authToken) return {};
		return { Authorization: `token ${this.#authToken}` };
	}

	static async start(options: KernelStartOptions): Promise<PythonKernel> {
		debugStartup("PythonKernel.start:entry");
		const availability = await checkPythonKernelAvailability(options.cwd);
		debugStartup("PythonKernel.start:availCheck");
		time("PythonKernel.start:availabilityCheck");
		if (!availability.ok) {
			throw new Error(availability.reason ?? "Python kernel unavailable");
		}

		const externalConfig = getExternalGatewayConfig();
		if (externalConfig) {
			return PythonKernel.startWithExternalGateway(externalConfig, options.cwd, options.env);
		}

		if (options.useSharedGateway === false) {
			throw new Error("Shared Python gateway required; local gateways are disabled");
		}

		for (let attempt = 0; attempt < 2; attempt += 1) {
			try {
				debugStartup("PythonKernel.start:acquireShared:start");
				const sharedResult = await acquireSharedGateway(options.cwd);
				debugStartup("PythonKernel.start:acquireShared:done");
				time("PythonKernel.start:acquireSharedGateway");
				if (!sharedResult) {
					throw new Error("Shared Python gateway unavailable");
				}
				debugStartup("PythonKernel.start:startShared:start");
				const kernel = await PythonKernel.startWithSharedGateway(sharedResult.url, options.cwd, options.env);
				debugStartup("PythonKernel.start:startShared:done");
				time("PythonKernel.start:startWithSharedGateway");
				return kernel;
			} catch (err) {
				debugStartup("PythonKernel.start:sharedFailed");
				if (attempt === 0 && err instanceof SharedGatewayCreateError && err.status >= 500) {
					logger.warn("Shared gateway kernel creation failed, retrying", {
						status: err.status,
					});
					continue;
				}
				logger.warn("Failed to acquire shared gateway", {
					error: err instanceof Error ? err.message : String(err),
				});
				throw err;
			}
		}

		throw new Error("Shared Python gateway unavailable after retry");
	}

	private static async startWithExternalGateway(
		config: ExternalGatewayConfig,
		cwd: string,
		env?: Record<string, string | undefined>,
	): Promise<PythonKernel> {
		const headers: Record<string, string> = { "Content-Type": "application/json" };
		if (config.token) {
			headers.Authorization = `token ${config.token}`;
		}

		const createResponse = await fetch(`${config.url}/api/kernels`, {
			method: "POST",
			headers,
			body: JSON.stringify({ name: "python3" }),
		});

		if (!createResponse.ok) {
			throw new Error(`Failed to create kernel on external gateway: ${await createResponse.text()}`);
		}

		const kernelInfo = (await createResponse.json()) as { id: string };
		const kernelId = kernelInfo.id;

		const kernel = new PythonKernel(nanoid(), kernelId, config.url, nanoid(), "omp", false, config.token);

		try {
			await kernel.connectWebSocket();
			await kernel.initializeKernelEnvironment(cwd, env);
			const preludeResult = await kernel.execute(PYTHON_PRELUDE, { silent: true, storeHistory: false });
			if (preludeResult.cancelled || preludeResult.status === "error") {
				throw new Error("Failed to initialize Python kernel prelude");
			}
			await loadPythonModules(kernel, { cwd });
			return kernel;
		} catch (err: unknown) {
			await kernel.shutdown();
			throw err;
		}
	}

	private static async startWithSharedGateway(
		gatewayUrl: string,
		cwd: string,
		env?: Record<string, string | undefined>,
	): Promise<PythonKernel> {
		debugStartup("sharedGateway:fetch:start");
		const createResponse = await fetch(`${gatewayUrl}/api/kernels`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "python3" }),
		});
		debugStartup("sharedGateway:fetch:done");
		time("startWithSharedGateway:createKernel");

		if (!createResponse.ok) {
			debugStartup(`sharedGateway:fetch:notOk:${createResponse.status}`);
			await shutdownSharedGateway();
			debugStartup("sharedGateway:fetch:shutdown");
			const text = await createResponse.text();
			debugStartup("sharedGateway:fetch:textRead");
			throw new SharedGatewayCreateError(
				createResponse.status,
				`Failed to create kernel on shared gateway: ${text}`,
			);
		}

		debugStartup("sharedGateway:json:start");
		const kernelInfo = (await createResponse.json()) as { id: string };
		debugStartup("sharedGateway:json:done");
		const kernelId = kernelInfo.id;

		const kernel = new PythonKernel(nanoid(), kernelId, gatewayUrl, nanoid(), "omp", true);
		debugStartup("sharedGateway:kernelCreated");

		try {
			debugStartup("sharedGateway:connectWS:start");
			await kernel.connectWebSocket();
			debugStartup("sharedGateway:connectWS:done");
			time("startWithSharedGateway:connectWS");
			debugStartup("sharedGateway:initEnv:start");
			await kernel.initializeKernelEnvironment(cwd, env);
			debugStartup("sharedGateway:initEnv:done");
			time("startWithSharedGateway:initEnv");
			debugStartup("sharedGateway:prelude:start");
			const preludeResult = await kernel.execute(PYTHON_PRELUDE, { silent: true, storeHistory: false });
			debugStartup("sharedGateway:prelude:done");
			time("startWithSharedGateway:prelude");
			if (preludeResult.cancelled || preludeResult.status === "error") {
				throw new Error("Failed to initialize Python kernel prelude");
			}
			debugStartup("sharedGateway:loadModules:start");
			await loadPythonModules(kernel, { cwd });
			debugStartup("sharedGateway:loadModules:done");
			time("startWithSharedGateway:loadModules");
			return kernel;
		} catch (err: unknown) {
			await kernel.shutdown();
			throw err;
		}
	}

	private async connectWebSocket(): Promise<void> {
		const wsBase = this.gatewayUrl.replace(/^http/, "ws");
		let wsUrl = `${wsBase}/api/kernels/${this.kernelId}/channels`;
		if (this.#authToken) {
			wsUrl += `?token=${encodeURIComponent(this.#authToken)}`;
		}

		const { promise, resolve, reject } = Promise.withResolvers<void>();
		const ws = new WebSocket(wsUrl);
		ws.binaryType = "arraybuffer";
		let settled = false;

		const timeout = setTimeout(() => {
			ws.close();
			if (!settled) {
				settled = true;
				reject(new Error("WebSocket connection timeout"));
			}
		}, 10000);

		ws.onopen = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			this.#ws = ws;
			resolve();
		};

		ws.onerror = event => {
			const error = new Error(`WebSocket error: ${event}`);
			if (!settled) {
				settled = true;
				clearTimeout(timeout);
				reject(error);
				return;
			}
			this.#alive = false;
			this.#ws = null;
			this.abortPendingExecutions(error.message);
		};

		ws.onclose = () => {
			this.#alive = false;
			this.#ws = null;
			if (!settled) {
				settled = true;
				clearTimeout(timeout);
				reject(new Error("WebSocket closed before connection"));
				return;
			}
			this.abortPendingExecutions("WebSocket closed");
		};

		ws.onmessage = event => {
			let msg: JupyterMessage | null = null;
			if (event.data instanceof ArrayBuffer) {
				msg = deserializeWebSocketMessage(event.data);
			} else if (typeof event.data === "string") {
				try {
					msg = JSON.parse(event.data) as JupyterMessage;
				} catch {
					return;
				}
			}
			if (!msg) return;

			if (TRACE_IPC) {
				logger.debug("Kernel IPC recv", { channel: msg.channel, msgType: msg.header.msg_type });
			}

			const parentId = (msg.parent_header as { msg_id?: string }).msg_id;
			if (parentId) {
				const handler = this.#messageHandlers.get(parentId);
				if (handler) handler(msg);
			}

			const channelHandlers = this.#channelHandlers.get(msg.channel);
			if (channelHandlers) {
				for (const handler of channelHandlers) {
					handler(msg);
				}
			}
		};

		return promise;
	}

	private async initializeKernelEnvironment(cwd: string, env?: Record<string, string | undefined>): Promise<void> {
		const envEntries = Object.entries(env ?? {}).filter(([, value]) => value !== undefined);
		const envPayload = Object.fromEntries(envEntries);
		const initScript = [
			"import os, sys",
			`__omp_cwd = ${JSON.stringify(cwd)}`,
			"os.chdir(__omp_cwd)",
			`__omp_env = ${JSON.stringify(envPayload)}`,
			"for __omp_key, __omp_val in __omp_env.items():\n    os.environ[__omp_key] = __omp_val",
			"if __omp_cwd not in sys.path:\n    sys.path.insert(0, __omp_cwd)",
		].join("\n");
		const result = await this.execute(initScript, { silent: true, storeHistory: false });
		if (result.cancelled || result.status === "error") {
			throw new Error("Failed to initialize Python kernel environment");
		}
	}

	private abortPendingExecutions(reason: string): void {
		if (this.#pendingExecutions.size === 0) return;
		for (const cancel of this.#pendingExecutions.values()) {
			cancel(reason);
		}
		this.#pendingExecutions.clear();
		this.#messageHandlers.clear();
		logger.warn("Aborted pending Python executions", { reason });
	}

	isAlive(): boolean {
		return this.#alive && !this.#disposed && this.#ws?.readyState === WebSocket.OPEN;
	}

	async execute(code: string, options?: KernelExecuteOptions): Promise<KernelExecuteResult> {
		if (!this.isAlive()) {
			throw new Error("Python kernel is not running");
		}

		const msgId = nanoid();
		const msg: JupyterMessage = {
			channel: "shell",
			header: {
				msg_id: msgId,
				session: this.sessionId,
				username: this.username,
				date: new Date().toISOString(),
				msg_type: "execute_request",
				version: "5.5",
			},
			parent_header: {},
			metadata: {},
			content: {
				code,
				silent: options?.silent ?? false,
				store_history: options?.storeHistory ?? !(options?.silent ?? false),
				user_expressions: {},
				allow_stdin: options?.allowStdin ?? false,
				stop_on_error: true,
			},
		};

		let status: "ok" | "error" = "ok";
		let executionCount: number | undefined;
		let error: { name: string; value: string; traceback: string[] } | undefined;
		let replyReceived = false;
		let idleReceived = false;
		let stdinRequested = false;
		let cancelled = false;
		let timedOut = false;

		const controller = new AbortController();
		const onAbort = () => {
			controller.abort(options?.signal?.reason ?? new Error("Aborted"));
		};
		if (options?.signal) {
			if (options.signal.aborted) {
				onAbort();
			} else {
				options.signal.addEventListener("abort", onAbort, { once: true });
			}
		}
		const timeoutId =
			typeof options?.timeoutMs === "number" && options.timeoutMs > 0
				? setTimeout(() => {
						timedOut = true;
						controller.abort(new Error("Timeout"));
					}, options.timeoutMs)
				: undefined;

		const { promise, resolve } = Promise.withResolvers<KernelExecuteResult>();

		let resolved = false;
		const finalize = () => {
			if (resolved) return;
			resolved = true;
			this.#messageHandlers.delete(msgId);
			this.#pendingExecutions.delete(msgId);
			if (timeoutId) clearTimeout(timeoutId);
			if (options?.signal) {
				options.signal.removeEventListener("abort", onAbort);
			}
			resolve({ status, executionCount, error, cancelled, timedOut, stdinRequested });
		};

		const checkDone = () => {
			if (replyReceived && idleReceived) {
				finalize();
			}
		};

		const cancelFromClose = (reason: string) => {
			if (resolved) return;
			cancelled = true;
			timedOut = false;
			if (options?.onChunk) {
				void options.onChunk(`[kernel] ${reason}\n`);
			}
			finalize();
		};

		this.#pendingExecutions.set(msgId, cancelFromClose);

		const onExecutionAbort = () => {
			cancelled = true;
			void (async () => {
				try {
					await this.interrupt();
				} finally {
					finalize();
				}
			})();
		};
		controller.signal.addEventListener("abort", onExecutionAbort, { once: true });

		if (controller.signal.aborted) {
			cancelFromClose("Execution aborted");
			return promise;
		}

		this.#messageHandlers.set(msgId, async response => {
			switch (response.header.msg_type) {
				case "execute_reply": {
					replyReceived = true;
					const replyStatus = response.content.status;
					status = replyStatus === "error" ? "error" : "ok";
					if (typeof response.content.execution_count === "number") {
						executionCount = response.content.execution_count;
					}
					checkDone();
					break;
				}
				case "stream": {
					const text = String(response.content.text ?? "");
					if (text && options?.onChunk) {
						await options.onChunk(text);
					}
					break;
				}
				case "execute_result":
				case "display_data": {
					const { text, outputs } = this.renderDisplay(response.content);
					if (text && options?.onChunk) {
						await options.onChunk(text);
					}
					if (outputs.length > 0 && options?.onDisplay) {
						for (const output of outputs) {
							await options.onDisplay(output);
						}
					}
					break;
				}
				case "error": {
					const traceback = Array.isArray(response.content.traceback)
						? response.content.traceback.map((line: unknown) => String(line))
						: [];
					error = {
						name: String(response.content.ename ?? "Error"),
						value: String(response.content.evalue ?? ""),
						traceback,
					};
					const text = traceback.length > 0 ? `${traceback.join("\n")}\n` : `${error.name}: ${error.value}\n`;
					if (options?.onChunk) {
						await options.onChunk(text);
					}
					break;
				}
				case "status": {
					const state = response.content.execution_state;
					if (state === "idle") {
						idleReceived = true;
						checkDone();
					}
					break;
				}
				case "input_request": {
					stdinRequested = true;
					if (options?.onChunk) {
						await options.onChunk(
							"[stdin] Kernel requested input. Interactive stdin is not supported; provide input programmatically.\n",
						);
					}
					this.sendMessage({
						channel: "stdin",
						header: {
							msg_id: nanoid(),
							session: this.sessionId,
							username: this.username,
							date: new Date().toISOString(),
							msg_type: "input_reply",
							version: "5.5",
						},
						parent_header: response.header as unknown as Record<string, unknown>,
						metadata: {},
						content: { value: "" },
					});
					break;
				}
			}
		});

		try {
			this.sendMessage(msg);
		} catch {
			cancelled = true;
			finalize();
		}
		return promise;
	}

	async introspectPrelude(): Promise<PreludeHelper[]> {
		let output = "";
		const result = await this.execute(PRELUDE_INTROSPECTION_SNIPPET, {
			silent: false,
			storeHistory: false,
			onChunk: text => {
				output += text;
			},
		});
		if (result.cancelled || result.status === "error") {
			throw new Error("Failed to introspect Python prelude");
		}
		const trimmed = output.trim();
		if (!trimmed) return [];
		try {
			return JSON.parse(trimmed) as PreludeHelper[];
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			throw new Error(`Failed to parse Python prelude docs: ${message}`);
		}
	}

	async interrupt(): Promise<void> {
		try {
			await fetch(`${this.gatewayUrl}/api/kernels/${this.kernelId}/interrupt`, {
				method: "POST",
				headers: this.#authHeaders(),
				signal: AbortSignal.timeout(2000),
			});
		} catch (err: unknown) {
			logger.warn("Failed to interrupt kernel via API", { error: err instanceof Error ? err.message : String(err) });
		}

		try {
			const msg: JupyterMessage = {
				channel: "control",
				header: {
					msg_id: nanoid(),
					session: this.sessionId,
					username: this.username,
					date: new Date().toISOString(),
					msg_type: "interrupt_request",
					version: "5.5",
				},
				parent_header: {},
				metadata: {},
				content: {},
			};
			this.sendMessage(msg);
		} catch (err: unknown) {
			logger.warn("Failed to send interrupt request", { error: err instanceof Error ? err.message : String(err) });
		}
	}

	async shutdown(): Promise<void> {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#alive = false;
		this.abortPendingExecutions("Kernel shutdown");

		try {
			await fetch(`${this.gatewayUrl}/api/kernels/${this.kernelId}`, {
				method: "DELETE",
				headers: this.#authHeaders(),
			});
		} catch (err: unknown) {
			logger.warn("Failed to delete kernel via API", { error: err instanceof Error ? err.message : String(err) });
		}

		if (this.#ws) {
			this.#ws.close();
			this.#ws = null;
		}

		if (this.isSharedGateway) {
			await releaseSharedGateway();
		}
	}

	private renderDisplay(content: Record<string, unknown>): { text: string; outputs: KernelDisplayOutput[] } {
		const data = content.data as Record<string, unknown> | undefined;
		if (!data) return { text: "", outputs: [] };

		const outputs: KernelDisplayOutput[] = [];

		// Handle status events (custom MIME type from prelude helpers)
		if (data["application/x-omp-status"] !== undefined) {
			const statusData = data["application/x-omp-status"];
			if (statusData && typeof statusData === "object" && "op" in statusData) {
				outputs.push({ type: "status", event: statusData as PythonStatusEvent });
			}
			// Status events don't produce text output
			return { text: "", outputs };
		}

		if (typeof data["image/png"] === "string") {
			outputs.push({ type: "image", data: data["image/png"] as string, mimeType: "image/png" });
		}
		if (data["application/json"] !== undefined) {
			outputs.push({ type: "json", data: data["application/json"] });
		}

		// Check text/markdown before text/plain since Markdown objects provide both
		// (text/plain is just the repr)
		if (typeof data["text/markdown"] === "string") {
			return { text: normalizeDisplayText(String(data["text/markdown"])), outputs };
		}
		if (typeof data["text/plain"] === "string") {
			return { text: normalizeDisplayText(String(data["text/plain"])), outputs };
		}
		if (data["text/html"] !== undefined) {
			const markdown = htmlToBasicMarkdown(String(data["text/html"])) || "";
			return { text: markdown ? normalizeDisplayText(markdown) : "", outputs };
		}
		return { text: "", outputs };
	}

	private sendMessage(msg: JupyterMessage): void {
		if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
			throw new Error("WebSocket not connected");
		}

		if (TRACE_IPC) {
			logger.debug("Kernel IPC send", {
				channel: msg.channel,
				msgType: msg.header.msg_type,
				msgId: msg.header.msg_id,
			});
		}

		const payload = {
			channel: msg.channel,
			header: msg.header,
			parent_header: msg.parent_header,
			metadata: msg.metadata,
			content: msg.content,
		};
		if (msg.buffers && msg.buffers.length > 0) {
			this.#ws.send(serializeWebSocketMessage(msg));
			return;
		}
		this.#ws.send(JSON.stringify(payload));
	}
}
