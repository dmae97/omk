import type { DurableGoalSnapshot } from "../../durable-goal.ts";
import type { GoalAcceptance } from "../../goal-acceptance.ts";
import { parseRequiredToolsDeclaration, type RequiredToolsDeclaration } from "./goal-controller-required-tools.ts";

export interface VerifyCommandArgs extends RequiredToolsDeclaration {
	readonly force: boolean;
	readonly reuse: boolean;
}

/** Split `/goal verify` flags off the acceptance command text. Unknown text stays the command. */
export function parseVerifyCommandText(text: string): VerifyCommandArgs {
	const raw = text.slice("verify".length).trim();
	const force = /(^|\s)--(?:force|rerun)(?=\s|$)/.test(raw);
	const reuse = /(^|\s)--reuse(?=\s|$)/.test(raw);
	const { command, tools } = parseRequiredToolsDeclaration(
		raw.replace(/(^|\s)--(?:force|rerun|reuse)(?=\s|$)/g, " ").trim(),
	);
	return { command, tools, force, reuse };
}

/** Opt-in reuse: skip only when the passing receipt in this generation matches the workspace. */
export function shouldReuseVerifiedCheck(
	acceptance: GoalAcceptance,
	goal: DurableGoalSnapshot,
	cwd: string,
	args: VerifyCommandArgs,
): boolean {
	return args.reuse && !args.force && args.command.length === 0 && acceptance.acceptanceGap(goal, cwd) === undefined;
}

export function acceptanceReuseMessage(renderedGoal: string): string {
	return `${renderedGoal}\ngoal: acceptance already verified for this workspace state; skipping the check. /goal verify --force runs it again.`;
}
