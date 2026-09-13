import { getEnvApiKey } from "../env-api-keys.ts";
import { calculateCost } from "../models.ts";
import type {
	AssistantMessage,
	Context,
	Model,
	ModelThinkingLevel,
	SimpleStreamOptions,
	StreamFunction,
	StreamOptions,
} from "../types.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";
import {
	assertDevinOrigin,
	DEVIN_BASE_URL,
	DEVIN_LONG_CONTEXT_TOKENS,
	devinMetadata,
	getDevinJwt,
	getDevinRoute,
	normalizeDevinToken,
} from "./devin-api.ts";
import { encodeFrame } from "./devin-connect.ts";
import { readConnectFrames } from "./devin-connect-stream.ts";
import { field, ProtoMessage } from "./devin-protobuf.ts";
import { buildDevinRequest } from "./devin-request.ts";
import { DevinStreamState } from "./devin-stream-state.ts";

export interface DevinOptions extends StreamOptions {
	reasoning?: ModelThinkingLevel;
}

export const streamDevin: StreamFunction<"devin-agent", DevinOptions> = (
	model: Model<"devin-agent">,
	context: Context,
	options: DevinOptions = {},
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
		let response: Response | undefined;
		try {
			signal.throwIfAborted();
			assertDevinOrigin(model.baseUrl);
			if (model.id !== "swe-2") throw new Error("The Devin adapter currently supports SWE-2 only");
			const reasoning = options.reasoning ?? "medium";
			if (!["medium", "high", "max"].includes(reasoning))
				throw new Error(`Devin SWE-2 does not support ${reasoning} reasoning`);
			const token = normalizeDevinToken(options.apiKey ?? getEnvApiKey("devin") ?? "");
			const jwt = await getDevinJwt(token, signal);
			// The local budget selects the lane: 1,000,000+ asks for the catalog's 1M-context lane.
			const route = await getDevinRoute(token, reasoning, signal, {
				longContext: model.contextWindow >= DEVIN_LONG_CONTEXT_TOKENS,
			});
			if (route.contextWindow > 0 && route.contextWindow < model.contextWindow) {
				throw new Error(
					`Devin SWE-2 ${route.longContext ? "1M-context lane" : "standard lane"} declares a ${route.contextWindow}-token context window; lower the models.json contextWindow before retrying`,
				);
			}
			const maxTokens = Math.min(
				options.maxTokens ?? model.maxTokens,
				model.maxTokens,
				route.maxTokens || model.maxTokens,
			);
			const sessionId = options.sessionId ?? crypto.randomUUID();
			const request = buildDevinRequest(model, context, route.uid, sessionId, maxTokens, options);
			const replacement = await options.onPayload?.(request, model);
			const payload = replacement === undefined ? request : replacement;
			if (!(payload instanceof Uint8Array) || new ProtoMessage(payload).messages(1).length)
				throw new Error("Devin payload hook must return protobuf bytes without auth metadata");
			signal.throwIfAborted();
			response = await fetch(`${DEVIN_BASE_URL}/exa.api_server_pb.ApiServerService/GetChatMessage`, {
				method: "POST",
				redirect: "error",
				signal,
				headers: {
					...model.headers,
					...options.headers,
					"Content-Type": "application/connect+proto",
					"Connect-Protocol-Version": "1",
					"Connect-Accept-Encoding": "gzip",
					"Accept-Encoding": "identity",
				},
				body: encodeFrame(Buffer.concat([field(1, devinMetadata(token, jwt)), payload])),
			});
			await options.onResponse?.({ status: response.status, headers: Object.fromEntries(response.headers) }, model);
			const state = new DevinStreamState(output, stream);
			stream.push({ type: "start", partial: output });
			for await (const frame of readConnectFrames(response, signal)) state.accept(frame);
			signal.throwIfAborted();
			const reason = state.finish();
			output.stopReason = reason;
			calculateCost(model, output.usage);
			stream.push({ type: "done", reason, message: output });
		} catch (error) {
			output.stopReason = options.signal?.aborted ? "aborted" : "error";
			output.errorMessage =
				controller.signal.aborted && !options.signal?.aborted
					? "Devin request timed out"
					: error instanceof Error
						? error.message
						: "Devin request failed";
			stream.push({ type: "error", reason: output.stopReason, error: output });
		} finally {
			clearTimeout(timer);
			if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
			stream.end(output);
		}
	})();
	return stream;
};

export const streamSimpleDevin: StreamFunction<"devin-agent", SimpleStreamOptions> = (model, context, options) =>
	streamDevin(model, context, options);
