/** Spec 098: count the model's access to a recall file (counts only, never output text). */
import { resolve } from "node:path";
import type { OutputArtifact } from "./goal-output-recall.ts";

function namesPath(candidate: string, cwd: string, absolutePath: string): boolean {
	return resolve(cwd, candidate.replace(/^@/u, "")) === absolutePath;
}

/** The primary metric: a `read` tool call on exactly the recall path. */
export function isRecallRead(toolName: string, input: unknown, cwd: string, absolutePath: string): boolean {
	const path = (input as { path?: unknown } | undefined)?.path;
	return toolName === "read" && typeof path === "string" && namesPath(path, cwd, absolutePath);
}

const SHELL_READERS = /(^|[\s;|&(])(grep|rg|cat|sed)(\s|$)/u;

/** Reference only: grep tool, or a bash grep/rg/cat/sed command, naming the recall path. */
export function isOtherRecallAccess(toolName: string, input: unknown, cwd: string, absolutePath: string): boolean {
	const fields = (input ?? {}) as { path?: unknown; command?: unknown };
	if (toolName === "grep") return typeof fields.path === "string" && namesPath(fields.path, cwd, absolutePath);
	if (toolName !== "bash" || typeof fields.command !== "string" || !SHELL_READERS.test(fields.command)) return false;
	return fields.command
		.split(/[\s;|&()<>]+/u)
		.map((token) => token.replace(/^['"]|['"]$/gu, ""))
		.some((token) => token.length > 0 && namesPath(token, cwd, absolutePath));
}

/**
 * Spec 098 (flag on): access to the recall path named in the last follow-up. `read` of exactly that path is the
 * primary metric; grep/rg/cat/sed (tool or bash) is counted apart, for reference only. Counts only.
 */
export class RecallAccessTracker {
	private current: { readonly absolutePath: string; readCalls: number; otherAccessCalls: number } | undefined;

	start(artifact: Pick<OutputArtifact, "absolutePath"> | undefined): void {
		this.current = artifact && { absolutePath: artifact.absolutePath, readCalls: 0, otherAccessCalls: 0 };
	}

	observe(toolName: string, input: unknown, cwd: string): void {
		const current = this.current;
		if (current === undefined) return;
		if (isRecallRead(toolName, input, cwd, current.absolutePath)) current.readCalls += 1;
		else if (isOtherRecallAccess(toolName, input, cwd, current.absolutePath)) current.otherAccessCalls += 1;
	}

	/** The counts since the last follow-up, then forget them. */
	take(): { readAfterFollowUp: boolean; readCalls: number; otherAccessCalls: number } | undefined {
		const current = this.current;
		this.current = undefined;
		if (current === undefined) return undefined;
		const { readCalls, otherAccessCalls } = current;
		return { readAfterFollowUp: readCalls > 0, readCalls, otherAccessCalls };
	}
}
