import { DurableGoalError, type DurableGoalSnapshot, nextDurableGoalTimestamp } from "../../durable-goal.ts";
import type { DurableGoalStore } from "../../durable-goal-store.ts";
import type { GoalAcceptance, GoalCheckOutcome } from "../../goal-acceptance.ts";
import type { GoalContinuationDecision } from "../../goal-continuation.ts";
import {
	goalOutputRecallEnabled,
	type OutputArtifact,
	OutputArtifactWriter,
	summarizeArtifact,
} from "../../goal-output-recall.ts";
import { RecallAccessTracker } from "../../goal-output-recall-access.ts";
import * as recallEvidence from "../../goal-output-recall-evidence.ts";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "../types.ts";
import { evaluateCommandGate, getAssumeYesConfirmPolicies } from "./command-safety-gate.ts";
import { repairFollowUp } from "./goal-acceptance-repair.ts";
import { type GoalAcceptanceTestHooks, GoalTaskFacts } from "./goal-acceptance-task-facts.ts";
import { parseRequiredToolsDeclaration } from "./goal-controller-required-tools.ts";
import { displayCommand, displayError, failureText, receiptLabel, renderGoal } from "./goal-controller-text.ts";

type ContinueGoal = (advanced: DurableGoalSnapshot, detail: string) => void;
type RunOutcome = GoalCheckOutcome & { readonly artifact?: OutputArtifact };

export type { GoalAcceptanceTestHooks } from "./goal-acceptance-task-facts.ts";

/** `/goal verify` and the settled-turn acceptance loop of the goal controller. */
export class GoalAcceptanceFlow {
	private readonly omk: Pick<ExtensionAPI, "appendEntry"> & Partial<Pick<ExtensionAPI, "events">>;
	private readonly acceptance: GoalAcceptance;
	private readonly continueGoal: ContinueGoal;
	private readonly testHooks: GoalAcceptanceTestHooks | undefined;
	private readonly taskFacts: GoalTaskFacts;
	/** Spec 098: access to the recall file named in the last follow-up (counts only). */
	readonly recallAccess = new RecallAccessTracker();

