/**
 * Spec 118 D2 / EV9 (`OMK_EVIDENCE_LIFECYCLE=delete` only): a recall file deleted after use is never shown
 * to the model as a live "Full output" link, including in history replayed on resume. The `context` hook
 * rewrites such lines in user messages to a fixed marker; present files are left as they are.
 */

import { resolve } from "node:path";
import type { AgentMessage } from "omk-agent-core";
import { lookupEvidence } from "./evidence-lifecycle-delete.ts";

const LINK = /^Full output: (\S+) \((.*)\)$/gmu;
export const DELETED_RECALL_LINK = "Full output: deleted after use (no longer on disk; re-run the check to see output)";
export const MISSING_RECALL_LINK = "Full output: missing (re-run the check to see output)";

/** `text` with every non-present recall link replaced; the same string when nothing changed. */
export function rewriteRecallLinks(text: string, cwd: string): string {
	if (!text.includes("Full output: ")) return text;
	return text.replace(LINK, (line, displayPath: string) => {
		if (!displayPath.includes(".omk/goals/recall/")) return line;
		const state = lookupEvidence(resolve(cwd, displayPath));
		if (state === "present") return line;
		return state === "deleted_after_use" ? DELETED_RECALL_LINK : MISSING_RECALL_LINK;
	});
}

/** New message list when any user message changed, else undefined (no copy, no change). */
export function rewriteRecallLinksInMessages(
	messages: readonly AgentMessage[],
	cwd: string,
): AgentMessage[] | undefined {
	let changed = false;
	const next = messages.map((message) => {
		if (message.role !== "user") return message;
		if (typeof message.content === "string") {
			const content = rewriteRecallLinks(message.content, cwd);
			if (content === message.content) return message;
			changed = true;
			return { ...message, content };
		}
		let partChanged = false;
		const content = message.content.map((part) => {
			if (part.type !== "text") return part;
			const text = rewriteRecallLinks(part.text, cwd);
			if (text === part.text) return part;
			partChanged = true;
			return { ...part, text };
		});
		if (!partChanged) return message;
		changed = true;
		return { ...message, content };
	});
	return changed ? next : undefined;
}
