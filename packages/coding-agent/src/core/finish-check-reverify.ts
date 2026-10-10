/**
 * Fresh-context re-verification for early finishes (spec 032).
 *
 * After the check turn of a run that finished early, one verifier turn checks
 * the deliverables as if someone else had written them: the `context` handler
 * shows the model only the verifier instruction and what follows it. This
 * module holds the text and the pure helpers; `extensions/builtin/finish-check.ts`
 * and `finish-check-reverify-stage.ts` wire them to events.
 */
import type { FinishCheckLedgerItem } from "./finish-check-requirements.ts";

/** First line of the verifier instruction; the context filter keeps everything from it onward. */
export const FINISH_CHECK_REVERIFY_MARKER = "<fresh_verification>";
/** Where the verifier puts scratch files, since write and edit are blocked. */
export const FINISH_CHECK_REVERIFY_SCRATCH_DIR = "/tmp/omk-verify/";
/** Deliverable paths listed in the instruction and hashed around the verifier. */
export const FINISH_CHECK_REVERIFY_MAX_DELIVERABLES = 30;
const ABSOLUTE_PATHS = /(?:^|[\s`'"(])(\/(?:[\w.@+-]+\/)*[\w.@+-]*[\w@+-])/g;

/** Paths written in this task, then absolute paths the requirements name; deduplicated and capped. */
export function reverifyDeliverables(written: readonly string[], requirements: readonly string[]): string[] {
	const named = requirements.flatMap((requirement) => [...requirement.matchAll(ABSOLUTE_PATHS)].map((m) => m[1]));
	return [...new Set([...written, ...named])].slice(0, FINISH_CHECK_REVERIFY_MAX_DELIVERABLES);
}

export interface ReverifyMessageInput {
	/** The user's task prompt, quoted in full. */
	readonly task: string;
	readonly deliverables: readonly string[];
	/** The #62 checklist items. */
	readonly requirements: readonly string[];
	/** Numeric checklist items the check did not measure (spec 035's go-measure items, folded into this turn). */
	readonly unmeasured: readonly FinishCheckLedgerItem[];
}

/** The verifier instruction, the only user message the verifier's model input keeps. */
export function buildReverifyMessage(input: ReverifyMessageInput): string {
	const lines = [
		FINISH_CHECK_REVERIFY_MARKER,
		"You are checking someone else's work on the task below. You did not write it and have nothing to defend: find where it does not do what the task asks.",
		"",
		"Task:",
		'"""',
		input.task,
		'"""',
		"",
	];
	if (input.deliverables.length > 0) {
		lines.push("Deliverables written for this task:", ...input.deliverables.map((path) => `- ${path}`));
	} else {
		lines.push("No deliverables were recorded; find the required outputs from the task text.");
	}
	if (input.requirements.length > 0) {
		lines.push("", "Requirements:", ...input.requirements.map((item, index) => `REQ ${index + 1}: ${item}`));
	}
	if (input.unmeasured.length > 0) {
		lines.push(
			"",
			"These numeric requirements have no measurement yet. Measure each with a command and report it as `REQ <n>: PASS|FAIL - <label> <measured> <op> <limit>`:",
			...input.unmeasured.map((item) => `REQ ${item.id}: ${item.requirement ?? ""}`),
		);
	}
	lines.push(
		"",
		"Steps:",
		"1. For each requirement sentence in the task, write in one line how a hidden test would most likely check it, then check it that way.",
		"2. Different inputs: if the task shows example inputs, outputs, files or commands, build at least two new inputs that differ from them (other values, boundary or empty cases, a larger case, a freshly generated file such as a newly compiled binary or a different document), run the deliverable on them, and compare with an expectation derived from the task text, not from the deliverable's own output. Do not count re-running the given examples.",
		"3. Check that required outputs exist at their exact paths in the required format, and that required services, ports and git state are live.",
		"",
		`Rules: do not modify the deliverables (write and edit are blocked during this check). Put scratch files under ${FINISH_CHECK_REVERIFY_SCRATCH_DIR}. Do not search other directories or the web for tests or answers.`,
		"",
		"Reply with one line per check: `VERIFY <n>: PASS|FAIL - <what was checked>; expected <x>; got <y>`, then end with `VERDICT: PASS|FAIL`.",
	);
	return lines.join("\n");
}

function messageText(message: unknown): string {
	const content = (message as { content?: unknown } | undefined)?.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part: { type?: string; text?: string }) => (part?.type === "text" ? (part.text ?? "") : ""))
		.join("\n");
}

/** The verifier's model input: the last verifier instruction and everything after it, or `undefined` if there is none. */
export function freshContextMessages<T>(messages: readonly T[]): T[] | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index] as { role?: string };
		if (message?.role === "user" && messageText(message).includes(FINISH_CHECK_REVERIFY_MARKER)) {
			return messages.slice(index);
		}
	}
	return undefined;
}
