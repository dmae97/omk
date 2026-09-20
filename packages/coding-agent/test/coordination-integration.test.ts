/**
 * Candidate publication and change awareness — increment 2 of the 2026-09-20
 * coordination design.
 *
 * Ported from the author's reference checks. The property under test is that a
 * publication is admitted only when the exact snapshot that was verified is
 * still the snapshot being published: every read it depended on is unchanged,
 * the parent revision still matches, and the receipt is bound to that
 * candidate, contract, check set and environment.
 *
 * `passingReceipt` lives here, not in src, because the reference model marks it
 * TEST FIXTURE ONLY — production receipts must come from a trusted runner.
 */

import { describe, expect, it } from "vitest";
import {
	admissibleFrontier,
	canonicalClaim,
	IntegrationPublisher,
	invalidate,
	type StagedChange,
	type VerificationReceipt,
} from "../src/coordination/index.ts";

function claim(canonicalKey: string, access: "read" | "write" = "write") {
	return canonicalClaim({ namespace: "filesystem", instanceId: "shared", canonicalKey, access, generation: "0" });
}

function passingReceipt(staged: StagedChange): VerificationReceipt {
	return {
		candidateDigest: staged.candidateDigest,
		contractDigest: staged.contractDigest,
		checkDigest: staged.checkDigest,
		environmentDigest: staged.environmentDigest,
		verdict: "pass",
		pendingEffects: 0,
	};
}

function publisher() {
	return new IntegrationPublisher({ front: "v1", back: "v1", contract: "v1" });
}

function apply(
	model: IntegrationPublisher,
	proposalId: string,
	reads: string[],
	writes: Record<string, string | null>,
) {
	const staged = model.stage(model.propose(proposalId, reads, writes));
	expect(staged).not.toBeNull();
	return model.publish(staged!, passingReceipt(staged!));
}

