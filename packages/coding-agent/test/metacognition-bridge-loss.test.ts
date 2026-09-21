/**
 * WP05 loss-aware metacognition bridge — acceptance tests.
 *
 * Enumerates what the previous mapper preserved vs silently lost, and pins
 * the new contract: mapped | partial | rejected, where `partial` declares
 * lostFields/unmappedClaims/unknownBindings/sourceFamilyConflicts and never
 * promotes completion on a required claim, and `rejected` returns a loss
 * reason instead of fabricating provenance.
 *
 * Hard rules under test (docs/06):
 * - a multi-claim observation never collapses to its first claim;
 * - checkId is the host's check predicate id, never receiptId or the first
 *   invalidation key;
 * - sequence and observedAtMs are the observation's own, never 0/nowMs;
 * - a past or foreign observation is never re-bound to the current candidate;
 * - unknown/neutral/inconclusive polarity is never coerced to a boolean;
 * - same-family witnesses never inflate independence.
 */

import type { ClaimNode, ObservationNode } from "omk-protocol";
import { describe, expect, it } from "vitest";
import {
	type BridgeObservation,
	bridgeBlocksCompletion,
	type Claim,
	finishState,
	inspectKnowledge,
	mapClaim,
	mapObservation,
	type ObservationMapContext,
	type RuntimeBridgeOutput,
	sourceIdentities,
	toMetaState,
} from "../src/metacognition/index.ts";

const claim = (over: Partial<ClaimNode> = {}): ClaimNode => ({
	claimId: "c1",
	kind: "requirement",
	statement: "late async results must not overwrite newer state",
	severity: "required",
	satisfaction: { rule: "all", inputs: [] },
	trustFloor: "deterministic_validator",
	invalidationKeys: ["ordering-check"],
	...over,
});

/** A fully-provenanced host observation: everything the kernel needs is explicit. */
const obs = (over: Partial<BridgeObservation> = {}): BridgeObservation => ({
	observationId: "o1",
	claimIds: ["c1"],
	polarity: "supports",
	source: "deterministic_validator",
	sourceRoot: "src",
	environmentDigest: "env-1",
	receiptId: "r1",
	checkId: "ordering-check",
	sequence: 7,
	observedAtMs: 900,
	validUntil: "1970-01-01T00:00:01.500Z",
	binding: "cand-1@env-1",
	...over,
});

const kernelClaimOf = (node: ClaimNode): Claim => {
	const m = mapClaim(node, "after-change", "cand-1@env-1");
	if (m.status === "rejected") throw new Error(`claim fixture rejected: ${m.reason}`);
	return m.claim;
};

const ctxFor = (
	claims: readonly ClaimNode[],
	floors?: ReadonlyMap<string, ClaimNode["trustFloor"]>,
): ObservationMapContext => ({
	binding: "cand-1@env-1",
	nowMs: 1000,
	claimById: new Map(claims.map((c) => [c.claimId, kernelClaimOf(c)])),
	claimFloors: floors ?? new Map(claims.map((c) => [c.claimId, c.trustFloor])),
	sources: sourceIdentities(),
});

const mapCtx = ctxFor([claim()]);

const input = (over: Partial<Parameters<typeof toMetaState>[0]> = {}) => ({
	taskId: "t1",
	stageId: "s1",
	goalScope: "ui-search",
	targetArtifact: "src/search.ts",
	candidateHash: "cand-1",
	environmentHash: "env-1",
	claims: [claim()] as readonly ClaimNode[],
	observations: [] as readonly BridgeObservation[],
	trustedRunnerIds: ["deterministic_validator", "workspace_witness"],
	decisionActorIds: ["owner"],
	authorizedActions: ["inspect_local", "finish_with_bound_receipt", "stop_inconclusive"],
	budget: { remainingMs: 60_000, remainingRequests: 50, remainingTokens: 100_000, remainingConcurrent: 4 },
	policyVersion: "p1",
	modelRevision: "m1",
	stage: "after-change" as const,
	nowMs: 1000,
	...over,
});

const knowledge = (out: RuntimeBridgeOutput) =>
	inspectKnowledge({
		stage: "after-change",
		requiresAssessment: true,
		nowMs: 1000,
		claims: out.claims,
		observations: out.observations,
		sources: out.sources,
		trustedRunnerIds: ["deterministic_validator", "workspace_witness"],
		decisionActorIds: ["owner"],
	});

