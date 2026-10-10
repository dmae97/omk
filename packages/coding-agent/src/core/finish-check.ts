/**
 * Finish discipline for coding runs.
 *
 * Benchmarks showed one failure shape over and over: the visible tests pass and a
 * hidden boundary case fails, or the run destroys state outside the request, or a
 * time limit hits before any result is saved. This module holds the policy text
 * and the pure decisions; `extensions/builtin/finish-check.ts` wires it to events.
 */

/** Tools that only observe. Any other tool call may have changed the workspace. */
const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
	"read",
	"grep",
	"find",
	"ls",
	"diagnostics",
	"update_todo",
	"web_search",
	"web_fetch",
]);

/** Fraction of the time budget after which the run is told to save its outputs now. */
export const FINISH_CHECK_SAVE_NOW_FRACTION = 0.75;
/** Tool calls the verification turn may use before it is told to wrap up. */
export const FINISH_CHECK_MAX_TOOL_CALLS = 6;
/** Past this fraction there is no time for an extra verification turn. */
export const FINISH_CHECK_SKIP_FRACTION = 0.9;
/**
 * Past this fraction a check that found a missed or unmeasured numeric limit gets no extra turn (spec 035).
 * Sits between save-now (0.75) and skip (0.9); all three compare against the shared run clock (spec 036).
 */
export const FINISH_CHECK_EXTRA_TURN_FRACTION = 0.85;
/** Extra turns per user task after a finish check, shared by the threshold retry and the go-measure nudge. */
export const FINISH_CHECK_MAX_EXTRA_TURNS = 1;
/**
 * A first settle before this fraction of the budget gets one fresh-context verifier turn after the check (spec 032,
 * behind `OMK_FINISH_CHECK_REVERIFY`). Like the other thresholds it compares against the shared run clock (spec 036).
 */
export const FINISH_CHECK_REVERIFY_FRACTION = 0.3;

export type FinishCheckMode = "off" | "headless" | "always";

/** `OMK_FINISH_CHECK`: unset = headless runs only, `0/false/off` = off, `1/true/on/always` = every run. */
export function resolveFinishCheckMode(value: string | undefined): FinishCheckMode {
	const normalized = value?.trim().toLowerCase();
	if (normalized === undefined || normalized === "") return "headless";
	if (["0", "false", "off", "disable", "disabled"].includes(normalized)) return "off";
	if (["1", "true", "on", "always", "enable", "enabled"].includes(normalized)) return "always";
	return "headless";
}

/** Opt-in finish-check switches are on only for `1/true/on/enable/enabled` (any case); anything else is off. */
function resolveOptInFlag(value: string | undefined): boolean {
	return ["1", "true", "on", "enable", "enabled"].includes(value?.trim().toLowerCase() ?? "");
}

/**
 * `OMK_FINISH_CHECK_EXTRA_TURN`: the spec 035 extra turn after a finish check. Off unless set to
 * `1/true/on/enable/enabled`; it stays opt-in until the A/B shows a gain.
 */
export function resolveFinishCheckExtraTurn(value: string | undefined): boolean {
	return resolveOptInFlag(value);
}

/** `OMK_FINISH_CHECK_REVERIFY`: the spec 032 fresh-context verifier for early finishes. Same values as the extra turn. */
export function resolveFinishCheckReverify(value: string | undefined): boolean {
	return resolveOptInFlag(value);
}

export function isWorkspaceMutatingTool(toolName: string): boolean {
	return !READ_ONLY_TOOLS.has(toolName);
}

export function finishDisciplinePrompt(timeBudgetMs: number | undefined): string {
	const lines = [
		"Stay inside the requested scope for destructive changes. Do not rewrite or squash git history, force-reset, or delete commits, branches, repositories or user data unless the task explicitly asks for it. When cleaning or sanitizing, change only what was asked and keep everything else, including history, intact. System changes the task needs (editing /etc, adding accounts, installing packages, restarting services) are in scope.",
		"Save a working result early. When the task names output files or deliverables, write a correct baseline to the exact required path before optimizing, and keep it current so a time limit never leaves nothing saved.",
		"Treat every stated requirement as testable. Before finishing, write and run quick checks for the edge cases each requirement implies (empty or missing fields, boundary values, option combinations, type preservation, large inputs), not only the given examples.",
		"Check the environment the task states or implies (accounts and passwords, ports, services, paths, permissions) and confirm it is actually configured and running, not only written into a config file.",
		"Never weaken, skip or delete existing tests to make them pass.",
	];
	if (timeBudgetMs !== undefined) {
		const seconds = Math.round(timeBudgetMs / 1000);
		lines.push(
			`This run has a wall-clock budget of about ${seconds} seconds. Have a saved, working result before half of it is used; optimize only after that.`,
		);
	}
	return `<finish_discipline>\n${lines.map((line) => `- ${line}`).join("\n")}\n</finish_discipline>`;
}

