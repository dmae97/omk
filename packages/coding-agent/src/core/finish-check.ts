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

export type FinishCheckMode = "off" | "headless" | "always";

/** `OMK_FINISH_CHECK`: unset = headless runs only, `0/false/off` = off, `1/true/on/always` = every run. */
export function resolveFinishCheckMode(value: string | undefined): FinishCheckMode {
	const normalized = value?.trim().toLowerCase();
	if (normalized === undefined || normalized === "") return "headless";
	if (["0", "false", "off", "disable", "disabled"].includes(normalized)) return "off";
	if (["1", "true", "on", "always", "enable", "enabled"].includes(normalized)) return "always";
	return "headless";
}

/** `OMK_TIME_BUDGET_SEC`: wall-clock seconds the caller allows for the whole run. */
export function resolveTimeBudgetMs(value: string | undefined): number | undefined {
	if (value === undefined || value.trim() === "") return undefined;
	const seconds = Number(value);
	if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
	return Math.round(seconds * 1000);
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
