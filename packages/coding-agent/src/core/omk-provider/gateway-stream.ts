import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEvent,
	type Context,
	createAssistantMessageEventStream,
	type Model,
	type SimpleStreamOptions,
} from "omk-ai";
import { OMK_BASE_URL_UNSET } from "./base-url.ts";
import { type OmkCallCapture, runWithOmkCapture } from "./gateway-capture.ts";
import {
	describeOmkGatewayFailure,
	OMK_BASE_URL_MISSING_MESSAGE,
	OMK_TOKEN_MISSING_MESSAGE,
	redactOmkToken,
} from "./messages.ts";
import { omkStreamSimple } from "./route.ts";

/**
 * OMK stream path with account/limit error texts: routes like {@link omkStreamSimple}, then rewrites the error of a
 * failed request into the OMK text for its gateway code, and never lets the token appear in an error.
 */
export function omkGatewayStreamSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions) {
	if (model.baseUrl === OMK_BASE_URL_UNSET) return refusal(model, OMK_BASE_URL_MISSING_MESSAGE);
	const token = options?.apiKey;
	const capture: OmkCallCapture = {};
	const source = runWithOmkCapture(capture, () => omkStreamSimple(model, context, options));
	const out = createAssistantMessageEventStream();

	const rewrite = (event: AssistantMessageEvent): AssistantMessageEvent => {
		if (event.type !== "error" || !event.error.errorMessage) return event;
		const message = event.error;
		const text = !token
			? OMK_TOKEN_MISSING_MESSAGE
			: ((capture.failure && describeOmkGatewayFailure(capture.failure)) ?? message.errorMessage);
		message.errorMessage = redactOmkToken(text ?? "", token);
		return event;
	};

	void (async () => {
		try {
			for await (const event of source) out.push(rewrite(event));
		} finally {
			out.end();
		}
	})();
	return out;
}

/** A stream that ends with `text` as its error and sends nothing. */
function refusal(model: Model<Api>, text: string) {
	const out = createAssistantMessageEventStream();
	const message: AssistantMessage = {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error",
		errorMessage: text,
		timestamp: Date.now(),
	};
	out.push({ type: "error", reason: "error", error: message });
	return out;
}
