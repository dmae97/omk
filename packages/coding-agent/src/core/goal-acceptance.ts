/**
 * Process-scoped authority for durable goal acceptance checks.
 *
 * Approvals and trusted receipts live only in this object. The workspace, the
 * goal journal and the receipt files are writable by the agent, so nothing read
 * back from them can approve a command or vouch for a receipt: after a restart
 * the user approves the check again with `/goal verify <command>`.
 */
import { createHash } from "node:crypto";
import {
	computeDurableGoalGeneration,
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
	readonly checkId: string;
	readonly contractRevision: number;
	readonly contractDigest: string;
	readonly digest: string;
	readonly workspace: GoalWorkspaceState;
}

/** The approved check of one goal; the revision rises on every change or withdrawal. */
interface CheckContract {
	readonly command: string | undefined;
	readonly revision: number;
	readonly digest: string;
	/** Spec 104: tools this check explicitly declared it needs (never inferred); empty when none. */
	readonly requiredTools: readonly string[];
	/** Whether the latest completed (non-aborted) run of this revision passed. */
	readonly latestPassed?: boolean;
}

function contractDigestOf(command: string): string {
	return createHash("sha256").update(command).digest("hex");
}

export class GoalAcceptance {
	private readonly contracts = new Map<string, CheckContract>();
	private readonly trusted = new Map<string, TrustedReceipt>();
	private readonly verifiers = new Map<string, GoalVerifier>();
	private readonly createVerifier: GoalVerifierFactory;
	private running: AbortController | undefined;
	/** Spec 104: goals whose segment hit `RequiredCapabilityUnavailable`; recorded only with `OMK_REQUIRED_TOOLS`. */
	private readonly capabilityGaps = new Map<string, { readonly missing: readonly string[]; present: boolean }>();

	constructor(createVerifier: GoalVerifierFactory = (options) => new GoalVerifier(options)) {
		this.createVerifier = createVerifier;
	}

	/** Approve `command` for `goal`, or withdraw the approval with `undefined`. */
	approve(goal: DurableGoalSnapshot, command: string | undefined, requiredTools: readonly string[] = []): void {
		const key = goalKeyOf(goal);
		const previous = this.contracts.get(key);
		const tools = command === undefined ? [] : [...new Set(requiredTools)].sort();
		if (previous?.command === command && (previous?.requiredTools ?? []).join("\0") === tools.join("\0")) return;
		if (previous === undefined && command === undefined) return;
		this.contracts.set(key, {
			command,
			revision: (previous?.revision ?? 0) + 1,
			digest: command === undefined ? "" : contractDigestOf(command),
			requiredTools: tools,
		});
	}

	/** Spec 104: the tools the approved check explicitly declared; nothing is inferred from the command. */
	requiredTools(goal: DurableGoalSnapshot): readonly string[] {
		const contract = this.contracts.get(goalKeyOf(goal));
		return contract?.command === undefined ? [] : contract.requiredTools;
	}

	approvedCommand(goal: DurableGoalSnapshot): string | undefined {
		return this.contracts.get(goalKeyOf(goal))?.command;
	}

	/**
	 * Spec 100: the identity of the approved check, for the task-result projection.
	 * One approved command is one required check; a new command (099 revision) is a new check id.
	 */
	checkIdentity(goal: DurableGoalSnapshot): { readonly checkId: string; readonly revision: number } | undefined {
		const contract = this.contracts.get(goalKeyOf(goal));
		if (contract?.command === undefined) return undefined;
		return {
			checkId: `goal-acceptance:${goalKeyOf(goal)}:${contract.digest.slice(0, 12)}`,
			revision: contract.revision,
		};
	}

	/** Spec 100: the goal workspace state now, from the same capture `complete()` compares against. */
	currentWorkspaceSha256(cwd: string): string {
		return captureGoalWorkspace(cwd).sha256;
	}

