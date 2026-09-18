/**
 * Cursor subscription adapter (`cursor-agent` API).
 *
 * Implements the `agent.v1.AgentService/Run` bidirectional RPC over HTTP/2 at
 * https://api2.cursor.sh with Connect-framed protobuf, following the same
 * reverse-engineered protocol notes as the Devin adapter (see DEVIN-NOTICE).
 *
 * Turn model: each `stream()` call is one `Run` with a `userMessageAction` (or a
 * `resumeAction` when the last message is not a user turn). Conversation history
 * is replayed through `conversationState.rootPromptMessagesJson` — SHA256-keyed
 * JSON message blobs the server fetches back through the kv channel
 * (`getBlobArgs` → `getBlobResult`). System prompts ride `requestContext.rules`
 * in the exec handshake (`requestContextArgs` → `requestContextResult`).
 *
 * Scope: text and thinking deltas, token usage, blob/context/interaction
 * handshakes, and graceful rejection of tool execution frames. OMK tools are
 * intentionally not advertised in `requestContext.tools` — a frame the server
 * sends for client-side execution is answered with the protocol's `throw`
 * failure channel instead of being run unguarded inside the provider. Wiring
 * exec frames through governed OMK tools is a coding-agent bridge feature, not
 * provider scope.
 */

import { createHash } from "node:crypto";
import http2 from "node:http2";
import { getEnvApiKey } from "../env-api-keys.ts";
import { calculateCost } from "../models.ts";
import type {
	AssistantMessage,
	Context,
	ImageContent,
	Message,
	Model,
	SimpleStreamOptions,
	StreamFunction,
	StreamOptions,
	TextContent,
	ToolResultMessage,
} from "../types.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { field, ProtoMessage } from "./devin-protobuf.ts";

export const CURSOR_API_URL = "https://api2.cursor.sh";
export const CURSOR_CLIENT_VERSION = "cli-2026.02.13-41ac335";
const CURSOR_RUN_PATH = "/agent.v1.AgentService/Run";
const CONNECT_END_STREAM_FLAG = 0b00000010;
const HEARTBEAT_INTERVAL_MS = 5_000;
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const REJECTED_SUFFIX = "not implemented by this client";
const CURSOR_DEBUG = process.env.OMK_DEBUG_CURSOR === "1";

// ---------------------------------------------------------------------------
// Protobuf wire helpers (field numbers from the Cursor agent.v1 schema)
// ---------------------------------------------------------------------------

function frameConnectMessage(data: Uint8Array, flags = 0): Buffer {
	const frame = Buffer.alloc(5 + data.length);
	frame[0] = flags;
	frame.writeUInt32BE(data.length, 1);
	frame.set(data, 5);
	return frame;
}

function blobId(data: Uint8Array): Uint8Array {
	return new Uint8Array(createHash("sha256").update(data).digest());
}

/** Raw blob for pre-encoded payload bytes (system prompt JSON strings). */
function rawBlob(store: Map<string, Uint8Array>, data: Uint8Array): Uint8Array {
	const id = blobId(data);
	store.set(Buffer.from(id).toString("hex"), data);
	return id;
}

/** JSON message blob for `rootPromptMessagesJson` (Vercel-AI-SDK-shaped). */
function jsonBlob(store: Map<string, Uint8Array>, value: unknown): Uint8Array {
	return rawBlob(store, new TextEncoder().encode(JSON.stringify(value)));
}

function readBlob(store: Map<string, Uint8Array>, id: Uint8Array): Uint8Array | undefined {
	return store.get(Buffer.from(id).toString("hex"));
}

function normalizeToolCallId(id: string): string {
	const cleaned = id.replace(/[^a-zA-Z0-9_-]/g, "");
	return cleaned || crypto.randomUUID();
}

function normalizeCursorArgs(value: unknown, seen = new Set<object>()): unknown {
	if (value === null || typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	if (typeof value !== "object" || seen.has(value)) return undefined;
	seen.add(value);
	try {
		if (Array.isArray(value)) return value.map((item) => normalizeCursorArgs(item, seen) ?? null);
		const out: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
			const normalized = normalizeCursorArgs(item, seen);
			if (normalized !== undefined) out[key] = normalized;
		}
		return out;
	} finally {
		seen.delete(value);
	}
}

