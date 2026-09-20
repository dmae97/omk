/**
 * Claim/evidence gap inspection and the bounded next-action selector.
 *
 * Ported from docs/OMK_skill_knowledge_control_2026-09-19.zip
 * (src/knowledge.ts). Host-owned observations only; a model's JSON is never
 * runner truth. See OMK_metacognitive_control_algorithms_2026-09-19.md §13.
 */
import { canonical, ensure, integer, lexical, member, text, unique } from "./validation.ts";

export type Stage = "before-change" | "after-change";
export interface Claim {
	readonly id: string;
	/** Hash/fingerprint computed by the host over the relevant subject and environment. */
	readonly binding: string;
	readonly phase: "precondition" | "postcondition";
	readonly statement: string;
	readonly required: boolean;
	readonly impact: number;
	readonly needsReference: boolean;
	readonly requiresVersion: boolean;
	readonly version: string | null;
	readonly minSourceFamilies: number;
	readonly requiredCheckIds: readonly string[];
	readonly needsUserDecision: boolean;
	/** Only explicit, host-approved public text can leave the repository. */
	readonly publicQuery: string | null;
}
export interface SourceIdentity {
	readonly id: string;
	readonly family: string;
	readonly kind: "repository" | "official" | "community" | "model";
}
interface ObservationBase {
	readonly id: string;
	readonly claimId: string;
	readonly binding: string;
	readonly observedAtMs: number;
	readonly expiresAtMs: number;
}
export interface ReferenceObservation extends ObservationBase {
	readonly kind: "reference";
	readonly sourceId: string;
	readonly version: string | null;
	readonly stance: "support" | "refute";
	readonly documentDigest: string;
	readonly locator: string;
}
export interface CheckObservation extends ObservationBase {
	readonly kind: "check";
	readonly runnerId: string;
	readonly checkId: string;
	/** Host-ordered snapshot. In OMK, project the existing strict evidence ledger here. */
	readonly sequence: number;
	readonly verdict: "pass" | "fail" | "pending";
}
export interface DecisionObservation extends ObservationBase {
	readonly kind: "decision";
	readonly actorId: string;
	readonly accepted: boolean;
}
export type Observation = ReferenceObservation | CheckObservation | DecisionObservation;
export type GapReason =
	| "unassessed-step"
	| "unknown-version"
	| "unsupported-reference"
	| "contradictory-reference"
	| "missing-check"
	| "failed-check"
	| "pending-check"
	| "missing-user-decision";
export interface KnowledgeGap {
	readonly claimId: string;
	readonly binding: string;
	readonly reason: GapReason;
	readonly required: boolean;
	readonly impact: number;
	readonly checkId: string | null;
}
export interface KnowledgeReport {
	readonly state: "supported" | "gaps";
	readonly gaps: readonly KnowledgeGap[];
	readonly supportedClaimIds: readonly string[];
	readonly rejectedObservations: readonly { id: string; reason: string }[];
}
export interface KnowledgeInput {
	readonly stage: Stage;
	readonly requiresAssessment: boolean;
	readonly nowMs: number;
	readonly claims: readonly Claim[];
	/** Admitted host observations only. Never pass a model's JSON here as runner truth. */
	readonly observations: readonly Observation[];
	readonly sources: readonly SourceIdentity[];
	readonly trustedRunnerIds: readonly string[];
	readonly decisionActorIds: readonly string[];
}