	/** Drop the approval and trusted receipts of a cleared or replaced goal. */
	forget(goal: DurableGoalSnapshot): void {
		const key = goalKeyOf(goal);
		this.contracts.delete(key);
		this.capabilityGaps.delete(key);
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
		onOutput?: (data: Buffer) => void,
	): Promise<GoalCheckOutcome> {
		const key = goalKeyOf(goal);
		const generation = computeDurableGoalGeneration(goal);
		const contract = this.contracts.get(key);
		const command = contract?.command;
		if (contract === undefined || command === undefined) {
			throw new DurableGoalError("invalid-input", "no acceptance check is approved for this goal in this session");
		}
		if (this.running) throw new DurableGoalError("invalid-input", "an acceptance check is already running");
		const controller = new AbortController();
		this.running = controller;
		try {
			const stop = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
			const result = await this.verifierFor(cwd, key).run(command, stop, onOutput);
			if (result.status !== "aborted" && this.contracts.get(key) === contract) {
				this.contracts.set(key, { ...contract, latestPassed: result.passed });
			}
			if (!result.passed) return { command, result, goal };
			const latest = await store.current();
			const currentContract = this.contracts.get(key);
			if (
				!latest ||
				goalKeyOf(latest) !== key ||
				computeDurableGoalGeneration(latest) !== generation ||
				currentContract?.revision !== contract.revision ||
				currentContract.digest !== contract.digest
			) {
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
			this.trusted.set(result.receiptId, {
				goalKey: key,
				checkId: key,
				contractRevision: contract.revision,
				contractDigest: contract.digest,
				digest: result.digest,
				workspace: result.workspace,
			});
			if (this.capabilityGaps.get(key)?.present) this.capabilityGaps.delete(key);
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
		const contract = this.contracts.get(key);
		if (contract?.command === undefined) return "the approved acceptance check was withdrawn";
		if (contract.latestPassed === false) return "the latest acceptance check failed";
		// Receipts of an earlier contract stay attached but no longer vouch for this one.
		const candidates = freshDurableGoalEvidence(goal)
			.flatMap((evidence) => {
				const trusted = this.trusted.get(evidence.id);
				return trusted?.goalKey === key &&
					trusted.checkId === key &&
					trusted.contractRevision === contract.revision &&
					trusted.contractDigest === contract.digest &&
					trusted.digest === evidence.digest
					? [{ evidence, trusted }]
					: [];
			})
			.reverse();
		if (candidates.length === 0) return "no passing acceptance receipt in this goal generation";
		const current = captureGoalWorkspace(cwd);
		if (current.completeness !== "complete") return `workspace scope is incomplete (${current.completeness})`;
		const verifier = this.verifierFor(cwd, key);
		for (const { evidence, trusted } of candidates) {
			if (
				trusted.workspace.completeness === "complete" &&
				trusted.workspace.sha256 === current.sha256 &&
				verifier.receiptMatches(evidence.id, evidence.digest)
			) {
				return undefined;
			}
		}
		if (candidates.some(({ trusted }) => trusted.workspace.completeness !== "complete")) {
			return "workspace scope is incomplete in the acceptance receipt";
		}
		return "the workspace changed after the acceptance check passed";
	}

	/** Complete `goal`. With an approved check, only on a matching trusted receipt; otherwise the reducer's rule. */
	async complete(store: DurableGoalStore, goal: DurableGoalSnapshot, cwd: string): Promise<DurableGoalSnapshot> {
		const gap = this.capabilityGaps.get(goalKeyOf(goal));
		if (gap) throw new DurableGoalError("evidence-required", `required tools unavailable: ${gap.missing.join(", ")}`);
		if (this.gated(goal)) {
			const gap = this.acceptanceGap(goal, cwd);
			if (gap !== undefined) throw new DurableGoalError("evidence-required", `${gap}; run /goal verify`);
		}
		return store.transition({ kind: "complete", ref: goal.ref }, nextDurableGoalTimestamp(goal));
	}

	/** An approved check gates completion, and so does a withdrawn one once a check of the goal has passed. */
	private gated(goal: DurableGoalSnapshot): boolean {
		const key = goalKeyOf(goal);
		const contract = this.contracts.get(key);
		if (contract === undefined) return false;
		if (contract.command !== undefined) return true;
		for (const receipt of this.trusted.values()) if (receipt.goalKey === key) return true;
		return false;
	}

	/** Spec 104: a required capability was missing in this goal's segment; `complete()` is refused until forgotten. */
	recordRequiredCapabilityMissing(goal: DurableGoalSnapshot, missing: readonly string[]): void {
		this.capabilityGaps.set(goalKeyOf(goal), { missing: [...missing], present: false });
	}

	/** Spec 104: a later turn carried every required tool; the next passing check then releases the block. */
	recordRequiredCapabilityPresent(goal: DurableGoalSnapshot): void {
		const gap = this.capabilityGaps.get(goalKeyOf(goal));
		if (gap) gap.present = true;
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
