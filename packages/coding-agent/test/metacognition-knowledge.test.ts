/**
 * Ported from docs/OMK_skill_knowledge_control_2026-09-19.zip
 * (test/knowledge.test.mjs) — node:test → vitest, same assertions.
 */
import { describe, expect, it } from "vitest";
import {
	type CheckObservation,
	type Claim,
	inspectKnowledge,
	type KnowledgeInput,
	nextKnowledgeAction,
	type ReferenceObservation,
	type SearchAttempt,
} from "../src/metacognition/index.ts";

const claim = (over: Partial<Claim> = {}): Claim => ({
	id: "api",
	binding: "stack-v1",
	phase: "precondition",
	statement: "Verify public API contract",
	required: true,
	impact: 10,
	needsReference: true,
	requiresVersion: true,
	version: "1.2.3",
	minSourceFamilies: 1,
	requiredCheckIds: [],
	needsUserDecision: false,
	publicQuery: "lib 1.2.3 API contract",
	...over,
});
const reference = (over: Partial<ReferenceObservation> = {}): ReferenceObservation => ({
	kind: "reference",
	id: "r1",
	claimId: "api",
	binding: "stack-v1",
	observedAtMs: 10,
	expiresAtMs: 100,
	sourceId: "official",
	version: "1.2.3",
	stance: "support",
	documentDigest: "digest",
	locator: "official-doc#api",
	...over,
});
const check = (over: Partial<CheckObservation> = {}): CheckObservation => ({
	kind: "check",
	id: "t1",
	claimId: "api",
	binding: "stack-v1",
	observedAtMs: 10,
	expiresAtMs: 100,
	runnerId: "runner",
	checkId: "types",
	sequence: 1,
	verdict: "pass",
	...over,
});
const base = (over: Partial<KnowledgeInput> = {}): KnowledgeInput => ({
	stage: "before-change",
	requiresAssessment: true,
	nowMs: 20,
	claims: [claim()],
	observations: [],
	sources: [
		{ id: "official", family: "upstream", kind: "official" },
		{ id: "mirror", family: "upstream", kind: "official" },
		{ id: "local", family: "repository", kind: "repository" },
		{ id: "community", family: "community", kind: "community" },
		{ id: "model", family: "model", kind: "model" },
	],
	trustedRunnerIds: ["runner"],
	decisionActorIds: ["owner"],
	...over,
});
const policy = (over = {}) => ({
	availableChannels: ["local", "official", "web"] as const,
	remoteQueryApprovedClaimIds: ["api"],
	remainingRequests: 3,
	remainingMs: 1000,
	...over,
});
const action = (i: KnowledgeInput, attempts: SearchAttempt[] = [], p = policy()) =>
	nextKnowledgeAction(inspectKnowledge(i), i.claims, attempts, p as never);
const attempt = (channel: SearchAttempt["channel"], result: SearchAttempt["result"] = "empty"): SearchAttempt => ({
	claimId: "api",
	binding: "stack-v1",
	channel,
	result,
});

