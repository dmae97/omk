import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
	createDurableGoal,
	DurableGoalError,
	type DurableGoalSnapshot,
	nextDurableGoalTimestamp,
} from "../../durable-goal.ts";
import { parseDurableGoalCheckpointCommand } from "../../durable-goal-checkpoint.ts";
import { DurableGoalStore } from "../../durable-goal-store.ts";
import { evidenceLifecycleDeleteEnabled } from "../../evidence-lifecycle.ts";
import { recoverEvidenceDeletions } from "../../evidence-lifecycle-delete.ts";
import { GoalAcceptance, type GoalVerifierFactory } from "../../goal-acceptance.ts";
import { decideGoalContinuation, goalAutonomyEnabled } from "../../goal-continuation.ts";
import { deleteGoalRecallFiles, goalOutputRecallEnabled, outputRecallDir } from "../../goal-output-recall.ts";
import { rewriteRecallLinksInMessages } from "../../goal-output-recall-links.ts";
import { goalStateDirectory } from "../../goal-verification.ts";
import type { ExtensionAPI } from "../types.ts";
import { GoalAutonomy } from "./goal-autonomy.ts";
import { GoalAcceptanceFlow, type GoalAcceptanceTestHooks } from "./goal-controller-acceptance.ts";
import { GoalRequiredTools } from "./goal-controller-required-tools.ts";
import { checkpointPayload, continuationSeam, renderGoal, unavailableWorkspaceCode } from "./goal-controller-text.ts";

export interface GoalControllerOptions {
	/** Test seam for the acceptance-check runner. */
	readonly createVerifier?: GoalVerifierFactory;
	/** Spec 100 test-only ordering seams; never set by the built-in registration. */
	readonly testHooks?: GoalAcceptanceTestHooks;
}

function goalPath(cwd: string): string {
	return join(goalStateDirectory(cwd), "current.json");
}

