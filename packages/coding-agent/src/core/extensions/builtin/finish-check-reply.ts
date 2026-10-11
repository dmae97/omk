/** Reading the finish-check turns' replies from the messages of a settled run. */
import { hasFinishCheckLedgerLines } from "../../finish-check-requirements.ts";

export function assistantText(message: unknown): string {
	const content = (message as { role?: string; content?: unknown } | undefined)?.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part: { type?: string; text?: string }) => (part?.type === "text" ? (part.text ?? "") : ""))
		.join("\n");
}

/**
 * The text the turn's REQ lines are read from: the latest assistant message of
 * this run that has any, else the last assistant message. `messages` holds only
 * the run that just settled, so an earlier turn's lines are never read. `hasLines`
 * picks the line kind (REQ lines by default; the verifier also looks for VERIFY and VERDICT).
 */
export function ledgerReply(messages: readonly unknown[], hasLines = hasFinishCheckLedgerLines): string {
	let fallback: string | undefined;
	for (let index = messages.length - 1; index >= 0; index--) {
		if ((messages[index] as { role?: string } | undefined)?.role !== "assistant") continue;
		const text = assistantText(messages[index]);
		if (hasLines(text)) return text;
		fallback ??= text;
	}
	return fallback ?? "";
}

const VERIFY_REPLY_LINE = /^[\s>*`-]*(?:VERIFY\s+\d+\s*:|VERDICT\s*:)/im;

/** Whether `text` has a spec 032 `VERIFY n:` or `VERDICT:` line. */
export function hasVerifyReplyLines(text: string): boolean {
	return VERIFY_REPLY_LINE.test(text);
}
