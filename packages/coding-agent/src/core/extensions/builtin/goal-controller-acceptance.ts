import { DurableGoalError, type DurableGoalSnapshot, nextDurableGoalTimestamp } from "../../durable-goal.ts";
import type { DurableGoalStore } from "../../durable-goal-store.ts";
import type { GoalAcceptance, GoalCheckOutcome } from "../../goal-acceptance.ts";
import type { GoalContinuationDecision } from "../../goal-continuation.ts";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "../types.ts";
import { evaluateCommandGate, getAssumeYesConfirmPolicies } from "./command-safety-gate.ts";
import { displayCommand, displayError, failureText, receiptLabel, renderGoal } from "./goal-controller-text.ts";

type ContinueGoal = (advanced: DurableGoalSnapshot, detail: string) => void;

/** `/goal verify` and the settled-turn acceptance loop of the goal controller. */
export class GoalAcceptanceFlow {
	private readonly omk: Pick<ExtensionAPI, "appendEntry">;
	private readonly acceptance: GoalAcceptance;
	private readonly continueGoal: ContinueGoal;

	constructor(omk: Pick<ExtensionAPI, "appendEntry">, acceptance: GoalAcceptance, continueGoal: ContinueGoal) {
		this.omk = omk;
		this.acceptance = acceptance;
		this.continueGoal = continueGoal;
	}

	line(goal: DurableGoalSnapshot): string {
		const command = this.acceptance.approvedCommand(goal);
		return command === undefined
			? "acceptance: none (approve a check with /goal verify <command>)"
			: `acceptance: \`${displayCommand(command)}\` (approved in this session)`;
	}

	/** `/goal verify [command]`: approve the command if given, then run the approved check now. */
	async verify(
		text: string,
		existing: DurableGoalSnapshot | null,
		store: DurableGoalStore,
		ctx: ExtensionCommandContext,
	): Promise<void> {
		if (!existing || existing.status === "completed" || existing.status === "cleared") {
			throw new DurableGoalError("store-missing", "no open durable goal to verify");
		}
		if (!ctx.isIdle()) {
			throw new DurableGoalError(
				"invalid-input",
				"wait for the agent to finish before running the acceptance check",
			);
		}
		const command = text.slice("verify".length).trim();
		const previous = this.acceptance.approvedCommand(existing);
		if (command.length > 0) {
			const denial = await evaluateCommandGate(command, {
				hasUI: ctx.hasUI,
				...(ctx.hasUI ? { confirm: (message: string) => ctx.ui.confirm("Command safety", message) } : {}),
				...getAssumeYesConfirmPolicies(),
			});
			if (denial?.deny) {
				throw new DurableGoalError(
					"invalid-input",
					`command safety blocked the acceptance check: ${denial.reason}`,
				);
			}
			this.acceptance.approve(existing, command);
		} else if (this.acceptance.approvedCommand(existing) === undefined) {
			throw new DurableGoalError(
				"invalid-input",
				"no acceptance check is approved in this session; use /goal verify <command>",
			);
		}
		let outcome: GoalCheckOutcome;
		try {
			outcome = await this.run(store, existing, ctx, "command");
		} catch (error) {
			if (error instanceof DurableGoalError) throw error;
			// An approval must name a check that can run; keep the one that could.
			this.acceptance.approve(existing, previous);
			const approval = command.length > 0 ? ", so it was not approved" : "";
			throw new DurableGoalError(
				"invalid-input",
				`acceptance check could not run${approval}: ${displayError(error)}`,
			);
		}
		if (outcome.result.passed) {
			ctx.ui.notify(
				`${renderGoal(outcome.goal, this.line(outcome.goal))}\ngoal: acceptance check passed (${receiptLabel(outcome.result)}). /goal complete marks the goal done; the check also runs after each agent turn.`,
				"info",
			);
		}
	}

	/** After a settled turn: complete on a pass, continue with the failure, or block when no round is left. */
	async settle(
		store: DurableGoalStore,
		current: DurableGoalSnapshot,
		decision: GoalContinuationDecision,
		ctx: ExtensionContext,
	): Promise<void> {
		let outcome: GoalCheckOutcome;
		try {
			outcome = await this.run(store, current, ctx, "turn");
		} catch (error) {
			if (error instanceof DurableGoalError) {
				ctx.ui.notify(error.message, "error");
				return;
			}
			await this.block(store, `acceptance check could not run: ${displayError(error)}`, ctx);
			return;
		}
		const { result } = outcome;
		if (result.status === "aborted") return;
		if (result.passed) {
			const completed = await this.acceptance.complete(store, outcome.goal, ctx.cwd);
			ctx.ui.notify(
				`${renderGoal(completed)}\ngoal completed: acceptance check passed (${receiptLabel(result)})`,
				"info",
			);
			return;
		}
		if (result.status === "passed") {
			await this.block(store, `acceptance ${failureText(result).replace(/^passed but /, "")}`, ctx);
			return;
		}
		// A message queued while the check ran drives the next turn; the check runs again when it settles.
		if (ctx.hasPendingMessages()) return;
		if (!decision.continue) {
			await this.block(
				store,
				`acceptance check still fails after ${current.completedRounds} of ${current.maxRounds} rounds (${failureText(result)})`,
				ctx,
			);
			return;
		}
		const advanced = await store.transition(
			{ kind: "advance-round", ref: outcome.goal.ref },
			nextDurableGoalTimestamp(outcome.goal),
		);
		this.continueGoal(
			advanced,
			`\n\nAcceptance check \`${displayCommand(outcome.command)}\` ${failureText(result)} (${receiptLabel(result)}). Run it to see the output, fix the cause, and end your turn when it passes.`,
		);
	}

	private async run(
		store: DurableGoalStore,
		goal: DurableGoalSnapshot,
		ctx: ExtensionContext,
		trigger: "command" | "turn",
	): Promise<GoalCheckOutcome> {
		const command = this.acceptance.approvedCommand(goal) ?? "";
		ctx.ui.notify(`goal: running acceptance check \`${displayCommand(command)}\``, "info");
		// At a settled turn the run still owns the session, so its abort (Esc) stops the check too.
		const outcome = await this.acceptance.check(store, goal, ctx.cwd, ctx.signal);
		const { result } = outcome;
		this.omk.appendEntry("goal_verification", {
			goalId: outcome.goal.ref.id,
			goalRevision: outcome.goal.ref.revision,
			receiptId: result.receiptId,
			digest: result.digest,
			status: result.status,
			exitCode: result.exitCode,
			passed: result.passed,
			trigger,
		});
		if (!result.passed && result.status !== "aborted") {
			const tail = result.outputTail ? `\n${result.outputTail}` : "";
			ctx.ui.notify(`goal: acceptance check ${failureText(result)} (${receiptLabel(result)})${tail}`, "warning");
		}
		return outcome;
	}

	private async block(store: DurableGoalStore, reason: string, ctx: ExtensionContext): Promise<void> {
		const latest = await store.current();
		if (latest?.status === "active") {
			await store.transition({ kind: "block", ref: latest.ref, reason }, nextDurableGoalTimestamp(latest));
		}
		ctx.ui.notify(`goal blocked: ${reason}`, "error");
	}
}
