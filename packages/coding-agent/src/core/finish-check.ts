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
	"Finish check (automatic, runs once). Before you stop, verify the work against the original task:",
	"1. Requirements: list each explicit requirement and check it against the actual files and output as they are now. Fix anything missing.",
	"2. Edge cases: write and run small tests for the edge cases each requirement implies (empty or missing values, boundaries, combinations, type preservation). Fix what fails.",
	"3. Scope: review what you changed (for example `git status`, `git diff` and `git reflog` where a repository exists). Undo destructive changes the task did not ask for, such as rewritten history, deleted branches or removed data. Keep system changes the task needs.",
	"4. Deliverables and environment: confirm every required output exists at the exact path in the expected format, and that required services, accounts and ports are configured and running.",
	"If everything already holds, reply briefly with what you verified. Do not start new optional work.",
].join("\n");

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

/** Whether the settled run should get one verification turn. */
export function shouldRunFinishCheck(input: FinishCheckDecisionInput): boolean {
	if (input.mode === "off") return false;
	if (input.mode === "headless" && input.hasUI) return false;
	if (input.alreadyChecked || !input.mutatedWorkspace || input.hasPendingMessages || input.aborted) return false;
	if (input.elapsedFraction !== undefined && input.elapsedFraction >= FINISH_CHECK_SKIP_FRACTION) return false;
	return true;
}
