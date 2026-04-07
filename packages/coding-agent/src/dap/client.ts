import { logger, ptree } from "@oh-my-pi/pi-utils";
import { NON_INTERACTIVE_ENV } from "../exec/non-interactive-env";
import { ToolAbortError } from "../tools/tool-errors";
import type {
	DapCapabilities,
	DapClientState,
	DapEventMessage,
	DapInitializeArguments,
	DapPendingRequest,
	DapRequestMessage,
	DapResolvedAdapter,
	DapResponseMessage,
} from "./types";

interface DapSpawnOptions {
	adapter: DapResolvedAdapter;
	cwd: string;
}

type DapEventHandler = (body: unknown, event: DapEventMessage) => void | Promise<void>;

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

function findHeaderEnd(buffer: Uint8Array): number {
	for (let index = 0; index < buffer.length - 3; index += 1) {
		if (buffer[index] === 13 && buffer[index + 1] === 10 && buffer[index + 2] === 13 && buffer[index + 3] === 10) {
			return index;
		}
	}
	return -1;
}

function parseMessage(
	buffer: Buffer,
): { message: DapResponseMessage | DapEventMessage | DapRequestMessage; remaining: Buffer } | null {
	const headerEndIndex = findHeaderEnd(buffer);
	if (headerEndIndex === -1) return null;
	const headerText = new TextDecoder().decode(buffer.slice(0, headerEndIndex));
	const contentLengthMatch = headerText.match(/Content-Length: (\d+)/i);
	if (!contentLengthMatch) return null;
	const contentLength = Number.parseInt(contentLengthMatch[1], 10);
	const messageStart = headerEndIndex + 4;
	const messageEnd = messageStart + contentLength;
	if (buffer.length < messageEnd) return null;
	const messageText = new TextDecoder().decode(buffer.subarray(messageStart, messageEnd));
	return {
		message: JSON.parse(messageText) as DapResponseMessage | DapEventMessage | DapRequestMessage,
		remaining: buffer.subarray(messageEnd),
	};
}

async function writeMessage(sink: Bun.FileSink, message: DapRequestMessage | DapResponseMessage): Promise<void> {
	const content = JSON.stringify(message);
	sink.write(`Content-Length: ${Buffer.byteLength(content, "utf-8")}\r\n\r\n`);
	sink.write(content);
	await sink.flush();
}

function toErrorMessage(value: unknown): string {
	if (value instanceof Error) return value.message;
	return String(value);
}

export class DapClient {
	readonly adapter: DapResolvedAdapter;
	readonly cwd: string;
	readonly proc: DapClientState["proc"];
	#requestSeq = 0;
	#pendingRequests = new Map<number, DapPendingRequest>();
	#messageBuffer = Buffer.alloc(0);
	#isReading = false;
	#disposed = false;
	#lastActivity = Date.now();
	#capabilities?: DapCapabilities;
	#eventHandlers = new Map<string, Set<DapEventHandler>>();
	#anyEventHandlers = new Set<DapEventHandler>();

	constructor(adapter: DapResolvedAdapter, cwd: string, proc: DapClientState["proc"]) {
		this.adapter = adapter;
		this.cwd = cwd;
		this.proc = proc;
	}

	static async spawn({ adapter, cwd }: DapSpawnOptions): Promise<DapClient> {
		// Merge non-interactive env and start in a new session (detached → setsid)
		// so the adapter process tree has no controlling terminal. Without this,
		// debuggee children can reach /dev/tty and trigger SIGTTIN, suspending
		// the parent harness under shell job control.
		const env = {
			...Bun.env,
			...NON_INTERACTIVE_ENV,
		};
		const proc = ptree.spawn([adapter.resolvedCommand, ...adapter.args], {
			cwd,
			stdin: "pipe",
			env,
			detached: true,
		});
		const client = new DapClient(adapter, cwd, proc);
		proc.exited.then(() => {
			client.#handleProcessExit();
		});
		void client.#startMessageReader();
		return client;
	}

