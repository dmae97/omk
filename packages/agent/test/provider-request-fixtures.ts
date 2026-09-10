import { type AssistantMessage, createAssistantMessageEventStream, type Model } from "omk-ai";

export const model: Model<"openai-responses"> = {
	id: "contract-fixture",
	name: "Contract fixture",
	api: "openai-responses",
	provider: "openai",
	baseUrl: "https://example.invalid",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8192,
	maxTokens: 4096,
};

export const contract = {
	allowedModels: [{ provider: model.provider, id: model.id }],
	allowedProviders: [model.provider],
	allowedAuthOrigins: [model.provider],
	thinking: false,
	maxOutputTokens: 1024,
};

export function response(stopReason: "stop" | "error" = "stop") {
	const stream = createAssistantMessageEventStream();
	const message: AssistantMessage = {
		role: "assistant",
		api: model.api,
		provider: model.provider,
		model: model.id,
		content: [{ type: "text", text: "fixture result" }],
		stopReason,
		timestamp: 0,
		...(stopReason === "error" ? { errorMessage: "fixture private error" } : {}),
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
	queueMicrotask(() => {
		if (stopReason === "error") stream.push({ type: "error", reason: "error", error: message });
		else stream.push({ type: "done", reason: "stop", message });
	});
	return stream;
}
