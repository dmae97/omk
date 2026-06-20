import { describe, expect, it } from "vitest";
import {
	type ArtifactReferenceResolver,
	computeEventHash,
	type ReplayLedgerEventInput,
	stableStringify,
	verifyArtifactReference,
	verifyReplayLedger,
} from "../../src/core/orchestration/replay-ledger.ts";

function event(input: ReplayLedgerEventInput): ReplayLedgerEventInput & { eventHash: string } {
	return { ...input, eventHash: computeEventHash(input) };
}

describe("stableStringify", () => {
	it("serializes object keys in stable lexical order", () => {
		expect(stableStringify({ b: 2, a: 1, nested: { z: true, c: null } })).toBe(
			'{"a":1,"b":2,"nested":{"c":null,"z":true}}',
		);
	});

	it("preserves array order", () => {
		expect(stableStringify(["b", "a", { d: 4, c: 3 }])).toBe('["b","a",{"c":3,"d":4}]');
	});

	it("rejects non-finite numbers", () => {
		expect(() => stableStringify(Number.NaN)).toThrow("non-finite");
		expect(() => stableStringify(Number.POSITIVE_INFINITY)).toThrow("non-finite");
	});
});

describe("verifyReplayLedger", () => {
	it("passes a well-formed hash chain", () => {
		const first = event({
			sequence: 1,
			type: "scheduler.node.leased",
			reducerVersion: 1,
			payload: { nodeId: "n1" },
			beforeStateHash: "GENESIS",
			afterStateHash: "S1",
			prevEventHash: null,
		});
		const second = event({
			sequence: 2,
			type: "scheduler.node.running",
			reducerVersion: 1,
			payload: { nodeId: "n1" },
			beforeStateHash: "S1",
			afterStateHash: "S2",
			prevEventHash: first.eventHash,
		});

		expect(verifyReplayLedger([first, second])).toEqual({ ok: true });
	});

	it("fails when payload is tampered without recomputing eventHash", () => {
		const original = event({
			sequence: 1,
			type: "scheduler.node.leased",
			reducerVersion: 1,
			payload: { nodeId: "n1" },
			beforeStateHash: "GENESIS",
			afterStateHash: "S1",
			prevEventHash: null,
		});
		const tampered = { ...original, payload: { nodeId: "n2" } };

		expect(verifyReplayLedger([tampered]).ok).toBe(false);
		expect(verifyReplayLedger([tampered]).error).toContain("eventHash");
	});

	it("fails when prevEventHash linkage is broken", () => {
		const first = event({
			sequence: 1,
			type: "a",
			reducerVersion: 1,
			payload: {},
			beforeStateHash: "GENESIS",
			afterStateHash: "S1",
			prevEventHash: null,
		});
		const second = event({
			sequence: 2,
			type: "b",
			reducerVersion: 1,
			payload: {},
			beforeStateHash: "S1",
			afterStateHash: "S2",
			prevEventHash: "wrong",
		});

		expect(verifyReplayLedger([first, second]).error).toContain("prevEventHash");
	});

	it("fails when beforeStateHash does not match previous afterStateHash", () => {
		const first = event({
			sequence: 1,
			type: "a",
			reducerVersion: 1,
			payload: {},
			beforeStateHash: "GENESIS",
			afterStateHash: "S1",
			prevEventHash: null,
		});
		const second = event({
			sequence: 2,
			type: "b",
			reducerVersion: 1,
			payload: {},
			beforeStateHash: "not-S1",
			afterStateHash: "S2",
			prevEventHash: first.eventHash,
		});

		expect(verifyReplayLedger([first, second]).error).toContain("beforeStateHash");
	});
});

describe("verifyArtifactReference", () => {
	const resolver: ArtifactReferenceResolver = (path) => {
		if (path === "inside") return { realPath: "/repo/.omk/runs/r1/artifact.txt", isFile: true, sha256: "good" };
		if (path === "outside") return { realPath: "/tmp/escape.txt", isFile: true, sha256: "good" };
		if (path === "bad-hash") return { realPath: "/repo/.omk/runs/r1/bad.txt", isFile: true, sha256: "bad" };
		return undefined;
	};

	it("passes contained artifacts with matching hash", () => {
		expect(verifyArtifactReference({ path: "inside", repoRoot: "/repo", sha256: "good" }, resolver)).toEqual({
			ok: true,
		});
	});

	it("rejects artifacts that resolve outside the repo root", () => {
		expect(verifyArtifactReference({ path: "outside", repoRoot: "/repo", sha256: "good" }, resolver).error).toContain(
			"outside",
		);
	});

	it("rejects hash mismatches", () => {
		expect(
			verifyArtifactReference({ path: "bad-hash", repoRoot: "/repo", sha256: "good" }, resolver).error,
		).toContain("sha256");
	});
});