// ---------------------------------------------------------------------------
// Request building
// ---------------------------------------------------------------------------

const OPENAI_WIRE_PREFIX = /^(gpt-|composer|o\d)/i;
const EFFORT_SUFFIXES = ["minimal", "low", "medium", "high", "xhigh", "max", "none"] as const;
type CursorEffort = (typeof EFFORT_SUFFIXES)[number];

function splitEffortSuffix(id: string): { base: string; effort?: CursorEffort; fast: boolean } {
	let rest = id;
	let fast = false;
	if (rest.endsWith("-fast")) {
		fast = true;
		rest = rest.slice(0, -5);
	}
	for (const suffix of EFFORT_SUFFIXES) {
		if (rest.endsWith(`-${suffix}`)) {
			return { base: rest.slice(0, -(suffix.length + 1)), effort: suffix, fast };
		}
	}
	return { base: id, fast };
}

function isOpenAiFamily(id: string): boolean {
	return OPENAI_WIRE_PREFIX.test(id) && !id.startsWith("composer");
}

/**
 * Resolve the wire `model_id` and effort `parameters`. Cursor's Run endpoint
 * rejects effort sibling slugs for OpenAI-family ids (`resource_exhausted`);
 * the official agent splits the slug into the base id plus a `reasoning`
 * parameter. Non-OpenAI ids pass through whole. A bare `composer-2.5` pins
 * `fast=false` because the server resolves it to the Fast tier otherwise.
 */
export function resolveCursorWireModel(modelId: string): { modelId: string; parameters: Buffer[] } {
	const { base, effort, fast } = splitEffortSuffix(modelId);
	if (effort !== undefined && isOpenAiFamily(base)) {
		if (effort === "none") return { modelId: fast ? `${base}-fast` : base, parameters: [] };
		return {
			modelId: fast ? `${base}-fast` : base,
			parameters: [Buffer.concat([field(1, "reasoning"), field(2, effort)])],
		};
	}
	if (modelId === "composer-2.5") {
		return { modelId, parameters: [Buffer.concat([field(1, "fast"), field(2, "false")])] };
	}
	return { modelId, parameters: [] };
}

function systemPromptJsons(systemPrompt: string | undefined): string[] {
	const prompts = (systemPrompt ?? "")
		.split(/\n{3,}/)
		.map((part) => part.trim())
		.filter(Boolean);
	if (prompts.length === 0) return [JSON.stringify({ role: "system", content: "You are a helpful assistant." })];
	return prompts.map((content) => JSON.stringify({ role: "system", content }));
}

function rootPromptContent(content: Message["content"]): unknown[] {
	const parts: unknown[] = [];
	if (typeof content === "string") {
		const text = content.trim();
		if (text) parts.push({ type: "text", text });
		return parts;
	}
	for (const item of content) {
		if (item.type === "text") {
			const text = (item as TextContent).text.trim();
			if (text) parts.push({ type: "text", text });
		} else if (item.type === "image") {
			const image = item as ImageContent;
			parts.push({ type: "image", image: `data:${image.mimeType};base64,${image.data}`, mediaType: image.mimeType });
		}
	}
	return parts;
}

function assistantContent(msg: Message, targetModelId: string): unknown[] {
	const parts: unknown[] = [];
	if (typeof msg.content === "string") {
		if (msg.content.trim()) parts.push({ type: "text", text: msg.content });
		return parts;
	}
	for (const item of msg.content) {
		if (item.type === "text" && item.text) {
			parts.push({ type: "text", text: item.text });
		} else if (item.type === "thinking" && item.thinking) {
			// Replay reasoning only for blocks this provider produced for the same
			// wire model; foreign-provider thinking goes out unsigned and can get
			// the whole Run rejected.
			const msgModel = (msg as AssistantMessage).model;
			if ((msg as AssistantMessage).provider === "cursor" && msgModel === targetModelId) {
				parts.push({
					type: "reasoning",
					text: item.thinking,
					providerOptions: { cursor: { modelName: msgModel } },
					...(item.thinkingSignature ? { signature: item.thinkingSignature } : {}),
				});
			}
		} else if (item.type === "toolCall") {
			parts.push({
				type: "tool-call",
				toolCallId: normalizeToolCallId(item.id),
				toolName: item.name,
				args: normalizeCursorArgs(item.arguments) ?? {},
			});
		}
	}
	return parts;
}