	get capabilities(): DapCapabilities | undefined {
		return this.#capabilities;
	}

	get lastActivity(): number {
		return this.#lastActivity;
	}

	isAlive(): boolean {
		return !this.#disposed && this.proc.exitCode === null;
	}

	async initialize(args: DapInitializeArguments, signal?: AbortSignal, timeoutMs?: number): Promise<DapCapabilities> {
		const body = (await this.sendRequest("initialize", args, signal, timeoutMs)) as DapCapabilities | undefined;
		this.#capabilities = body ?? {};
		return this.#capabilities;
	}

	onEvent(event: string, handler: DapEventHandler): () => void {
		const handlers = this.#eventHandlers.get(event) ?? new Set<DapEventHandler>();
		handlers.add(handler);
		this.#eventHandlers.set(event, handlers);
		return () => {
			handlers.delete(handler);
			if (handlers.size === 0) {
				this.#eventHandlers.delete(event);
			}
		};
	}

	onAnyEvent(handler: DapEventHandler): () => void {
		this.#anyEventHandlers.add(handler);
		return () => {
			this.#anyEventHandlers.delete(handler);
		};
	}

	async waitForEvent<TBody>(
		event: string,
		predicate?: (body: TBody) => boolean,
		signal?: AbortSignal,
		timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
	): Promise<TBody> {
		if (signal?.aborted) {
			throw signal.reason instanceof Error ? signal.reason : new ToolAbortError();
		}
		const { promise, resolve, reject } = Promise.withResolvers<TBody>();
		let timeout: NodeJS.Timeout | undefined;
		const cleanup = () => {
			unsubscribe();
			if (timeout) clearTimeout(timeout);
			if (signal) {
				signal.removeEventListener("abort", abortHandler);
			}
		};
		const abortHandler = () => {
			cleanup();
			reject(signal?.reason instanceof Error ? signal.reason : new ToolAbortError());
		};
		const unsubscribe = this.onEvent(event, body => {
			const typedBody = body as TBody;
			if (predicate && !predicate(typedBody)) {
				return;
			}
			cleanup();
			resolve(typedBody);
		});
		if (signal) {
			signal.addEventListener("abort", abortHandler, { once: true });
		}
		timeout = setTimeout(() => {
			cleanup();
			reject(new Error(`DAP event ${event} timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		return promise;
	}

	async sendRequest<TBody = unknown>(
		command: string,
		args?: unknown,
		signal?: AbortSignal,
		timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
	): Promise<TBody> {
		if (signal?.aborted) {
			throw signal.reason instanceof Error ? signal.reason : new ToolAbortError();
		}
		if (this.#disposed) {
			throw new Error(`DAP adapter ${this.adapter.name} is not running`);
		}
		const requestSeq = ++this.#requestSeq;
		const request: DapRequestMessage = {
			seq: requestSeq,
			type: "request",
			command,
			arguments: args,
		};
		const { promise, resolve, reject } = Promise.withResolvers<TBody>();
		let timeout: NodeJS.Timeout | undefined;
		const cleanup = () => {
			if (timeout) clearTimeout(timeout);
			if (signal) {
				signal.removeEventListener("abort", abortHandler);
			}
		};
		const abortHandler = () => {
			this.#pendingRequests.delete(requestSeq);
			cleanup();
			reject(signal?.reason instanceof Error ? signal.reason : new ToolAbortError());
		};
		timeout = setTimeout(() => {
			if (!this.#pendingRequests.has(requestSeq)) return;
			this.#pendingRequests.delete(requestSeq);
			cleanup();
			reject(new Error(`DAP request ${command} timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		if (signal) {
			signal.addEventListener("abort", abortHandler, { once: true });
		}
		this.#pendingRequests.set(requestSeq, {
			command,
			resolve: body => {
				cleanup();
				resolve(body as TBody);
			},
			reject: error => {
				cleanup();
				reject(error);
			},
		});
		this.#lastActivity = Date.now();
		try {
			await writeMessage(this.proc.stdin, request);
		} catch (error) {
			this.#pendingRequests.delete(requestSeq);
			cleanup();
			throw error;
		}
		return promise;
	}

	async sendResponse(request: DapRequestMessage, success: boolean, body?: unknown, message?: string): Promise<void> {
		const response: DapResponseMessage = {
			seq: ++this.#requestSeq,
			type: "response",
			request_seq: request.seq,
			success,
			command: request.command,
			...(message ? { message } : {}),
			...(body !== undefined ? { body } : {}),
		};
		await writeMessage(this.proc.stdin, response);
	}

	async dispose(): Promise<void> {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#rejectPendingRequests(new Error(`DAP adapter ${this.adapter.name} disposed`));
		try {
			this.proc.kill();
		} catch (error) {
			logger.debug("Failed to kill DAP adapter", {
				adapter: this.adapter.name,
				error: toErrorMessage(error),
			});
		}
		await this.proc.exited.catch(() => {});
	}

	async #startMessageReader(): Promise<void> {
		if (this.#isReading) return;
		this.#isReading = true;
		const reader = (this.proc.stdout as ReadableStream<Uint8Array>).getReader();
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				const currentBuffer = Buffer.concat([this.#messageBuffer, value]);
				this.#messageBuffer = currentBuffer;
				let workingBuffer = currentBuffer;
				let parsed = parseMessage(workingBuffer);
				while (parsed) {
					const { message, remaining } = parsed;
					workingBuffer = Buffer.from(remaining);
					this.#lastActivity = Date.now();
					if (message.type === "response") {
						this.#handleResponse(message);
					} else if (message.type === "event") {
						await this.#dispatchEvent(message);
					} else {
						await this.#handleAdapterRequest(message);
					}
					parsed = parseMessage(workingBuffer);
				}
				this.#messageBuffer = workingBuffer;
			}
		} catch (error) {
			this.#rejectPendingRequests(new Error(`DAP connection closed: ${toErrorMessage(error)}`));
		} finally {
			reader.releaseLock();
			this.#isReading = false;
		}
	}

	#handleResponse(message: DapResponseMessage): void {
		const pending = this.#pendingRequests.get(message.request_seq);
		if (!pending) {
			return;
		}
		this.#pendingRequests.delete(message.request_seq);
		if (message.success) {
			pending.resolve(message.body);
			return;
		}
		const errorMessage = message.message ?? `DAP request ${pending.command} failed`;
		pending.reject(new Error(errorMessage));
	}

	async #dispatchEvent(message: DapEventMessage): Promise<void> {
		const handlers = Array.from(this.#eventHandlers.get(message.event) ?? []);
		const anyHandlers = Array.from(this.#anyEventHandlers);
		for (const handler of [...handlers, ...anyHandlers]) {
			try {
				await handler(message.body, message);
			} catch (error) {
				logger.warn("DAP event handler failed", {
					adapter: this.adapter.name,
					event: message.event,
					error: toErrorMessage(error),
				});
			}
		}
	}

	async #handleAdapterRequest(message: DapRequestMessage): Promise<void> {
		try {
			await this.sendResponse(
				message,
				false,
				{
					error: {
						id: 1,
						format: `Unsupported DAP request: ${message.command}`,
					},
				},
				`Unsupported DAP request: ${message.command}`,
			);
		} catch (error) {
			logger.warn("Failed to answer DAP adapter request", {
				adapter: this.adapter.name,
				command: message.command,
				error: toErrorMessage(error),
			});
		}
	}

	#handleProcessExit(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		const stderr = this.proc.peekStderr().trim();
		const exitCode = this.proc.exitCode;
		const error = new Error(
			stderr
				? `DAP adapter exited (code ${exitCode}): ${stderr}`
				: `DAP adapter exited unexpectedly (code ${exitCode})`,
		);
		this.#rejectPendingRequests(error);
	}

	#rejectPendingRequests(error: Error): void {
		for (const pending of this.#pendingRequests.values()) {
			pending.reject(error);
		}
		this.#pendingRequests.clear();
	}
}
