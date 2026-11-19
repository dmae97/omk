// Source: https://github.com/wtfzambo/speak-like-you-eat (MIT), adapted for OMK.
import { type Context, streamSimple } from "omk-ai";
import type { ModelRegistry } from "open-multi-agent-kit";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type Model = NonNullable<ReturnType<ModelRegistry["find"]>>;
type CompletionOptions = NonNullable<Parameters<typeof streamSimple>[2]>;
type AssistantMessage = Awaited<ReturnType<ReturnType<typeof streamSimple>["result"]>>;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export type StreamSimple = typeof streamSimple;
export type DirectCompletionOptions = {
	signal: NonNullable<CompletionOptions["signal"]>;
	cacheRetention: "none";
	sessionId: NonNullable<CompletionOptions["sessionId"]>;
};

export function lowestSupportedThinkingLevel(model: Model): ThinkingLevel | undefined {
	if (!model.reasoning) return "off";
	for (const level of THINKING_LEVELS) {
		const mappedLevel = model.thinkingLevelMap?.[level];
		if (mappedLevel === null) continue;
		if ((level === "xhigh" || level === "max") && typeof mappedLevel !== "string") continue;
		return level;
	}
	return undefined;
}

export async function completeModel(
	registry: ModelRegistry,
	model: Model,
	context: Context,
	options: DirectCompletionOptions,
	stream: StreamSimple = streamSimple,
): Promise<AssistantMessage> {
	const thinkingLevel = lowestSupportedThinkingLevel(model);
	if (thinkingLevel === undefined) throw new Error("The selected model exposes no supported thinking level.");
	const auth = await registry.getApiKeyAndHeaders(model);
	if (!auth.ok) throw new Error(auth.error);
	options.signal.throwIfAborted();
	const completionOptions: CompletionOptions = {
		signal: options.signal,
		cacheRetention: options.cacheRetention,
		sessionId: options.sessionId,
		apiKey: auth.apiKey,
		headers: auth.headers,
	};
	if (thinkingLevel !== "off") completionOptions.reasoning = thinkingLevel;
	return stream(model, context, completionOptions).result();
}
