import {
	type Api,
	type AssistantMessageEvent,
	type Context,
	createAssistantMessageEventStream,
	type Model,
	type SimpleStreamOptions,
} from "omk-ai";
import { type OmkCallCapture, runWithOmkCapture } from "./gateway-capture.ts";
import { describeOmkGatewayFailure, OMK_TOKEN_MISSING_MESSAGE, redactOmkToken } from "./messages.ts";
import { omkStreamSimple } from "./route.ts";

/**
 * OMK stream path with account/limit error texts: routes like {@link omkStreamSimple}, then rewrites the error of a
 * failed request into the OMK text for its gateway code, and never lets the token appear in an error.
 */
export function omkGatewayStreamSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions) {
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