function toolResultText(result: ToolResultMessage): string {
	return result.content
		.map((item) => (item.type === "text" ? item.text : `[${(item as ImageContent).mimeType} image]`))
		.join("\n");
}

function buildRootPromptBlobIds(
	messages: Message[],
	systemPromptIds: Uint8Array[],
	blobStore: Map<string, Uint8Array>,
	historyEnd: number,
	targetModelId: string,
): Uint8Array[] {
	const ids = [...systemPromptIds];
	const pairedToolCallIds = new Set<string>();
	for (let i = 0; i < historyEnd; i++) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			for (const item of Array.isArray(msg.content) ? msg.content : []) {
				if (item.type === "toolCall") pairedToolCallIds.add(item.id);
			}
		}
	}
	for (let i = 0; i < historyEnd && i < messages.length; i++) {
		const msg = messages[i];
		if (msg.role === "user") {
			const content = rootPromptContent(msg.content);
			if (content.length === 0) continue;
			ids.push(jsonBlob(blobStore, { role: "user", content }));
		} else if (msg.role === "assistant") {
			const content = assistantContent(msg, targetModelId);
			if (content.length === 0) continue;
			ids.push(jsonBlob(blobStore, { role: "assistant", content }));
		} else if (msg.role === "toolResult") {
			const result = msg as ToolResultMessage;
			if (!pairedToolCallIds.has(result.toolCallId)) {
				ids.push(
					jsonBlob(blobStore, {
						role: "assistant",
						content: [
							{
								type: "text",
								text: `${result.isError ? "[Tool Error]" : "[Tool Result]"}\n${toolResultText(result) || "(empty result)"}`,
							},
						],
					}),
				);
				continue;
			}
			const toolCallId = normalizeToolCallId(result.toolCallId);
			ids.push(
				jsonBlob(blobStore, {
					role: "tool",
					id: toolCallId,
					content: [
						{
							type: "tool-result",
							toolName: result.toolName,
							toolCallId,
							result: toolResultText(result),
							...(result.isError ? { isError: true } : {}),
						},
					],
				}),
			);
		}
	}
	return ids;
}

function userMessageProto(content: Message["content"], text: string): Buffer {
	const images = Array.isArray(content) ? (content.filter((c) => c.type === "image") as ImageContent[]) : [];
	const fields = [field(1, text), field(2, crypto.randomUUID())];
	if (images.length > 0) {
		const selected = images.map((image) =>
			Buffer.concat([
				field(2, crypto.randomUUID()),
				field(7, image.mimeType),
				field(8, Buffer.from(image.data, "base64")),
			]),
		);
		fields.push(field(3, Buffer.concat(selected.map((img) => field(1, img)))));
	}
	return Buffer.concat(fields);
}

function cursorRule(index: number, content: string): Buffer {
	return Buffer.concat([
		field(1, `/omk/system-prompt/${index}.mdc`),
		field(2, content),
		field(3, field(1, new Uint8Array(0))), // type: global {}
		field(4, 2), // source: USER
	]);
}

function buildRequestContext(systemPrompt: string | undefined): Buffer {
	const rules = systemPromptJsons(systemPrompt).map((json, index) => {
		const content = (JSON.parse(json) as { content: string }).content;
		return field(2, cursorRule(index, content));
	});
	return Buffer.concat(rules);
}

interface CursorTransportRequest {
	bytes: Uint8Array;
	blobStore: Map<string, Uint8Array>;
}