	constructor(
		omk: Pick<ExtensionAPI, "appendEntry"> & Partial<Pick<ExtensionAPI, "events">>,
		acceptance: GoalAcceptance,
		continueGoal: ContinueGoal,
		testHooks?: GoalAcceptanceTestHooks,
	) {
		this.omk = omk;
		this.acceptance = acceptance;
		this.continueGoal = continueGoal;
		this.testHooks = testHooks;
		this.taskFacts = new GoalTaskFacts(omk.events);
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
		// Spec 104 (flag on only): an explicit `--requires` declaration; nothing is inferred.
		const { command, tools } = parseRequiredToolsDeclaration(text.slice("verify".length).trim());
		const previous = this.acceptance.approvedCommand(existing);
		const previousTools = this.acceptance.requiredTools(existing);
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
			this.acceptance.approve(existing, command, tools);
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
			this.acceptance.approve(existing, previous, previousTools);
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
		let outcome: RunOutcome;
		const taskRunId = this.taskFacts.runId();
		const identity = taskRunId === undefined ? undefined : this.acceptance.checkIdentity(current);
		try {
			outcome = await this.run(store, current, ctx, "turn");
		} catch (error) {
			// Spec 100: the approved check got no result in this run.
			this.taskFacts.publishNotRun(identity, taskRunId);
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
			let completed: DurableGoalSnapshot;
			if (this.taskFacts.hasPublished())
				await this.testHooks?.afterPublishBeforeComplete?.({
					cwd: ctx.cwd,
					goal: outcome.goal,
					acceptance: this.acceptance,
				});
			try {
				completed = await this.acceptance.complete(store, outcome.goal, ctx.cwd);
			} catch (error) {
				// A rejected completion must surface; an unhandled throw here left the goal silently active.
				if (!(error instanceof DurableGoalError)) throw error;
				this.taskFacts.downgrade(error.message);
				ctx.ui.notify(error.message, "error");
				return;
			}
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
			recallEvidence.observeRecallBlockedExhausted(outcome.goal.ref.id);
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
		const { detail, recall } = repairFollowUp(outcome, outcome.artifact);
		this.recallAccess.start(recall);
		this.continueGoal(advanced, detail);
	}

	private async run(
		store: DurableGoalStore,
		goal: DurableGoalSnapshot,
		ctx: ExtensionContext,
		trigger: "command" | "turn",
	): Promise<RunOutcome> {
		const command = this.acceptance.approvedCommand(goal) ?? "";
		ctx.ui.notify(`goal: running acceptance check \`${displayCommand(command)}\``, "info");
		// Spec 096: the run this check starts in; a receipt that lands after it settled is dropped.
		const taskRunId = this.taskFacts.runId();
		const identity = taskRunId === undefined ? undefined : this.acceptance.checkIdentity(goal);
		this.taskFacts.forgetPublished();
		// At a settled turn the run still owns the session, so its abort (Esc) stops the check too.
		// Spec 098 (flag on): the same output stream also goes to a raw artifact the model can read.
		const writer = goalOutputRecallEnabled() ? this.openArtifact(goal, ctx) : undefined;
		let outcome: GoalCheckOutcome;
		try {
			outcome = await this.acceptance.check(
				store,
				goal,
				ctx.cwd,
				ctx.signal,
				writer && ((data) => writer.write(data)),
			);
		} catch (error) {
			writer?.discard();
			throw error;
		}
		const { result } = outcome;
		const recall = this.recallAccess.take();
		let artifact: OutputArtifact | undefined;
		if (result.status !== "aborted") recallEvidence.observeRecallRecheck(outcome.goal.ref.id, result.passed);
		if (writer !== undefined) {
			if (result.status === "aborted" || result.passed) writer.discard();
			else artifact = writer.finish();
		}
		this.omk.appendEntry("goal_verification", {
			goalId: outcome.goal.ref.id,
			goalRevision: outcome.goal.ref.revision,
			receiptId: result.receiptId,
			digest: result.digest,
			status: result.status,
			exitCode: result.exitCode,
			passed: result.passed,
			trigger,
			...(artifact !== undefined ? { outputArtifact: summarizeArtifact(artifact) } : {}),
			...(recall !== undefined ? { priorRecall: recall } : {}),
			// Spec 106 D1: counts, digests and would-delete ids only; absent when the flag is off.
			...recallEvidence.evidenceReportField(ctx),
		});
		// Spec 096/100: hand the host receipt to the task-result projection (flag on only), with the
		// workspace state at publish, the runner's counts and the check identity.
		if (taskRunId !== undefined) {
			await this.testHooks?.afterCheckBeforePublish?.({
				cwd: ctx.cwd,
				goal: outcome.goal,
				acceptance: this.acceptance,
			});
			this.taskFacts.publishCheck(result, identity, taskRunId, this.acceptance.currentWorkspaceSha256(ctx.cwd));
		}
		if (!result.passed && result.status !== "aborted") {
			const tail = result.outputTail ? `\n${result.outputTail}` : "";
			ctx.ui.notify(`goal: acceptance check ${failureText(result)} (${receiptLabel(result)})${tail}`, "warning");
		}
		return artifact === undefined ? outcome : { ...outcome, artifact };
	}

	private openArtifact(goal: DurableGoalSnapshot, ctx: ExtensionContext): OutputArtifactWriter | undefined {
		return OutputArtifactWriter.open({
			cwd: ctx.cwd,
			goalId: goal.ref.id,
			round: goal.completedRounds,
			revision: this.acceptance.checkIdentity(goal)?.revision ?? 0,
		});
	}

	private async block(store: DurableGoalStore, reason: string, ctx: ExtensionContext): Promise<void> {
		const latest = await store.current();
		if (latest?.status === "active") {
			await store.transition({ kind: "block", ref: latest.ref, reason }, nextDurableGoalTimestamp(latest));
		}
		ctx.ui.notify(`goal blocked: ${reason}`, "error");
	}
}
