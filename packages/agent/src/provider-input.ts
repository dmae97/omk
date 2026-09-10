import type { Api, Context, Model } from "omk-ai";

export interface ProviderInputProjection {
	readonly context: Context;
	readonly omittedToolImages: number;
}

/** A provider view, not a transcript rewrite or visual interpretation. User attachments stay intact. */
export function projectToolImagesForModel(context: Context, model: Pick<Model<Api>, "input">): ProviderInputProjection {
	if (
		model.input.includes("image") ||
		!context.messages.some(
			(message) => message.role === "toolResult" && message.content.some((part) => part.type === "image"),
		)
	) {
		return { context, omittedToolImages: 0 };
	}
	let omittedToolImages = 0;
	const messages = context.messages.map((message) => {
		if (message.role !== "toolResult" || !message.content.some((part) => part.type === "image")) return message;
		return {
			...message,
			content: message.content.map((part) => {
				if (part.type !== "image") return part;
				omittedToolImages++;
				return {
					type: "text" as const,
					text:
						"[Tool image omitted from this model request: the selected model accepts text only. " +
						"The image contents were not inspected. The original attachment remains in the session/tool source. " +
						"Use permitted local tools to inspect or extract text from the source artifact; do not infer its visual contents.]",
				};
			}),
		};
	});
	return { context: { ...context, messages }, omittedToolImages };
}