function buildRunRequest(
	model: Model<"cursor-agent">,
	context: Context,
	options: CursorOptions,
): CursorTransportRequest {
	const blobStore = new Map<string, Uint8Array>();
	const systemPromptIds = systemPromptJsons(context.systemPrompt).map((json) =>
		rawBlob(blobStore, new TextEncoder().encode(json)),
	);
	const activeIndex = context.messages.length - 1;
	const active = context.messages[activeIndex];
	const activeUser = active && active.role === "user" ? active : undefined;
	const userText = activeUser
		? typeof activeUser.content === "string"
			? activeUser.content.trim()
			: activeUser.content
					.filter((c): c is TextContent => c.type === "text")
					.map((c) => c.text)
					.join("\n")
					.trim()
		: "";
	const hasImages =
		activeUser && Array.isArray(activeUser.content) ? activeUser.content.some((c) => c.type === "image") : false;
	const historyEnd = activeUser ? activeIndex : context.messages.length;
	const rootIds = buildRootPromptBlobIds(context.messages, systemPromptIds, blobStore, historyEnd, model.id);

	const conversationState = Buffer.concat(rootIds.map((id) => field(1, id)));
	const action =
		activeUser && (userText.length > 0 || hasImages)
			? field(1, field(1, userMessageProto(activeUser.content, userText)))
			: field(2, new Uint8Array(0)); // resumeAction {}

	const { modelId: wireModelId, parameters } = resolveCursorWireModel(model.id);
	const maxMode = cursorMaxModeFor(model.id);
	const modelDetails = Buffer.concat([
		field(1, wireModelId),
		field(3, model.id),
		field(4, model.name),
		...(maxMode ? [field(7, true)] : []),
	]);
	const requestedModel = Buffer.concat([
		field(1, wireModelId),
		...(maxMode ? [field(2, true)] : []),
		...parameters.map((parameter) => field(3, parameter)),
	]);

	const runRequest = Buffer.concat([
		field(1, conversationState),
		field(2, action),
		field(3, modelDetails),
		field(9, requestedModel),
		field(5, options.sessionId ?? crypto.randomUUID()),
	]);
	return { bytes: field(1, runRequest), blobStore };
}

/** Mirror the server-declared `maxMode` flag (fast Claude lanes). */
function cursorMaxModeFor(modelId: string): boolean {
	return /^claude-.*-fast$/.test(modelId);
}

// ---------------------------------------------------------------------------
// Outbound client messages
// ---------------------------------------------------------------------------

function execClientResult(id: number, execId: string, caseNo: number, result: Buffer): Buffer {
	const execMessage = Buffer.concat([field(1, id), field(15, execId), field(caseNo, result)]);
	return frameConnectMessage(field(2, execMessage));
}

function execThrow(id: number, _execId: string, error: string): Buffer[] {
	const throwMsg = field(5, Buffer.concat([field(2, Buffer.concat([field(1, id), field(2, error)]))]));
	const closeMsg = field(5, field(1, field(1, id)));
	return [frameConnectMessage(throwMsg), frameConnectMessage(closeMsg)];
}

function kvBlobResult(id: number, blobData: Uint8Array | undefined): Buffer {
	const kv = Buffer.concat([field(1, id), field(2, blobData ? field(1, blobData) : new Uint8Array(0))]);
	return frameConnectMessage(field(3, kv));
}

function kvSetBlobResult(id: number): Buffer {
	return frameConnectMessage(field(3, Buffer.concat([field(1, id), field(3, new Uint8Array(0))])));
}

function interactionResponse(id: number, fieldNo: number, payload: Buffer): Buffer {
	const response = Buffer.concat([field(1, id), field(fieldNo, payload)]);
	return frameConnectMessage(field(6, response));
}

// ---------------------------------------------------------------------------
// Stream adapter
// ---------------------------------------------------------------------------

export interface CursorOptions extends StreamOptions {}

interface TextBlock {
	index: number;
	text: string;
}