describe("observation mapping — preserved attributes (mapped)", () => {
	it("preserves observedAtMs, sequence, checkId, expiry and binding verbatim", () => {
		const r = mapObservation(obs(), mapCtx);
		expect(r.status).toBe("mapped");
		if (r.status !== "mapped") return;
		expect(r.observations).toHaveLength(1);
		const edge = r.observations[0]!;
		expect(edge.kind).toBe("check");
		if (edge.kind !== "check") return;
		expect(edge.observedAtMs).toBe(900);
		expect(edge.expiresAtMs).toBe(1500);
		expect(edge.sequence).toBe(7);
		expect(edge.checkId).toBe("ordering-check");
		expect(edge.binding).toBe("cand-1@env-1");
		expect(edge.verdict).toBe("pass");
	});
	it("emits one edge per claim for a multi-claim observation — never first-only", () => {
		const claims = [claim(), claim({ claimId: "c2", invalidationKeys: ["c2-check"] })];
		const r = mapObservation(obs({ claimIds: ["c1", "c2"], checkId: "ordering-check" }), ctxFor(claims));
		expect(r.status).toBe("mapped");
		if (r.status !== "mapped") return;
		expect(r.observations.map((o) => o.claimId).sort()).toEqual(["c1", "c2"]);
		expect(new Set(r.observations.map((o) => o.id)).size).toBe(2);
	});
	it("one observation attesting several check predicates emits one edge per checkId", () => {
		const c2 = claim({ claimId: "c2", invalidationKeys: ["style-check"] });
		const r = mapObservation(
			obs({ claimIds: ["c1", "c2"], checkId: "ordering-check", checkIds: ["style-check"] }),
			ctxFor([claim(), c2]),
		);
		expect(r.status).toBe("mapped");
		if (r.status !== "mapped") return;
		const keys = r.observations.map((o) => (o.kind === "check" ? `${o.claimId}/${o.checkId}` : "")).sort();
		expect(keys).toEqual(["c1/ordering-check", "c1/style-check", "c2/ordering-check", "c2/style-check"]);
		expect(new Set(r.observations.map((o) => o.id)).size).toBe(4);
	});
	it("maps unknown/neutral/inconclusive polarity on a check to a pending verdict — not a boolean", () => {
		for (const polarity of ["unknown", "neutral", "inconclusive"] as const) {
			const r = mapObservation(obs({ polarity }), mapCtx);
			expect(r.status).toBe("mapped");
			if (r.status !== "mapped") continue;
			const edge = r.observations[0]!;
			if (edge.kind === "check") expect(edge.verdict).toBe("pending");
		}
	});
});

