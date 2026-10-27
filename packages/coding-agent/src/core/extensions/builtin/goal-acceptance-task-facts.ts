/**
 * Spec 100: the task-result side of the goal acceptance flow. It stamps each check result with
 * the workspace state at publish, the runner's counts and the check identity, keeps the fact it
 * published so a refused completion can downgrade it, and records a required check that got no
 * result. Everything here is inert with `OMK_TASK_RESULT` off.
 */
import type { DurableGoalSnapshot } from "../../durable-goal.ts";
import type { GoalAcceptance } from "../../goal-acceptance.ts";
import type { GoalAcceptanceResult } from "../../goal-verification.ts";
import { factFromGoalAcceptance, isTaskResultEnabled, type TaskCheckFact } from "../../task-result.ts";
import { currentTaskRunId, publishHostTaskFact } from "../../task-result-collector.ts";
import type { ExtensionAPI } from "../types.ts";

/**
 * Test-only seams that fix the order of a workspace edit against publish and completion.
 * They exist only as a constructor argument: no flag, env var, setting or extension API reaches them,
 * and the built-in goal controller is registered without them.
 */
export interface GoalAcceptanceTestHooks {
	readonly afterCheckBeforePublish?: (seam: GoalAcceptanceTestSeam) => void | Promise<void>;
	readonly afterPublishBeforeComplete?: (seam: GoalAcceptanceTestSeam) => void | Promise<void>;
}

export interface GoalAcceptanceTestSeam {
	readonly cwd: string;
	readonly goal: DurableGoalSnapshot;
	readonly acceptance: GoalAcceptance;
}

export type CheckIdentity = ReturnType<GoalAcceptance["checkIdentity"]>;

const DETAIL_CHARS = 200;

/** Spec 100: the same fact after the host refused completion on it; only a pass is downgraded. */
export function downgradeRefusedCompletion(fact: TaskCheckFact, refusal: string): TaskCheckFact {
	if (fact.status !== "passed") return fact;
	const flat = refusal.replace(/\s+/g, " ").trim();
	const detail = flat.length <= DETAIL_CHARS ? flat : `${flat.slice(0, DETAIL_CHARS - 1)}…`;
	return { ...fact, status: "insufficient", reason: "completion_refused", detail };
}

/** Spec 100: a required check that got no result in this run (it could not run). */
export function notRunFact(checkId: string, checkRevision: number, attempt: number): TaskCheckFact {
	return {
		id: checkId,
		source: "host_receipt",
		status: "insufficient",
		required: true,
		reason: "not_run",
		checkId,
		checkRevision,
		attempt,
	};
}

export class GoalTaskFacts {
	private readonly events: ExtensionAPI["events"] | undefined;
	private published: { readonly taskRunId: string; readonly fact: TaskCheckFact } | undefined;
	private attempts: { taskRunId: string | undefined; byCheck: Map<string, number> } = {
		taskRunId: undefined,
		byCheck: new Map(),
	};

	constructor(events: ExtensionAPI["events"] | undefined) {
		this.events = events;
	}

	/** The run a check starts in (flag on only); a receipt that lands after it settled is dropped. */
	runId(): string | undefined {
		return this.events && isTaskResultEnabled() ? currentTaskRunId(this.events) : undefined;
	}

	/** Whether this flow published a fact for the current check that a completion could downgrade. */
	hasPublished(): boolean {
		return this.published !== undefined;
	}

	forgetPublished(): void {
		this.published = undefined;
	}

	/** The check's fact, with the workspace state now, the runner's counts and the check identity. */
	publishCheck(
		result: GoalAcceptanceResult,
		identity: CheckIdentity,
		taskRunId: string | undefined,
		currentWorkspaceSha256: string,
	): void {
		if (!this.events || !isTaskResultEnabled()) return;
		const fact = factFromGoalAcceptance(result, {
			currentWorkspaceSha256,
			...(result.tests !== undefined
				? {
						executedTests: result.tests.executed,
						matchedTests: result.tests.matched,
						skippedTests: result.tests.skipped,
					}
				: {}),
			...(result.checkKind !== undefined ? { checkKind: result.checkKind } : {}),
			...(identity !== undefined && taskRunId !== undefined
				? {
						checkId: identity.checkId,
						checkRevision: identity.revision,
						attempt: this.nextAttempt(taskRunId, identity.checkId),
					}
				: {}),
		});
		publishHostTaskFact(this.events, fact, taskRunId);
		if (taskRunId !== undefined) this.published = { taskRunId, fact };
	}

	/** The approved check got no result in this run. */
	publishNotRun(identity: CheckIdentity, taskRunId: string | undefined): void {
		if (!identity || taskRunId === undefined || !this.events) return;
		const fact = notRunFact(identity.checkId, identity.revision, this.nextAttempt(taskRunId, identity.checkId));
		publishHostTaskFact(this.events, fact, taskRunId);
	}

	/** A refused completion downgrades the pass just published, as the same attempt. */
	downgrade(refusal: string): void {
		const published = this.published;
		this.published = undefined;
		if (!published || !this.events || published.fact.status !== "passed") return;
		publishHostTaskFact(this.events, downgradeRefusedCompletion(published.fact, refusal), published.taskRunId);
	}

	private nextAttempt(taskRunId: string, checkId: string): number {
		if (this.attempts.taskRunId !== taskRunId) this.attempts = { taskRunId, byCheck: new Map() };
		const attempt = (this.attempts.byCheck.get(checkId) ?? 0) + 1;
		this.attempts.byCheck.set(checkId, attempt);
		return attempt;
	}
}