export const FINISH_CHECK_MESSAGE = [
	"Finish check (automatic, runs once, keep it short). Check only the deliverables and requirements the task names, at the paths the task gives or in your working directory. Do not search other directories for specs, tests or answers.",
	"1. Requirements: check each explicit requirement against the current files and output.",
	"2. Edge cases: run a few quick checks for the edge cases those requirements imply.",
	"3. Scope: where a repository exists, look at `git status`, `git diff` and `git reflog`, and undo destructive changes the task did not ask for, such as rewritten history, deleted branches or removed data. Keep system changes the task needs.",
	"4. Deliverables and environment: confirm every required output exists at its exact path in the expected format, and that required services, accounts and ports are running.",
	`Change a file only when a check actually fails. Do not rewrite, restyle or "improve" anything that already passes, and keep every saved output valid after each step. Use at most ${FINISH_CHECK_MAX_TOOL_CALLS} tool calls, then reply briefly with what you verified.`,
].join("\n");

export const FINISH_CHECK_WRAP_UP_MESSAGE =
	"Finish check limit reached. Stop checking now, leave the saved outputs as they are, and reply with a one-line summary of what you verified.";

export const FINISH_CHECK_SAVE_NOW_MESSAGE =
	"Time check: about 75% of this run's time budget is used. Make sure every required output is saved at its exact path now, with your best working result so far. Finish the current step, then stop optimizing unless there is clearly time left.";

/** Sent once during the extra turn when the run reaches {@link FINISH_CHECK_SKIP_FRACTION} of its budget. */
export const FINISH_CHECK_EXTRA_TURN_STOP_MESSAGE =
	"Time check: about 90% of this run's time budget is used. Stop this attempt now: keep the best measured version saved at the required paths, and reply with the REQ lines for what you have measured.";

export interface FinishCheckDecisionInput {
	readonly mode: FinishCheckMode;
	readonly hasUI: boolean;
	readonly alreadyChecked: boolean;
	readonly mutatedWorkspace: boolean;
	readonly hasPendingMessages: boolean;
	readonly aborted: boolean;
	readonly elapsedFraction: number | undefined;
}

/**
 * The discipline text is written for unattended benchmark runs: it puts system
 * changes such as editing /etc or installing packages in scope. Like the check
 * turn, it is only added to headless sessions unless the mode is `always`, so a
 * session on the user's own machine never gets it by default.
 */
export function shouldAddFinishDiscipline(mode: FinishCheckMode, hasUI: boolean): boolean {
	if (mode === "off") return false;
	return mode === "always" || !hasUI;
}

/** Whether the settled run should get one verification turn. */
export function shouldRunFinishCheck(input: FinishCheckDecisionInput): boolean {
	if (input.mode === "off") return false;
	if (input.mode === "headless" && input.hasUI) return false;
	if (input.alreadyChecked || !input.mutatedWorkspace || input.hasPendingMessages || input.aborted) return false;
	if (input.elapsedFraction !== undefined && input.elapsedFraction >= FINISH_CHECK_SKIP_FRACTION) return false;
	return true;
}

export type FinishCheckExtraTurn = "threshold" | "measure" | "both";

export interface ExtraTurnDecisionInput {
	readonly extraTurnsUsed: number;
	/** Numeric items that failed, reported or by their own comparison. */
	readonly failing: number;
	/** Numeric items with no evaluable comparison that did not fail. */
	readonly unmeasured: number;
	readonly aborted: boolean;
	readonly hasPendingMessages: boolean;
	readonly elapsedFraction: number | undefined;
}

/** Which extra turn, if any, a settled finish check gets. One per user task, whatever its kind. */
export function decideExtraTurn(input: ExtraTurnDecisionInput): FinishCheckExtraTurn | undefined {
	if (input.failing === 0 && input.unmeasured === 0) return undefined;
	if (input.extraTurnsUsed >= FINISH_CHECK_MAX_EXTRA_TURNS || input.aborted || input.hasPendingMessages)
		return undefined;
	if (input.elapsedFraction !== undefined && input.elapsedFraction >= FINISH_CHECK_EXTRA_TURN_FRACTION)
		return undefined;
	if (input.failing > 0) return input.unmeasured > 0 ? "both" : "threshold";
	return "measure";
}

export interface ReverifyDecisionInput {
	readonly enabled: boolean;
	readonly hasUI: boolean;
	/** Budget fraction at the task's first settle, before the check turn; `undefined` when the run has no budget. */
	readonly firstSettleFraction: number | undefined;
	/** The check turn stopped with `aborted` or `error`. */
	readonly aborted: boolean;
	readonly hasPendingMessages: boolean;
	readonly alreadyVerified: boolean;
}

/** Whether a settled check turn is followed by the fresh-context verifier (spec 032). Headless runs with a budget only. */
export function shouldReverify(input: ReverifyDecisionInput): boolean {
	if (!input.enabled || input.hasUI || input.alreadyVerified || input.aborted || input.hasPendingMessages)
		return false;
	return input.firstSettleFraction !== undefined && input.firstSettleFraction < FINISH_CHECK_REVERIFY_FRACTION;
}