describe("observation mapping — loss declarations (partial)", () => {
	it("no observedAtMs: emits nothing usable and declares lostFields instead of stamping nowMs", () => {
		const r = mapObservation(obs({ observedAtMs: undefined }), mapCtx);
		expect(r.status).toBe("partial");
		if (r.status !== "partial") return;
		expect(r.observations).toHaveLength(0);
		expect(r.loss.lostFields.some((f) => f.includes("observedAtMs"))).toBe(true);
	});
	it("no validUntil: never fabricates expiry (old code used nowMs+1)", () => {
		const r = mapObservation(obs({ validUntil: undefined }), mapCtx);
		expect(r.status).toBe("partial");
		if (r.status !== "partial") return;
		expect(r.observations).toHaveLength(0);
		expect(r.loss.lostFields.some((f) => f.includes("validUntil"))).toBe(true);
	});
	it("no binding: goes to unknownBindings and is never re-bound to the current candidate", () => {
		const r = mapObservation(obs({ binding: undefined }), mapCtx);
		expect(r.status).toBe("partial");
		if (r.status !== "partial") return;
		expect(r.observations).toHaveLength(0);
		expect(r.loss.unknownBindings).toContain("o1");
	});
	it("missing checkId: no substitution from receiptId or invalidationKeys", () => {
		const r = mapObservation(obs({ checkId: undefined }), mapCtx);
		expect(r.status).toBe("partial");
		if (r.status !== "partial") return;
		expect(r.observations).toHaveLength(0);
		expect(r.loss.lostFields.some((f) => f.includes("checkId"))).toBe(true);
	});
	it("missing sequence: not forced to 0", () => {
		const r = mapObservation(obs({ sequence: undefined }), mapCtx);
		expect(r.status).toBe("partial");
		if (r.status !== "partial") return;
		expect(r.observations).toHaveLength(0);
		expect(r.loss.lostFields.some((f) => f.includes("sequence"))).toBe(true);
	});
	it("below-trustFloor source: edge suppressed, claim stays unmapped rather than admitted", () => {
		const r = mapObservation(obs({ source: "self_review" }), mapCtx);
		expect(r.status).toBe("partial");
		if (r.status !== "partial") return;
		expect(r.observations).toHaveLength(0);
		expect(r.loss.unmappedClaims.some((u) => u.includes("c1"))).toBe(true);
	});
	it("one unresolvable claim out of many: mapped edges kept, the rest declared", () => {
		const claims = [claim(), claim({ claimId: "c2", invalidationKeys: ["k2"] })];
		const r = mapObservation(obs({ claimIds: ["c1", "cX", "c2"] }), ctxFor(claims));
		expect(r.status).toBe("partial");
		if (r.status !== "partial") return;
		expect(r.observations.map((o) => o.claimId).sort()).toEqual(["c1", "c2"]);
		expect(r.loss.unmappedClaims.some((u) => u.includes("cX"))).toBe(true);
	});
	it("duplicate same-source citations collapse into a sourceFamilyConflicts note, never extra families", () => {
		const a = obs({ observationId: "oA" });
		const b = obs({ observationId: "oB" });
		const ra = mapObservation(a, mapCtx);
		const rb = mapObservation(b, mapCtx);
		expect(ra.status).toBe("mapped");
		expect(rb.status).toBe("mapped");
		const out = toMetaState(input({ observations: [a, b] }));
		expect(out.status).toBe("partial");
		if (out.status !== "partial") return;
		expect(out.loss.sourceFamilyConflicts.length).toBeGreaterThan(0);
	});
	it("conflicting witnesses on one claim are flagged, and the kernel still sees the contradiction", () => {
		const sup = obs({ observationId: "oS", polarity: "supports" });
		const ref = obs({ observationId: "oR", polarity: "violates" });
		const out = toMetaState(input({ observations: [sup, ref] }));
		expect(out.status).toBe("partial");
		if (out.status !== "partial") return;
		expect(out.loss.sourceFamilyConflicts.length).toBeGreaterThan(0);
	});
	it("conflicting check witnesses at the same sequence are suppressed, not thrown into the kernel", () => {
		const pass = obs({ observationId: "oP", polarity: "supports" });
		const fail = obs({ observationId: "oF", polarity: "violates" });
		const out = toMetaState(input({ observations: [pass, fail] }));
		expect(out.status).not.toBe("rejected");
		if (out.status === "rejected") return;
		const report = knowledge(out.value);
		expect(report.state).toBe("gaps");
	});
	it("scopeSensitive claims map but declare the lossy field", () => {
		const m = mapClaim(claim({ scopeSensitive: true }), "after-change", "cand-1@env-1");
		expect(m.status).toBe("partial");
		if (m.status !== "partial") return;
		expect(m.loss.lostFields.some((f) => f.includes("scopeSensitive"))).toBe(true);
	});
});

describe("observation mapping — rejected (conflict, never fabricated)", () => {
	it("a past candidate binding is rejected, never reattached to the current candidate", () => {
		const r = mapObservation(obs({ binding: "old-cand@env-1" }), mapCtx);
		expect(r.status).toBe("rejected");
		if (r.status !== "rejected") return;
		expect(r.reason).toContain("binding");
	});
	it("a foreign environment binding is rejected", () => {
		const r = mapObservation(obs({ binding: "cand-1@other-env" }), mapCtx);
		expect(r.status).toBe("rejected");
	});
	it("a generation mismatch is rejected immediately", () => {
		const r = mapObservation(obs({ generation: 2 }), { ...mapCtx, generation: 3 });
		expect(r.status).toBe("rejected");
		if (r.status !== "rejected") return;
		expect(r.reason).toContain("generation");
	});
	it("a future timestamp is rejected as a clock conflict, not admitted as fresh", () => {
		const r = mapObservation(obs({ observedAtMs: 5000, validUntil: "1970-01-01T00:00:06.000Z" }), mapCtx);
		expect(r.status).toBe("rejected");
	});
	it("an expired observation is rejected", () => {
		const r = mapObservation(obs({ observedAtMs: 100, validUntil: "1970-01-01T00:00:00.500Z" }), mapCtx);
		expect(r.status).toBe("rejected");
	});
	it("unknown polarity on a reference is rejected — stance cannot express it", () => {
		const r = mapObservation(
			obs({ receiptId: undefined, checkId: undefined, sequence: undefined, polarity: "inconclusive" }),
			mapCtx,
		);
		expect(r.status).toBe("rejected");
	});
	it("unknown polarity on a model decision is rejected — never coerced to a boolean", () => {
		const r = mapObservation(
			obs({
				source: "model_narrative",
				polarity: "unknown",
				receiptId: undefined,
				checkId: undefined,
				sequence: undefined,
			}),
			{ ...mapCtx, claimFloors: new Map([["c1", "model_narrative" as const]]) },
		);
		expect(r.status).toBe("rejected");
	});
});