export const streamCursor: StreamFunction<"cursor-agent", CursorOptions> = (
	model: Model<"cursor-agent">,
	context: Context,
	options: CursorOptions = {},
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();
	const output: AssistantMessage = {
		role: "assistant",
		api: model.api,
		provider: model.provider,
		model: model.id,
		content: [],
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};

	(async () => {
		const controller = new AbortController();
		const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
		const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 600_000);
		let h2Client: http2.ClientHttp2Session | undefined;
		let h2Request: http2.ClientHttp2Stream | undefined;
		let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
		let sawTurnEnded = false;
		let endStreamError: Error | undefined;
		const write = (frame: Buffer | undefined) => {
			if (frame && h2Request && !h2Request.closed && !h2Request.destroyed) h2Request.write(frame);
		};

		try {
			signal.throwIfAborted();
			const token = (options.apiKey ?? getEnvApiKey("cursor") ?? "").trim();
			if (!token) throw new Error("Missing Cursor access token; run /login cursor");
			const baseUrl = (model.baseUrl || CURSOR_API_URL).replace(/\/+$/, "");
			if (!/^https:\/\/[a-z0-9.-]*cursor\.(sh|com|dev)(:\d+)?$/.test(baseUrl)) {
				throw new Error("Cursor subscription credentials require a *.cursor.sh/cursor.com HTTPS origin");
			}

			const built = buildRunRequest(model, context, options);
			const requestContext = buildRequestContext(context.systemPrompt);
			const request = await options.onPayload?.(built.bytes, model);
			const payload = request === undefined ? built.bytes : request;
			if (!(payload instanceof Uint8Array) || new ProtoMessage(payload).messages(1).length !== 1)
				throw new Error("Cursor payload hook must return protobuf bytes for a single runRequest");

			h2Client = http2.connect(baseUrl);
			h2Client.on("error", (error) => {
				endStreamError ??= error instanceof Error ? error : new Error(String(error));
			});
			const requestHeaders = {
				":method": "POST",
				":path": CURSOR_RUN_PATH,
				"content-type": "application/connect+proto",
				"connect-protocol-version": "1",
				te: "trailers",
				authorization: `Bearer ${token}`,
				"x-ghost-mode": "true",
				"x-cursor-client-version": CURSOR_CLIENT_VERSION,
				"x-cursor-client-type": "cli",
				"x-request-id": crypto.randomUUID(),
				...(options.headers ?? {}),
			};
			h2Request = h2Client.request(requestHeaders);

			let textBlock: TextBlock | undefined;
			let thinkingBlock: TextBlock | undefined;
			const endText = () => {
				if (!textBlock) return;
				stream.push({ type: "text_end", contentIndex: textBlock.index, content: textBlock.text, partial: output });
				textBlock = undefined;
			};
			const endThinking = () => {
				if (!thinkingBlock) return;
				stream.push({
					type: "thinking_end",
					contentIndex: thinkingBlock.index,
					content: thinkingBlock.text,
					partial: output,
				});
				thinkingBlock = undefined;
			};

			stream.push({ type: "start", partial: output });
			h2Request.write(frameConnectMessage(payload));
			heartbeatTimer = setInterval(
				() => write(frameConnectMessage(field(7, new Uint8Array(0)))),
				HEARTBEAT_INTERVAL_MS,
			);
			if (options.signal) {
				options.signal.addEventListener("abort", () => h2Request?.close(), { once: true });
			}

			await new Promise<void>((resolve) => {
				let pending: Buffer = Buffer.alloc(0);
				h2Request!.on("data", (chunk: Buffer) => {
					pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
					while (pending.length >= 5) {
						const flags = pending[0];
						const length = pending.readUInt32BE(1);
						if (length > MAX_FRAME_BYTES) {
							endStreamError ??= new Error(`Cursor frame exceeds ${MAX_FRAME_BYTES} bytes`);
							h2Request?.close();
							return;
						}
						if (pending.length < 5 + length) break;
						const messageBytes = pending.subarray(5, 5 + length);
						pending = pending.subarray(5 + length);
						if (flags & CONNECT_END_STREAM_FLAG) {
							try {
								const payload = JSON.parse(new TextDecoder().decode(messageBytes)) as {
									error?: { code?: string; message?: string };
								};
								if (payload.error) {
									endStreamError = new Error(
										`Cursor ${payload.error.code ?? "error"}: ${payload.error.message ?? "unknown error"}`,
									);
								}
							} catch {
								endStreamError = new Error("Failed to parse Cursor end-stream trailer");
							}
							continue;
						}
						try {
							dispatchServerMessage(new ProtoMessage(messageBytes));
						} catch (error) {
							if (!endStreamError) endStreamError = error instanceof Error ? error : new Error(String(error));
						}
					}
				});
				h2Request!.on("trailers", (trailers) => {
					const status = trailers["grpc-status"];
					const message = trailers["grpc-message"];
					if (status && status !== "0") {
						endStreamError ??= new Error(
							`Cursor gRPC error ${status}: ${decodeURIComponent(String(message ?? ""))}`,
						);
					}
				});
				h2Request!.on("end", resolve);
				h2Request!.on("error", (error) => {
					endStreamError ??= error instanceof Error ? error : new Error(String(error));
					resolve();
				});
				h2Request!.on("close", resolve);
			});

			function dispatchServerMessage(message: ProtoMessage): void {
				if (CURSOR_DEBUG) {
					const cases = [1, 2, 3, 4, 5, 7].filter((n) => message.has(n));
					console.error(`[cursor] server cases=${cases.join(",")}`);
				}
				if (message.has(1)) {
					for (const update of message.messages(1)) handleInteractionUpdate(update);
					return;
				}
				if (message.has(2)) {
					for (const exec of message.messages(2)) handleExecMessage(exec);
					return;
				}
				if (message.has(4)) {
					for (const kv of message.messages(4)) {
						const id = kv.number(1);
						for (const getBlob of kv.messages(2)) {
							const blobIdBytes = getBlob.bytes(1) ?? new Uint8Array(0);
							const data = readBlob(built.blobStore, blobIdBytes);
							if (CURSOR_DEBUG)
								console.error(
									`[cursor] kv getBlob id=${id} blob=${Buffer.from(blobIdBytes).toString("hex").slice(0, 16)} found=${!!data}`,
								);
							write(kvBlobResult(id, data));
						}
						for (const setBlob of kv.messages(3)) {
							const blobIdBytes = setBlob.bytes(1);
							const blobData = setBlob.bytes(2);
							if (blobIdBytes && blobData) {
								built.blobStore.set(Buffer.from(blobIdBytes).toString("hex"), blobData);
							}
							write(kvSetBlobResult(id));
							if (CURSOR_DEBUG) console.error(`[cursor] kv setBlob id=${id}`);
						}
					}
					return;
				}
				if (message.has(5)) {
					// execServerControlMessage: abort/stop signals — treat as turn end.
					for (const control of message.messages(5)) {
						if (control.has(1)) sawTurnEnded = true;
					}
					return;
				}
				if (message.has(7)) {
					for (const query of message.messages(7)) handleInteractionQuery(query);
				}
			}

			function handleInteractionUpdate(update: ProtoMessage): void {
				if (CURSOR_DEBUG) {
					const cases = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].filter((n) => update.has(n));
					console.error(`[cursor] update cases=${cases.join(",")}`);
				}
				for (const delta of update.messages(1)) {
					endThinking();
					const text = delta.string(1);
					if (!textBlock) {
						textBlock = { index: output.content.length, text: "" };
						output.content.push({ type: "text", text: "" });
						stream.push({ type: "text_start", contentIndex: textBlock.index, partial: output });
					}
					textBlock.text += text;
					(output.content[textBlock.index] as TextContent).text = textBlock.text;
					stream.push({ type: "text_delta", contentIndex: textBlock.index, delta: text, partial: output });
				}
				for (const delta of update.messages(4)) {
					endText();
					const text = delta.string(1);
					if (!thinkingBlock) {
						thinkingBlock = { index: output.content.length, text: "" };
						output.content.push({ type: "thinking", thinking: "", thinkingSignature: "" });
						stream.push({ type: "thinking_start", contentIndex: thinkingBlock.index, partial: output });
					}
					thinkingBlock.text += text;
					(output.content[thinkingBlock.index] as { thinking: string }).thinking = thinkingBlock.text;
					stream.push({ type: "thinking_delta", contentIndex: thinkingBlock.index, delta: text, partial: output });
				}
				for (const tokens of update.messages(8)) {
					output.usage.output += tokens.number(1);
				}
				if (update.has(14)) {
					endThinking();
					endText();
					sawTurnEnded = true;
				}
			}

			function handleExecMessage(exec: ProtoMessage): void {
				const id = exec.number(1);
				const execId = exec.string(15);
				if (CURSOR_DEBUG) console.error(`[cursor] exec id=${id} execId=${execId} case=${execCaseName(exec)}`);
				if (exec.has(10)) {
					// requestContextArgs — the exec handshake carrying rules/tools.
					const result = field(1, field(1, requestContext));
					write(execClientResult(id, execId, 10, result));
					return;
				}
				for (const frame of execThrow(id, execId, `Cursor ${execCaseName(exec)} execution is ${REJECTED_SUFFIX}`)) {
					write(frame);
				}
			}

			function handleInteractionQuery(query: ProtoMessage): void {
				const id = query.number(1);
				const approved = field(1, new Uint8Array(0));
				for (const fieldNo of [2, 5, 6, 9]) {
					if (query.has(fieldNo)) {
						write(interactionResponse(id, fieldNo, approved));
						return;
					}
				}
				if (query.has(3)) {
					write(interactionResponse(id, 3, field(3, field(1, `Interactive questions are ${REJECTED_SUFFIX}`))));
					return;
				}
				if (query.has(4)) {
					write(interactionResponse(id, 4, field(2, field(1, `Mode switches are ${REJECTED_SUFFIX}`))));
					return;
				}
				if (query.has(7)) {
					// createPlan → result{ error{ error } }
					write(interactionResponse(id, 7, field(1, field(2, field(1, `Plan files are ${REJECTED_SUFFIX}`)))));
					return;
				}
				// setupVmEnvironmentArgs (8) is intentionally left unanswered rather
				// than reporting a fake success.
			}
		} catch (error) {
			endStreamError ??= error instanceof Error ? error : new Error(String(error));
		} finally {
			if (heartbeatTimer) clearInterval(heartbeatTimer);
			h2Request?.close();
			h2Client?.close();
			clearTimeout(timer);
		}

		// Finalize outside the try so close-flush always runs once.
		try {
			if (endStreamError) throw endStreamError;
			if (!sawTurnEnded) {
				throw options.signal?.aborted
					? Object.assign(new Error("aborted"), { name: "AbortError" })
					: new Error("Cursor stream ended before the turn completed");
			}
			output.stopReason = "stop";
			calculateCost(model, output.usage);
			stream.push({ type: "done", reason: "stop", message: output });
		} catch (error) {
			output.stopReason = options.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : "Cursor request failed";
			stream.push({ type: "error", reason: output.stopReason, error: output });
		} finally {
			stream.end(output);
		}
	})();
	return stream;
};