export default function goalController(omk: ExtensionAPI, options: GoalControllerOptions = {}): void {
	const trustedCheckpointDigests = new Set<string>();
	const acceptance = new GoalAcceptance(options.createVerifier);
	const flow = new GoalAcceptanceFlow(omk, acceptance, continueGoal, options.testHooks);
	// Spec 104 (`OMK_REQUIRED_TOOLS` only): publishes the active goal's declared required tools.
	const requiredTools = new GoalRequiredTools(omk, acceptance);
	// Spec 119: only with `OMK_GOAL_AUTONOMY=1`; off adds no handler, entry or prompt change (G0).
	const autonomy = goalAutonomyEnabled() ? new GoalAutonomy(omk, acceptance) : undefined;

	if (autonomy !== undefined) {
		// AU2: an explicit user steer (not an extension message, not a command) revokes the loop.
		omk.on("input", async (event, ctx) => {
			if (event.streamingBehavior !== "steer" || event.source === "extension") return { action: "continue" };
			if (event.text.trimStart().startsWith("/")) return { action: "continue" };
			try {
				await autonomy.revoke(new DurableGoalStore(goalPath(ctx.cwd)), ctx);
			} catch (error) {
				if (!(error instanceof DurableGoalError)) throw error;
			}
			return { action: "continue" };
		});
	}

	// Spec 098: registered only with the flag on, so the off arm adds no handler.
	if (goalOutputRecallEnabled()) {
		omk.on("tool_call", (event, ctx) => {
			flow.recallAccess.observe(event.toolName, event.input, ctx.cwd);
			return undefined;
		});
	}

	// Spec 118 D2 (`delete` only): finish interrupted deletes at startup; hide deleted links on resume (EV9).
	if (evidenceLifecycleDeleteEnabled()) {
		omk.on("session_start", (_event, ctx) => {
			// Recovery must never fail session start. Logged as an error code only (no path, no message text).
			try {
				recoverEvidenceDeletions(outputRecallDir(ctx.cwd));
			} catch (error) {
				const code = (error as NodeJS.ErrnoException | undefined)?.code;
				try {
					omk.appendEntry("evidence_recovery_failed", { code: typeof code === "string" ? code : "unknown" });
				} catch {
					// observation only
				}
			}
		});
		omk.on("context", (event, ctx) => {
			const messages = rewriteRecallLinksInMessages(event.messages, ctx.cwd);
			return messages === undefined ? undefined : { messages };
		});
	}

	function continueGoal(advanced: DurableGoalSnapshot, detail: string): void {
		// AU2: a continuation of a revoked round is dropped, even one from a settle already in flight.
		if (autonomy?.isRevoked(advanced)) {
			autonomy.rejectContinuation(advanced);
			return;
		}
		const seam = continuationSeam(advanced, trustedCheckpointDigests);
		// The run that just settled still owns the session, so queue behind it.
		omk.sendUserMessage(
			`Continue the active goal (${advanced.completedRounds}/${advanced.maxRounds}): ${advanced.objective}${seam}${detail}`,
			{ deliverAs: "followUp" },
		);
	}

	omk.registerCommand("goal", {
		description:
			"Show, set, verify, checkpoint, pause, resume, complete, or clear the durable session goal (/goal verify <command> approves an acceptance check)",
		handler: async (args, ctx) => {
			const store = new DurableGoalStore(goalPath(ctx.cwd));
			const text = args.trim();
			try {
				if (text.length === 0) {
					const current = await store.current();
					if (!current) {
						ctx.ui.notify("no durable goal", "info");
						return;
					}
					const lines = [flow.line(current)];
					if (acceptance.approvedCommand(current) !== undefined && current.status !== "completed") {
						const gap = acceptance.acceptanceGap(current, ctx.cwd);
						lines.push(`evidence: ${gap ?? "a passing receipt matches the current workspace"}`);
					}
					ctx.ui.notify(renderGoal(current, ...lines), "info");
					return;
				}
				const existing = await store.current();
				// Spec 119 (flag on only): `/goal budget`, user-set only.
				if (autonomy?.budgetCommand(text, existing, ctx)) return;
				if (text === "verify" || text.startsWith("verify ")) {
					await flow.verify(text, existing, store, ctx);
					return;
				}
				if (text === "pause" || text === "resume" || text === "complete" || text === "clear") {
					if (!existing) throw new DurableGoalError("store-missing", "durable goal does not exist");
					const next =
						text === "complete"
							? await acceptance.complete(store, existing, ctx.cwd)
							: await store.transition({ kind: text, ref: existing.ref }, nextDurableGoalTimestamp(existing));
					if (autonomy !== undefined && text === "resume") {
						autonomy.resumed(next);
						if (ctx.isIdle()) continueGoal(next, "");
					}
					if (text === "clear") {
						autonomy?.forget(existing);
						trustedCheckpointDigests.clear();
						acceptance.forget(existing);
						deleteGoalRecallFiles(ctx.cwd, existing.ref.id);
					}
					ctx.ui.notify(renderGoal(next, flow.line(next)), "info");
					return;
				}
				const payload = checkpointPayload(text);
				if (payload !== null) {
					if (!existing) throw new DurableGoalError("store-missing", "durable goal does not exist");
					if (payload.length === 0) {
						throw new DurableGoalError(
							"invalid-input",
							'usage: /goal checkpoint {"core":[],"verified":[],"open":[],"next":"..."}',
						);
					}
					const now = nextDurableGoalTimestamp(existing);
					const next = await store.transition(
						{
							kind: "record-checkpoint",
							ref: existing.ref,
							checkpoint: parseDurableGoalCheckpointCommand(payload, now),
						},
						now,
					);
					const checkpoint = next.checkpoint;
					if (!checkpoint) throw new DurableGoalError("invalid-store", "durable goal journal is invalid");
					omk.appendEntry("goal_checkpoint", {
						goalId: next.ref.id,
						goalRevision: next.ref.revision,
						checkpointDigest: checkpoint.digest,
					});
					trustedCheckpointDigests.add(checkpoint.digest);
					ctx.ui.notify(renderGoal(next), "info");
					return;
				}
				if (existing && existing.status !== "cleared" && existing.status !== "completed") {
					const next = await store.transition(
						{ kind: "edit", ref: existing.ref, objective: text },
						nextDurableGoalTimestamp(existing),
					);
					ctx.ui.notify(renderGoal(next, flow.line(next)), "info");
					return;
				}
				if (existing) {
					autonomy?.forget(existing);
					acceptance.forget(existing);
					deleteGoalRecallFiles(ctx.cwd, existing.ref.id);
					await rm(goalPath(ctx.cwd), { force: true });
				}
				const created = await store.create(
					createDurableGoal({ id: "session", objective: text, maxRounds: 8, now: new Date().toISOString() }),
				);
				ctx.ui.notify(renderGoal(created, flow.line(created)), "info");
			} catch (error) {
				const message = error instanceof DurableGoalError ? error.message : "goal command failed";
				ctx.ui.notify(message, "error");
			} finally {
				if (requiredTools.enabled) requiredTools.sync(await store.current().catch(() => null));
			}
		},
	});

	// `agent_settled` is the end no retry follows; `agent_end` also fires for attempts about to be retried.
	omk.on("agent_settled", async (event, ctx) => {
		const store = new DurableGoalStore(goalPath(ctx.cwd));
		let current: DurableGoalSnapshot | null;
		try {
			current = await store.current();
		} catch (error) {
			const code = unavailableWorkspaceCode(error);
			if (!code) throw error;
			omk.appendEntry("goal_workspace_unavailable", { code });
			return;
		}
		if (requiredTools.enabled) requiredTools.sync(current);
		if (!current) return;
		const observed =
			autonomy !== undefined && current.status === "active"
				? autonomy.observe(current, event.messages, Date.now())
				: undefined;
		const decision = decideGoalContinuation({
			status: current.status,
			completedRounds: current.completedRounds,
			maxRounds: current.maxRounds,
			hasQueuedMessages: ctx.hasPendingMessages(),
			...(observed !== undefined ? { autonomy: observed } : {}),
		});
		if (decision.reason === "queued") return;
		try {
			if (autonomy !== undefined && current.status === "active") {
				// G8: a stop or revoke without a later explicit resume (incl. an unknown stop reason) fails closed.
				if (!autonomy.mayContinue(current, ctx)) return;
				if (
					decision.reason === "budget-limit" ||
					decision.reason === "deadline" ||
					decision.reason === "outcome-unknown" ||
					decision.reason === "scope-changed"
				) {
					await autonomy.stop(store, current, decision.reason, ctx);
					return;
				}
			}
			if (current.status === "active" && acceptance.approvedCommand(current) !== undefined) {
				await flow.settle(store, current, decision, ctx);
				return;
			}
			if (!decision.continue) return;
			const advanced = await store.transition(
				{ kind: "advance-round", ref: current.ref },
				nextDurableGoalTimestamp(current),
			);
			continueGoal(advanced, "");
		} catch (error) {
			// A command can change the goal while the turn settles; report it rather than fail the turn.
			if (!(error instanceof DurableGoalError)) throw error;
			// AU2: a steer paused the goal while this settle ran; its continuation is refused, and counted.
			if (autonomy?.isRevoked(current)) {
				autonomy.rejectContinuation(current);
				return;
			}
			ctx.ui.notify(error.message, "error");
		}
	});

	omk.on("session_shutdown", () => {
		acceptance.abort();
	});
}
