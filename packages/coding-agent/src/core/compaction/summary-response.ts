import type { AssistantMessage } from "omk-ai";

/** A cancelled or empty response must never become a durable compaction summary. */
export function summaryTextOrThrow(response: AssistantMessage, failure: string): string {
	if (response.stopReason === "aborted") throw new DOMException(`${failure}: aborted`, "AbortError");
	if (response.stopReason === "error") throw new Error(`${failure}: ${response.errorMessage || "Unknown error"}`);
	if (response.stopReason !== "stop" && response.stopReason !== "length")
		throw new Error(`${failure}: invalid summary stop reason`);
	const text = response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n");
	if (text.trim().length === 0) {
		if (response.stopReason === "length")
			throw new Error(`${failure}: the model reached its output limit before writing a summary`);
		throw new Error(`${failure}: the model returned an empty summary`);
	}
	return text;
}
