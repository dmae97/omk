/**
 * Fresh-context re-verification for early finishes (spec 032).
 *
 * After the check turn of a run that finished early, one verifier turn checks
 * the deliverables as if someone else had written them: the `context` handler
 * shows the model only the verifier instruction and what follows it. This
 * module holds the text and the pure helpers; `extensions/builtin/finish-check.ts`
 * and `finish-check-reverify-stage.ts` wire them to events.
 */
import {
	buildFinishCheckContinueMessage,
	extraTurnItems,
	type FinishCheckLedgerItem,
} from "./finish-check-requirements.ts";

/** First line of the verifier instruction; the context filter keeps everything from it onward. */
export const FINISH_CHECK_REVERIFY_MARKER = "<fresh_verification>";
/** Where the verifier puts scratch files, since write and edit are blocked. */
export const FINISH_CHECK_REVERIFY_SCRATCH_DIR = "/tmp/omk-verify/";
/** Deliverable paths listed in the instruction and hashed around the verifier. */
export const FINISH_CHECK_REVERIFY_MAX_DELIVERABLES = 30;
/** Tool calls the verifier may use before it is told to wrap up. */
export const FINISH_CHECK_REVERIFY_MAX_TOOL_CALLS = 10;
/** Share of the budget the verifier may use before it is told to wrap up. */
export const FINISH_CHECK_REVERIFY_TIME_FRACTION = 0.15;

export const FINISH_CHECK_REVERIFY_WRAP_UP_MESSAGE =
	"Verification limit reached. Stop testing now, do not change the deliverables, and reply with the VERIFY lines for what you checked and the VERDICT line.";

export const FINISH_CHECK_REVERIFY_BLOCK_REASON = `Deliverables are read-only during the fresh verification. Put scratch files under ${FINISH_CHECK_REVERIFY_SCRATCH_DIR} with bash instead.`;

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

export interface VerifyFinding {
	readonly id: number;
	readonly status: "pass" | "fail";
	readonly text: string;
}

export type VerifyVerdict = "pass" | "fail" | "unreported" | "void";

export interface VerifyReply {
	readonly verdict: Exclude<VerifyVerdict, "void">;
	readonly findings: VerifyFinding[];
	/** FAIL findings that count: none when the verdict is PASS. */
	readonly failing: VerifyFinding[];
}

const VERIFY_LINE = /^[\s>*`-]*VERIFY\s+(\d+)\s*:\s*(PASS|FAIL)\b[\s`*]*(?:[-–—:]\s*)?(.*)$/gim;
const VERDICT_LINE = /^[\s>*`-]*VERDICT\s*:[\s`*]*(PASS|FAIL)\b/gim;

/** Reads the verifier's `VERIFY n: PASS|FAIL - …` lines and its last `VERDICT:` line. */
export function parseVerifyReply(reply: string): VerifyReply {
	const findings: VerifyFinding[] = [...reply.matchAll(VERIFY_LINE)].map((match) => ({
		id: Number(match[1]),
		status: match[2].toUpperCase() === "PASS" ? "pass" : "fail",
		text: match[3].replace(/[`*]+$/g, "").trim(),
	}));
	const stated = [...reply.matchAll(VERDICT_LINE)].at(-1)?.[1]?.toLowerCase() as "pass" | "fail" | undefined;
	const derived = findings.length === 0 ? "unreported" : findings.some((f) => f.status === "fail") ? "fail" : "pass";
	const verdict = stated ?? derived;
	return { verdict, findings, failing: verdict === "pass" ? [] : findings.filter((f) => f.status === "fail") };
}

/** Failing numeric items of the check ledger, then the verifier's own failing REQ comparisons not already listed. */
export function mergeFailingItems(
	check: readonly FinishCheckLedgerItem[],
	verifier: readonly FinishCheckLedgerItem[],
): FinishCheckLedgerItem[] {
	const merged = extraTurnItems(check).failing;
	const ids = new Set(merged.map((item) => item.id));
	return [...merged, ...extraTurnItems(verifier).failing.filter((item) => !ids.has(item.id))];
}

/** The one fix turn after the verifier: its findings and any failing numeric items (spec 032, shared with 035). */
export function buildReverifyFixMessage(
	findings: readonly VerifyFinding[],
	failing: readonly FinishCheckLedgerItem[],
): string {
	const parts: string[] = [];
	if (findings.length > 0) {
		parts.push(
			[
				"Fresh verification result: the task is not complete. An independent check of your deliverables found:",
				...findings.map((finding) => `VERIFY ${finding.id}: FAIL - ${finding.text}`),
				"Fix these problems. Keep the currently saved output in place until a new version measures better, and never leave a required output worse or missing. Re-run the failing checks on new inputs before you end, and end your reply with one `VERIFY <n>: PASS|FAIL - <what was checked>; expected <x>; got <y>` line per finding above.",
			].join("\n"),
		);
	}
	if (failing.length > 0) parts.push(buildFinishCheckContinueMessage(failing));
	return parts.join("\n\n");
}

export interface VerifyUsage {
	readonly costUsd: number;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly totalTokens: number;
}

/** Cost and token totals of the verifier turn's assistant messages, for the A/B's per-trial cost. */
export function verifyUsage(messages: readonly unknown[]): VerifyUsage {
	const totals = { costUsd: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
	for (const message of messages) {
		const { role, usage } = message as {
			role?: string;
			usage?: { input?: number; output?: number; totalTokens?: number; cost?: { total?: number } };
		};
		if (role !== "assistant" || !usage) continue;
		totals.costUsd += usage.cost?.total ?? 0;
		totals.inputTokens += usage.input ?? 0;
		totals.outputTokens += usage.output ?? 0;
		totals.totalTokens += usage.totalTokens ?? 0;
	}
	return totals;
}