describe("knowledge gap inspection", () => {
	it("model confidence does not turn missing references into supported knowledge", () => {
		const report = inspectKnowledge(base({ claims: [{ ...claim(), confidence: 1 } as Claim] }));
		expect(report.state).toBe("gaps");
		expect(report.gaps[0]!.reason).toBe("unsupported-reference");
	});
	it("bound current official reference supports the declared predicate only", () => {
		expect(inspectKnowledge(base({ observations: [reference()] })).state).toBe("supported");
	});
	it("same upstream mirrored twice is one source family", () => {
		const partial = base({
			claims: [claim({ minSourceFamilies: 2 })],
			observations: [reference(), reference({ id: "r2", sourceId: "mirror" })],
		});
		expect(inspectKnowledge(partial).state).toBe("gaps");
		const full = base({
			claims: [claim({ minSourceFamilies: 2 })],
			observations: [
				reference(),
				reference({ id: "r2", sourceId: "mirror" }),
				reference({ id: "r3", sourceId: "local" }),
			],
		});
		expect(inspectKnowledge(full).state).toBe("supported");
	});
	it("stale bindings, expired, future and wrong-version observations cannot close a gap", () => {
		for (const over of [
			{ binding: "old" },
			{ expiresAtMs: 20 },
			{ observedAtMs: 21 },
			{ version: "2.0.0" },
			{ version: null },
		] as const) {
			const report = inspectKnowledge(base({ observations: [reference(over)] }));
			expect(report.state).toBe("gaps");
			expect(report.rejectedObservations.length).toBe(1);
		}
	});
	it("community and model outputs remain leads, never admitted official evidence", () => {
		for (const sourceId of ["community", "model", "unknown"]) {
			expect(inspectKnowledge(base({ observations: [reference({ sourceId })] })).state).toBe("gaps");
		}
	});
	it("support plus refutation stays contradictory, not a majority vote", () => {
		const i = base({ observations: [reference(), reference({ id: "r2", sourceId: "local", stance: "refute" })] });
		expect(inspectKnowledge(i).gaps[0]!.reason).toBe("contradictory-reference");
	});
	it("unknown exact version calls for local inspection", () => {
		expect(action(base({ claims: [claim({ version: null })] })).kind).toBe("inspect-local");
	});
	it("reference evidence does not replace a required check, and check failure blocks", () => {
		const i = base({ claims: [claim({ requiredCheckIds: ["types"] })], observations: [reference()] });
		expect(action(i).kind).toBe("run-check");
		const failed = base({
			claims: [claim({ requiredCheckIds: ["types"] })],
			observations: [reference(), check({ verdict: "fail" })],
		});
		expect(action(failed).kind).toBe("repair");
	});
	it("untrusted test runner cannot supply a pass", () => {
		const i = base({
			claims: [claim({ needsReference: false, requiredCheckIds: ["types"] })],
			observations: [check({ runnerId: "model" })],
		});
		expect(inspectKnowledge(i).state).toBe("gaps");
	});
	it("postconditions are demanded after, not before, writing implementation", () => {
		const i = base({
			claims: [
				claim(),
				claim({
					id: "tests",
					binding: "artifact-v1",
					phase: "postcondition",
					needsReference: false,
					requiredCheckIds: ["tests"],
				}),
			],
			observations: [reference()],
		});
		expect(inspectKnowledge(i).state).toBe("supported");
		expect(inspectKnowledge({ ...i, stage: "after-change" }).state).toBe("gaps");
	});
	it("new candidate fingerprint invalidates a formerly passing check", () => {
		const i = base({
			claims: [claim({ binding: "artifact-v2", needsReference: false, requiredCheckIds: ["types"] })],
			observations: [check({ binding: "artifact-v1" })],
		});
		expect(inspectKnowledge(i).state).toBe("gaps");
	});
	it("latest host-ordered required check wins; pending is not pass", () => {
		const i = base({
			claims: [claim({ needsReference: false, requiredCheckIds: ["types"] })],
			observations: [check(), check({ id: "t2", sequence: 2, verdict: "pending" })],
		});
		expect(action(i).kind).toBe("await-owned-work");
	});
	it("duplicate identical observations are idempotent; contradictory identities throw", () => {
		expect(inspectKnowledge(base({ observations: [reference(), reference()] })).state).toBe("supported");
		expect(() => inspectKnowledge(base({ observations: [reference(), reference({ stance: "refute" })] }))).toThrow();
		expect(() => inspectKnowledge(base({ observations: [check(), check({ id: "t2", verdict: "fail" })] }))).toThrow();
	});
	it("empty and advisory-only assessment cannot grant a required assessment", () => {
		for (const claims of [[], [claim({ required: false })] as Claim[]]) {
			expect(action(base({ claims })).kind).toBe("form-obligations");
		}
		expect(() => inspectKnowledge(base({ claims: [claim({ needsReference: false })] }))).toThrow();
	});
	it("user decisions are not inferred by searching more documents", () => {
		expect(action(base({ claims: [claim({ needsReference: false, needsUserDecision: true })] })).kind).toBe(
			"ask-user",
		);
	});
	it("acquisition progresses local → official → web with explicit egress approval", () => {
		const i = base();
		expect((action(i) as { channel?: string }).channel).toBe("local");
		expect((action(i, [attempt("local")]) as { channel?: string }).channel).toBe("official");
		expect((action(i, [attempt("local"), attempt("official")]) as { channel?: string }).channel).toBe("web");
		expect(action(i, [attempt("local"), attempt("official"), attempt("web")]).kind).toBe("blocked");
	});
	it("missing approval, missing query, zero budget, offline availability stay explicit blocks", () => {
		const i = base();
		expect(action(i, [attempt("local")], policy({ remoteQueryApprovedClaimIds: [] })).kind).toBe("blocked");
		expect(action(base({ claims: [claim({ publicQuery: null })] }), [attempt("local")]).kind).toBe("blocked");
		expect(action(i, [], policy({ remainingRequests: 0 })).kind).toBe("blocked");
		expect(action(i, [], policy({ remainingMs: 0 })).kind).toBe("blocked");
		expect(action(i, [], policy({ availableChannels: [] })).kind).toBe("blocked");
	});
	it("retrieved candidates require review, not automatic closure or blind research", () => {
		expect(action(base(), [attempt("local", "candidates")]).kind).toBe("review-candidates");
		expect(action(base(), [attempt("local", "in-flight")]).kind).toBe("await-owned-work");
	});
	it("failed searches from another binding do not suppress a new revision search", () => {
		const old = { ...attempt("local"), binding: "old" };
		expect((action(base(), [old]) as { channel?: string }).channel).toBe("local");
	});
	it("reference/check truth table matches conjunction over declared obligations", () => {
		for (const refState of ["none", "support", "refute"] as const) {
			for (const checkState of ["none", "pass", "fail", "pending"] as const) {
				const observations = [] as (ReferenceObservation | CheckObservation)[];
				if (refState !== "none") observations.push(reference({ stance: refState }));
				if (checkState !== "none") observations.push(check({ verdict: checkState }));
				const report = inspectKnowledge(base({ claims: [claim({ requiredCheckIds: ["types"] })], observations }));
				expect(report.state === "supported").toBe(refState === "support" && checkState === "pass");
			}
		}
	});
});