describe("integration publication", () => {
	it("accepts a clean proposal", () => {
		expect(apply(publisher(), "a", [], { front: "v2" })).toBe("accepted");
	});

	it("refuses to stage a write whose key moved underneath it", () => {
		const model = publisher();
		const stale = model.propose("a", [], { front: "v2" });
		apply(model, "b", [], { front: "v3" });
		expect(model.stage(stale)).toBeNull();
	});

	it("detects read-write skew between two proposals", () => {
		const model = publisher();
		const a = model.propose("a", ["back"], { front: "v2" });
		const b = model.propose("b", ["front"], { back: "v2" });
		expect(model.publish(model.stage(a)!, passingReceipt(model.stage(a)!))).toBe("accepted");
		expect(model.stage(b)).toBeNull();
	});

	it("treats the absence of a key as a real dependency", () => {
		const model = publisher();
		const a = model.propose("a", ["config-new"], { front: "v2" });
		apply(model, "b", [], { "config-new": "exists" });
		expect(model.stage(a)).toBeNull();
	});

	it("rejects an ABA change that restored the original value", () => {
		const model = publisher();
		const a = model.propose("a", ["back"], { front: "v2" });
		apply(model, "b", [], { back: "v2" });
		apply(model, "c", [], { back: "v1" });
		expect(model.stage(a)).toBeNull();
	});

	it("lets an unrelated change restage rather than fail", () => {
		const model = publisher();
		const a = model.propose("a", ["front"], { front: "v2" });
		apply(model, "b", [], { back: "v2" });
		expect(model.stage(a)).not.toBeNull();
	});

	it("serializes concurrent publications on the parent revision", () => {
		const model = publisher();
		const a = model.stage(model.propose("a", [], { front: "v2" }))!;
		const b = model.stage(model.propose("b", [], { back: "v2" }))!;
		expect(model.publish(a, passingReceipt(a))).toBe("accepted");
		expect(model.publish(b, passingReceipt(b))).toBe("stale");
	});

	it("requires a receipt for the recomposed candidate, not the earlier one", () => {
		const model = publisher();
		const proposal = model.propose("a", [], { front: "v2" });
		const old = model.stage(proposal)!;
		apply(model, "b", [], { back: "v2" });
		const recomposed = model.stage(proposal)!;
		expect(model.publish(recomposed, passingReceipt(old))).toBe("invalid-binding");
	});

	it("rejects a receipt bound to a different contract, check set or environment", () => {
		for (const field of ["contractDigest", "checkDigest", "environmentDigest"] as const) {
			const model = publisher();
			const staged = model.stage(model.propose("a", [], { front: "v2" }))!;
			const receipt = { ...passingReceipt(staged), [field]: "wrong" };
			expect(model.publish(staged, receipt), field).toBe("invalid-binding");
		}
	});

	it("refuses a failed verdict or an unsettled effect", () => {
		const failing = publisher();
		const s1 = failing.stage(failing.propose("a", [], { front: "v2" }))!;
		expect(failing.publish(s1, { ...passingReceipt(s1), verdict: "fail" })).toBe("unverified");

		const pending = publisher();
		const s2 = pending.stage(pending.propose("a", [], { front: "v2" }))!;
		expect(pending.publish(s2, { ...passingReceipt(s2), pendingEffects: 1 })).toBe("unverified");
	});

	it("is idempotent for a replayed publication", () => {
		const model = publisher();
		const staged = model.stage(model.propose("a", [], { front: "v2" }))!;
		const receipt = passingReceipt(staged);
		expect(model.publish(staged, receipt)).toBe("accepted");
		expect(model.publish(staged, receipt)).toBe("already-accepted");
		expect(model.revision).toBe(1);
	});

	it("distinguishes a replay from a reused proposal id", () => {
		const model = publisher();
		apply(model, "a", [], { front: "v2" });
		const staged = model.stage(model.propose("a", [], { back: "v2" }))!;
		expect(model.publish(staged, passingReceipt(staged))).toBe("id-collision");
	});

	it("never applies part of a rejected multi-key change", () => {
		const model = publisher();
		const before = model.snapshot();
		const staged = model.stage(model.propose("a", [], { front: "v2", back: "v2" }))!;
		model.publish(staged, { ...passingReceipt(staged), verdict: "fail" });
		expect(model.snapshot()).toEqual(before);
	});

	it("applies a deletion as a versioned change", () => {
		const model = publisher();
		expect(apply(model, "a", [], { back: null })).toBe("accepted");
		expect(model.snapshot().back).toBeUndefined();
	});
});

describe("change awareness", () => {
	it("invalidates transitively", () => {
		const deps = { client: ["contract"], ui: ["client"], test: ["ui"], style: [] };
		expect(invalidate(deps, ["contract"])).toEqual(new Set(["contract", "client", "ui", "test"]));
	});

	it("terminates on a dependency cycle", () => {
		expect(invalidate({ a: ["b"], b: ["a"] }, ["a"])).toEqual(new Set(["a", "b"]));
	});

	it("treats an unmapped dependent as affected rather than safe", () => {
		expect(invalidate({}, ["contract"], ["unmapped"]).has("unmapped")).toBe(true);
	});

	it("does not invalidate an unrelated node", () => {
		expect(invalidate({ style: [] }, ["contract"]).has("style")).toBe(false);
	});

	it("lets an independent follower pass a blocked leader", () => {
		const waiting = [
			{ requestId: "old", claims: [claim("a")] },
			{ requestId: "new-independent", claims: [claim("b")] },
			{ requestId: "new-conflict", claims: [claim("a")] },
		];
		expect(admissibleFrontier(waiting, [claim("a")])).toEqual(["new-independent"]);
	});

	it("does not let a later reader starve an older writer", () => {
		const waiting = [
			{ requestId: "writer", claims: [claim("a")] },
			{ requestId: "reader", claims: [claim("a", "read")] },
		];
		expect(admissibleFrontier(waiting, [claim("a", "read")])).toEqual([]);
	});
});
