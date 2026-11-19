// Source: https://github.com/wtfzambo/speak-like-you-eat (MIT), adapted for OMK.
import type { SessionEntry } from "open-multi-agent-kit";

export const REWRITE_ENTRY_TYPE = "slye.rewrite";
export type RewriteEntryData = { display: string; rewrite?: string; targetEntryId?: string; modelName?: string };

export function parseRewriteEntryData(data: unknown): RewriteEntryData | undefined {
	if (typeof data !== "object" || data === null || Array.isArray(data)) return undefined;
	if (!("display" in data) || typeof data.display !== "string") return undefined;
	const rewrite = "rewrite" in data && typeof data.rewrite === "string" ? data.rewrite : undefined;
	const targetEntryId =
		"targetEntryId" in data && typeof data.targetEntryId === "string" && data.targetEntryId.trim() !== ""
			? data.targetEntryId
			: undefined;
	const modelName =
		"modelName" in data && typeof data.modelName === "string" && data.modelName.trim() !== ""
			? data.modelName
			: undefined;
	return { display: data.display, rewrite, targetEntryId, modelName };
}
export function hasExistingRewrite(branch: readonly SessionEntry[], targetEntryId: string): boolean {
	let latestAssistantEntryId: string | undefined;
	for (const entry of branch) {
		if (entry?.type === "message" && entry.message.role === "assistant") {
			latestAssistantEntryId = entry.id;
			continue;
		}
		if (entry?.type !== "custom" || entry.customType !== REWRITE_ENTRY_TYPE) continue;
		const data = parseRewriteEntryData(entry.data);
		if (data === undefined) continue;
		if (data.targetEntryId === targetEntryId) return true;
		if (data.targetEntryId === undefined && latestAssistantEntryId === targetEntryId) return true;
	}
	return false;
}