/**
 * The completion decision in WP05 order: the bridge gate runs first
 * (partial-on-required and rejected never promote), then the knowledge
 * report must be supported, then finishState may verify a bound receipt.
 */
const admitsCompletion = (out: ReturnType<typeof toMetaState>): boolean => {
	if (out.status === "rejected") return false;
	if (bridgeBlocksCompletion(out)) return false;
	if (knowledge(out.value).state !== "supported") return false;
	return (
		finishState(out.value.state, { receiptId: "r9", candidateHash: "cand-1", scope: "src" }).kind ===
		"verified-completion"
	);
};

describe("bridge end-to-end — the completion gate stays conservative", () => {
	it("fully-provenanced evidence maps and can still close a required check", () => {
		const out = toMetaState(input({ observations: [obs()] }));
		expect(out.status).toBe("mapped");
		if (out.status !== "mapped") return;
		const report = knowledge(out.value);
		expect(report.state).toBe("supported");
		expect(bridgeBlocksCompletion(out)).toBe(false);
		expect(admitsCompletion(out)).toBe(true);
	});
	it("a partial result on a required claim leaves the gate at unknown, never promoted", () => {
		// The only observation has no binding — under the old mapper it was
		// silently bound to cand-1@env-1 and would have closed the check.
		const out = toMetaState(input({ observations: [obs({ binding: undefined })] }));
		expect(out.status).toBe("partial");
		if (out.status !== "partial") return;
		expect(out.touchesRequiredClaims).toContain("c1");
		const report = knowledge(out.value);
		expect(report.state).toBe("gaps");
		expect(report.gaps.some((g) => g.claimId === "c1" && g.reason === "missing-check")).toBe(true);
		expect(bridgeBlocksCompletion(out)).toBe(true);
		expect(admitsCompletion(out)).toBe(false);
	});
	it("a rejected observation never reaches the kernel at all", () => {
		const out = toMetaState(input({ observations: [obs({ binding: "old-cand@env-1" })] }));
		expect(out.status).toBe("partial");
		if (out.status !== "partial") return;
		expect(out.value.observations).toHaveLength(0);
		expect(out.loss.rejectedObservations.some((o) => o.id === "o1")).toBe(true);
		expect(bridgeBlocksCompletion(out)).toBe(true);
	});
	it("a legacy ObservationNode without provenance becomes partial, losing nothing silently", () => {
		const legacy: ObservationNode = {
			observationId: "o1",
			claimIds: ["c1"],
			polarity: "supports",
			source: "deterministic_validator",
			receiptId: "r1",
			sourceRoot: "src",
			environmentDigest: "env-1",
		};
		const out = toMetaState(input({ observations: [legacy] }));
		expect(out.status).toBe("partial");
		if (out.status !== "partial") return;
		expect(out.value.observations).toHaveLength(0);
		expect(out.loss.lostFields.length).toBeGreaterThan(0);
	});
	it("an advisory-only loss does not block completion", () => {
		const advisory = claim({ claimId: "cA", severity: "advisory", invalidationKeys: ["advisory-check"] });
		const required = claim();
		const o = obs({
			claimIds: ["cA"],
			checkId: "advisory-check",
			binding: undefined,
			observationId: "oA",
		});
		const out = toMetaState(input({ claims: [required, advisory], observations: [o, obs()] }));
		expect(out.status).toBe("partial");
		if (out.status !== "partial") return;
		expect(out.touchesRequiredClaims).not.toContain("c1");
		expect(bridgeBlocksCompletion(out)).toBe(false);
	});
	it("compound claims are declared unmapped rather than silently dropped", () => {
		const parent = claim({ claimId: "parent", satisfaction: { rule: "all", inputs: ["c1"] } });
		const out = toMetaState(input({ claims: [claim(), parent], observations: [obs()] }));
		expect(out.status).toBe("partial");
		if (out.status !== "partial") return;
		expect(out.loss.unmappedClaims.some((u) => u.includes("parent"))).toBe(true);
	});
	it("late evidence arriving after expiry stays rejected at the gate", () => {
		const out = toMetaState(
			input({
				observations: [obs({ observedAtMs: 100, validUntil: "1970-01-01T00:00:00.500Z" })],
				nowMs: 1000,
			}),
		);
		expect(out.status).toBe("partial");
		if (out.status !== "partial") return;
		const report = knowledge(out.value);
		expect(report.state).toBe("gaps");
		expect(bridgeBlocksCompletion(out)).toBe(true);
	});
});