export function inspectKnowledge(input: KnowledgeInput): KnowledgeReport {
	member(input.stage, ["before-change", "after-change"], "stage");
	integer(input.nowMs, "nowMs");
	ensure(typeof input.requiresAssessment === "boolean", "requiresAssessment must be boolean");
	ensure(input.claims.length <= 128 && input.observations.length <= 4096, "knowledge input too large");
	unique(
		input.claims.map((c) => c.id),
		"claim ids",
		128,
	);
	unique(
		input.sources.map((s) => s.id),
		"source ids",
		512,
	);
	unique(input.trustedRunnerIds, "runner ids");
	unique(input.decisionActorIds, "decision actor ids");
	for (const c of input.claims) {
		text(c.binding, "binding");
		text(c.statement, "statement");
		member(c.phase, ["precondition", "postcondition"], "claim phase");
		for (const v of [c.required, c.needsReference, c.requiresVersion, c.needsUserDecision]) {
			ensure(typeof v === "boolean", "invalid claim flag");
		}
		ensure(Number.isFinite(c.impact) && c.impact >= 0 && c.impact <= 1_000_000, "invalid impact");
		integer(c.minSourceFamilies, "minSourceFamilies", 16);
		ensure(!c.needsReference || c.minSourceFamilies > 0, "reference needs at least one source family");
		if (c.version !== null) text(c.version, "version", 128);
		if (c.publicQuery !== null) text(c.publicQuery, "publicQuery", 500);
		unique(c.requiredCheckIds, "check ids", 128);
		ensure(
			c.needsReference || c.requiredCheckIds.length > 0 || c.needsUserDecision,
			"claim has no evidence predicate",
		);
	}
	const sources = new Map(
		input.sources.map((s) => {
			text(s.family, "source family");
			member(s.kind, ["repository", "official", "community", "model"], "source kind");
			return [s.id, s] as const;
		}),
	);
	const observations = new Map<string, Observation>();
	const sequences = new Map<string, string>();
	for (const obs of input.observations) {
		text(obs.id, "observation id");
		text(obs.claimId, "observation claim");
		text(obs.binding, "observation binding");
		integer(obs.observedAtMs, "observedAtMs");
		integer(obs.expiresAtMs, "expiresAtMs");
		ensure(obs.expiresAtMs >= obs.observedAtMs, "invalid observation validity interval");
		member(obs.kind, ["reference", "check", "decision"], "observation kind");
		if (obs.kind === "reference") {
			text(obs.sourceId, "sourceId");
			text(obs.documentDigest, "documentDigest");
			text(obs.locator, "locator");
			if (obs.version !== null) text(obs.version, "observation version", 128);
			member(obs.stance, ["support", "refute"], "stance");
		} else if (obs.kind === "check") {
			text(obs.runnerId, "runnerId");
			text(obs.checkId, "checkId");
			integer(obs.sequence, "sequence");
			member(obs.verdict, ["pass", "fail", "pending"], "check verdict");
			const key = canonical([obs.claimId, obs.binding, obs.checkId, obs.sequence]);
			const previous = sequences.get(key);
			ensure(previous === undefined || previous === canonical(obs), "conflicting check sequence");
			sequences.set(key, canonical(obs));
		} else {
			text(obs.actorId, "actorId");
			ensure(typeof obs.accepted === "boolean", "invalid decision");
		}
		const previous = observations.get(obs.id);
		ensure(previous === undefined || canonical(previous) === canonical(obs), "conflicting observation id");
		observations.set(obs.id, obs);
	}
	const relevantClaims = input.claims.filter((c) => input.stage === "after-change" || c.phase === "precondition");
	const rejectedObservations: { id: string; reason: string }[] = [];
	const admissible = new Map<string, Observation[]>();
	const claimMap = new Map(relevantClaims.map((c) => [c.id, c]));
	for (const obs of observations.values()) {
		const c = claimMap.get(obs.claimId);
		let reason: string | undefined;
		if (!c) reason = "irrelevant-claim-or-stage";
		else if (obs.binding !== c.binding) reason = "stale-binding";
		else if (obs.observedAtMs > input.nowMs || obs.expiresAtMs <= input.nowMs) reason = "expired-or-future";
		else if (obs.kind === "reference") {
			const source = sources.get(obs.sourceId);
			if (!source || (source.kind !== "repository" && source.kind !== "official")) reason = "inadmissible-source";
			else if (c.requiresVersion && (c.version === null || obs.version !== c.version)) reason = "version-mismatch";
		} else if (obs.kind === "check" && !input.trustedRunnerIds.includes(obs.runnerId)) reason = "untrusted-runner";
		else if (obs.kind === "decision" && !input.decisionActorIds.includes(obs.actorId)) {
			reason = "untrusted-decision-actor";
		}
		if (reason) rejectedObservations.push({ id: obs.id, reason });
		else admissible.set(obs.claimId, [...(admissible.get(obs.claimId) ?? []), obs]);
	}
	const gaps: KnowledgeGap[] = [];
	const supportedClaimIds: string[] = [];
	if (input.requiresAssessment && relevantClaims.filter((c) => c.required).length === 0) {
		gaps.push({
			claimId: "$step",
			binding: "unassessed",
			reason: "unassessed-step",
			required: true,
			impact: 1_000_000,
			checkId: null,
		});
	}
	for (const c of relevantClaims) {
		const before = gaps.length;
		const evidence = admissible.get(c.id) ?? [];
		const add = (reason: GapReason, checkId: string | null = null): void => {
			gaps.push({ claimId: c.id, binding: c.binding, reason, required: c.required, impact: c.impact, checkId });
		};
		if (c.requiresVersion && c.version === null) add("unknown-version");
		if (c.needsReference) {
			const refs = evidence.filter((obs): obs is ReferenceObservation => obs.kind === "reference");
			const support = new Set(
				refs.filter((r) => r.stance === "support").map((r) => sources.get(r.sourceId)!.family),
			);
			if (refs.some((r) => r.stance === "refute")) add("contradictory-reference");
			else if (support.size < c.minSourceFamilies) add("unsupported-reference");
		}
		for (const checkId of c.requiredCheckIds) {
			const records = evidence
				.filter((obs): obs is CheckObservation => obs.kind === "check" && obs.checkId === checkId)
				.sort((a, b) => a.sequence - b.sequence);
			const latest = records.at(-1);
			if (!latest) add("missing-check", checkId);
			else if (latest.verdict === "fail") add("failed-check", checkId);
			else if (latest.verdict === "pending") add("pending-check", checkId);
		}
		if (c.needsUserDecision) {
			const decisions = evidence.filter((obs): obs is DecisionObservation => obs.kind === "decision");
			if (!decisions.some((d) => d.accepted) || decisions.some((d) => !d.accepted)) add("missing-user-decision");
		}
		if (before === gaps.length) supportedClaimIds.push(c.id);
	}
	gaps.sort(
		(a, b) =>
			Number(b.required) - Number(a.required) ||
			b.impact - a.impact ||
			lexical(a.claimId, b.claimId) ||
			lexical(a.reason, b.reason),
	);
	return {
		state: gaps.some((g) => g.required) ? "gaps" : "supported",
		gaps,
		supportedClaimIds: supportedClaimIds.sort(lexical),
		rejectedObservations,
	};
}
