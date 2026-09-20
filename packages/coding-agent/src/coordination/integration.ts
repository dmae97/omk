/**
 * Candidate publication with read-version preconditions and bound receipts.
 *
 * A publication is admitted only when the snapshot that was verified is still
 * the snapshot being published. Three separate facts are checked, because any
 * one of them alone lets a stale candidate through:
 *   - every key the proposal read is still at the version it read,
 *   - the parent revision has not advanced,
 *   - the receipt is bound to this candidate, contract, check set and
 *     environment rather than to an earlier composition of them.
 *
 * Absence is a dependency: reading a key that did not exist records version 0,
 * so a later creation invalidates the proposal instead of silently racing it.
 *
 * Bounded model: one accepted snapshot pointer, file effects abstracted as a
 * single update. Real multi-file atomicity needs immutable candidates plus a
 * Git CAS/outbox protocol; this class does not provide that.
 */

import { createHash } from "node:crypto";
import { canonical } from "../metacognition/validation.ts";

export type PublicationOutcome =
	| "accepted"
	| "already-accepted"
	| "id-collision"
	| "stale"
	| "invalid-binding"
	| "unverified";

export type WriteValue = string | null;

export interface ChangeProposal {
	readonly proposalId: string;
	/** Every key touched, with the version observed at propose time. */
	readonly readVersions: readonly (readonly [string, number])[];
	/** `null` deletes the key. */
	readonly writes: readonly (readonly [string, WriteValue])[];
}

export interface StagedChange {
	readonly proposal: ChangeProposal;
	readonly parentRevision: number;
	readonly candidateDigest: string;
	readonly contractDigest: string;
	readonly checkDigest: string;
	readonly environmentDigest: string;
}

export interface VerificationReceipt {
	readonly candidateDigest: string;
	readonly contractDigest: string;
	readonly checkDigest: string;
	readonly environmentDigest: string;
	readonly verdict: "pass" | "fail" | "inconclusive";
	readonly pendingEffects: number;
}

function digest(value: unknown): string {
	return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function byKey(a: readonly [string, unknown], b: readonly [string, unknown]): number {
	if (a[0] < b[0]) return -1;
	return a[0] > b[0] ? 1 : 0;
}

export class IntegrationPublisher {
	private readonly values = new Map<string, string>();
	private readonly versions = new Map<string, number>();
	private readonly acceptedFingerprints = new Map<string, string>();
	private currentRevision = 0;

	constructor(initial: Readonly<Record<string, string>>) {
		for (const [key, value] of Object.entries(initial)) {
			this.values.set(key, value);
			this.versions.set(key, 1);
		}
	}

	get revision(): number {
		return this.currentRevision;
	}

	snapshot(): Record<string, string> {
		return Object.fromEntries(this.values);
	}

	/** Record the versions of every key this change reads or writes. */
	propose(proposalId: string, reads: readonly string[], writes: Readonly<Record<string, WriteValue>>): ChangeProposal {
		if (typeof proposalId !== "string" || proposalId.length === 0) {
			throw new TypeError("proposalId must be a non-empty string");
		}
		const touched = new Set<string>([...reads, ...Object.keys(writes)]);
		return Object.freeze({
			proposalId,
			readVersions: Object.freeze(
				[...touched].map((key) => Object.freeze([key, this.versions.get(key) ?? 0] as const)).sort(byKey),
			),
			writes: Object.freeze(
				Object.entries(writes)
					.map(([key, value]) => Object.freeze([key, value] as const))
					.sort(byKey),
			),
		});
	}

	private isCurrent(proposal: ChangeProposal): boolean {
		const declared = new Map(proposal.readVersions);
		if (proposal.writes.some(([key]) => !declared.has(key))) return false;
		return proposal.readVersions.every(([key, version]) => (this.versions.get(key) ?? 0) === version);
	}

	private applied(proposal: ChangeProposal): Map<string, string> {
		const next = new Map(this.values);
		for (const [key, value] of proposal.writes) {
			if (value === null) next.delete(key);
			else next.set(key, value);
		}
		return next;
	}

	stage(
		proposal: ChangeProposal,
		contractDigest = "contract-v1",
		checkDigest = "checks-v1",
		environmentDigest = "env-v1",
	): StagedChange | null {
		if (!this.isCurrent(proposal)) return null;
		return Object.freeze({
			proposal,
			parentRevision: this.currentRevision,
			candidateDigest: digest(Object.fromEntries(this.applied(proposal))),
			contractDigest,
			checkDigest,
			environmentDigest,
		});
	}

	publish(staged: StagedChange, receipt: VerificationReceipt): PublicationOutcome {
		const proposal = staged.proposal;
		const fingerprint = digest({
			proposalId: proposal.proposalId,
			readVersions: proposal.readVersions,
			writes: proposal.writes,
		});
		const seen = this.acceptedFingerprints.get(proposal.proposalId);
		if (seen !== undefined) return seen === fingerprint ? "already-accepted" : "id-collision";
		if (staged.parentRevision !== this.currentRevision || !this.isCurrent(proposal)) return "stale";
		if (!sameBinding(staged, receipt)) return "invalid-binding";
		if (receipt.verdict !== "pass" || receipt.pendingEffects !== 0) return "unverified";

		// Recompute the candidate: guards a staged payload swapped after verification.
		const rebuilt = this.stage(proposal, staged.contractDigest, staged.checkDigest, staged.environmentDigest);
		if (rebuilt === null || rebuilt.candidateDigest !== staged.candidateDigest) return "invalid-binding";

		for (const [key, value] of proposal.writes) {
			if (value === null) this.values.delete(key);
			else this.values.set(key, value);
			this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
		}
		this.currentRevision += 1;
		this.acceptedFingerprints.set(proposal.proposalId, fingerprint);
		return "accepted";
	}
}

function sameBinding(staged: StagedChange, receipt: VerificationReceipt): boolean {
	return (
		staged.candidateDigest === receipt.candidateDigest &&
		staged.contractDigest === receipt.contractDigest &&
		staged.checkDigest === receipt.checkDigest &&
		staged.environmentDigest === receipt.environmentDigest
	);
}
