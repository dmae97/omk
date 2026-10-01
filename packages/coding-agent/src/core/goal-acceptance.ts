/**
 * Process-scoped authority for durable goal acceptance checks.
 *
 * Approvals and trusted receipts live only in this object. The workspace, the
 * goal journal and the receipt files are writable by the agent, so nothing read
 * back from them can approve a command or vouch for a receipt: after a restart
 * the user approves the check again with `/goal verify <command>`.
 */
import {
	DurableGoalError,
	type DurableGoalSnapshot,
	freshDurableGoalEvidence,
	nextDurableGoalTimestamp,
} from "./durable-goal.ts";
import type { DurableGoalStore } from "./durable-goal-store.ts";
import {
	captureGoalWorkspace,
	type GoalAcceptanceResult,
	GoalVerifier,
	type GoalVerifierOptions,
	type GoalWorkspaceState,
	goalKeyOf,
} from "./goal-verification.ts";

export type GoalVerifierFactory = (options: GoalVerifierOptions) => GoalVerifier;

export interface GoalCheckOutcome {
	readonly command: string;
	readonly result: GoalAcceptanceResult;
	/** The goal after the check; a passing check has attached its receipt as evidence. */
	readonly goal: DurableGoalSnapshot;
}

interface TrustedReceipt {
	readonly goalKey: string;
	readonly digest: string;
	readonly workspace: GoalWorkspaceState;
}

export class GoalAcceptance {
	private readonly approved = new Map<string, string>();
	private readonly trusted = new Map<string, TrustedReceipt>();
	private readonly verifiers = new Map<string, GoalVerifier>();
	private readonly createVerifier: GoalVerifierFactory;
	private running: AbortController | undefined;

	constructor(createVerifier: GoalVerifierFactory = (options) => new GoalVerifier(options)) {
		this.createVerifier = createVerifier;
	}

	/** Approve `command` for `goal`, or withdraw the approval with `undefined`. */
	approve(goal: DurableGoalSnapshot, command: string | undefined): void {
		if (command === undefined) this.approved.delete(goalKeyOf(goal));
		else this.approved.set(goalKeyOf(goal), command);
	}

	approvedCommand(goal: DurableGoalSnapshot): string | undefined {
		return this.approved.get(goalKeyOf(goal));
	}

	/** Drop the approval and trusted receipts of a cleared or replaced goal. */
	forget(goal: DurableGoalSnapshot): void {
		const key = goalKeyOf(goal);
		this.approved.delete(key);
		for (const [receiptId, receipt] of this.trusted) {
			if (receipt.goalKey === key) this.trusted.delete(receiptId);
		}
		for (const verifierKey of this.verifiers.keys()) {
			if (verifierKey.endsWith(`\0${key}`)) this.verifiers.delete(verifierKey);
		}
	}

	/** Run the approved check once and attach its receipt when it passed. `signal` also stops it. */
	async check(
		store: DurableGoalStore,
		goal: DurableGoalSnapshot,
		cwd: string,
		signal?: AbortSignal,
	): Promise<GoalCheckOutcome> {
		const key = goalKeyOf(goal);
		const command = this.approved.get(key);
		if (command === undefined) {
			throw new DurableGoalError("invalid-input", "no acceptance check is approved for this goal in this session");
		}
		if (this.running) throw new DurableGoalError("invalid-input", "an acceptance check is already running");
		const controller = new AbortController();
		this.running = controller;
		try {
			const stop = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
			const result = await this.verifierFor(cwd, key).run(command, stop);
			if (!result.passed) return { command, result, goal };
			const latest = await store.current();
			if (!latest || goalKeyOf(latest) !== key) {
				throw new DurableGoalError("stale-ref", "the goal changed while its acceptance check ran");
			}
			// The check ran inside this generation. A wall clock that stepped back while it
			// ran must not date its evidence before the generation began.
			const capturedAt = new Date(
				Math.max(Date.parse(result.capturedAt), Date.parse(latest.generationStartedAt)),
			).toISOString();
			const next = await store.transition(
				{
					kind: "attach-evidence",
					ref: latest.ref,
					evidence: { id: result.receiptId, digest: result.digest, capturedAt },
				},
				nextDurableGoalTimestamp(latest, capturedAt),
			);
			this.trusted.set(result.receiptId, { goalKey: key, digest: result.digest, workspace: result.workspace });
			return { command, result, goal: next };
		} finally {
			if (this.running === controller) this.running = undefined;
		}
	}

	/**
	 * Why `goal` cannot complete on acceptance evidence yet, or `undefined` when a
	 * receipt this process trusts passed in the current generation and the
	 * workspace still matches the state captured right after it.
	 */
	acceptanceGap(goal: DurableGoalSnapshot, cwd: string): string | undefined {
		const key = goalKeyOf(goal);
		const candidates = freshDurableGoalEvidence(goal)
			.flatMap((evidence) => {
				const trusted = this.trusted.get(evidence.id);
				return trusted?.goalKey === key && trusted.digest === evidence.digest ? [{ evidence, trusted }] : [];
			})
			.reverse();
		if (candidates.length === 0) return "no passing acceptance receipt in this goal generation";
		const current = captureGoalWorkspace(cwd).sha256;
		const verifier = this.verifierFor(cwd, key);
		for (const { evidence, trusted } of candidates) {
			if (trusted.workspace.sha256 === current && verifier.receiptMatches(evidence.id, evidence.digest)) {
				return undefined;
			}
		}
		return "the workspace changed after the acceptance check passed";
	}

	/** Complete `goal`. With an approved check, only on a matching trusted receipt; otherwise the reducer's rule. */
	async complete(store: DurableGoalStore, goal: DurableGoalSnapshot, cwd: string): Promise<DurableGoalSnapshot> {
		if (this.approved.has(goalKeyOf(goal))) {
			const gap = this.acceptanceGap(goal, cwd);
			if (gap !== undefined) throw new DurableGoalError("evidence-required", `${gap}; run /goal verify`);
		}
		return store.transition({ kind: "complete", ref: goal.ref }, nextDurableGoalTimestamp(goal));
	}

	/** Stop a running check; its receipt records `aborted` and attaches nothing. */
	abort(): void {
		this.running?.abort();
	}

	private verifierFor(cwd: string, key: string): GoalVerifier {
		const verifierKey = `${cwd}\0${key}`;
		let verifier = this.verifiers.get(verifierKey);
		if (!verifier) {
			verifier = this.createVerifier({ cwd, goalKey: key });
			this.verifiers.set(verifierKey, verifier);
		}
		return verifier;
	}
}