function execCaseName(exec: ProtoMessage): string {
	for (const [no, name] of EXEC_CASE_NAMES) {
		if (exec.has(no)) return name;
	}
	return "exec";
}

const EXEC_CASE_NAMES: ReadonlyArray<readonly [number, string]> = [
	[2, "shell"],
	[3, "write"],
	[4, "delete"],
	[5, "grep"],
	[7, "read"],
	[8, "ls"],
	[9, "diagnostics"],
	[10, "requestContext"],
	[11, "mcp"],
	[14, "shellStream"],
	[16, "backgroundShellSpawn"],
	[17, "listMcpResources"],
	[18, "readMcpResource"],
	[20, "fetch"],
	[21, "recordScreen"],
	[22, "computerUse"],
	[23, "writeShellStdin"],
	[29, "redactedRead"],
	[36, "mcpState"],
	[27, "executeHook"],
	[28, "subagent"],
	[30, "forceBackgroundShell"],
	[31, "forceBackgroundSubagent"],
	[37, "subagentAwait"],
	[38, "smartModeClassifier"],
	[40, "canvasDiagnostics"],
	[41, "shellAllowlistPrecheck"],
	[42, "mcpAllowlistPrecheck"],
	[43, "webFetchAllowlistPrecheck"],
	[44, "gitDiff"],
	[45, "piRead"],
	[46, "piBash"],
	[47, "piEdit"],
	[48, "piWrite"],
	[49, "piGrep"],
	[50, "piFind"],
	[51, "piLs"],
	[52, "conversationSearch"],
	[54, "agentStoreConflict"],
	[56, "miniSweAgentBash"],
];

export const streamSimpleCursor: StreamFunction<"cursor-agent", SimpleStreamOptions> = (model, context, options) =>
	streamCursor(model, context, options);
