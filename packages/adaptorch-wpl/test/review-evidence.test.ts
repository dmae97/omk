import { describe, expect, it } from "vitest";
import { buildReviewRequest, type ReviewEvidenceInput, reviewSha256 } from "../src/review-evidence.ts";
import { reviewFixture } from "./review-fixtures.ts";

describe("explicit review request (synthetic fixtures)", () => {
	it("puts real evidence in two independent descriptions, not ignored prompt or metadata keys", () => {
		const input = reviewFixture();
		const result = buildReviewRequest(input);
		expect(result.payload.subtasks).toHaveLength(2);
		expect(result.payload.dependencies).toEqual([]);
		for (const task of result.payload.subtasks) {
			expect(task.description).toContain(input.specification[0].text);
			expect(task.description).toContain("npm test -- bounds");
			expect(task.description).toContain("2 tests passed");
			expect(task.description).toContain("FINAL: PASS or FINAL: FAIL");
			expect(task.description).toContain("opinion only");
			expect(task).not.toHaveProperty("prompt");
		}
		expect(result.wallMode).toBe("soft");
		expect(JSON.stringify(result.payload)).not.toContain("wall_mode");
		expect(result.payload).not.toHaveProperty("metadata");
		expect(result.specSha256).toBe(reviewSha256(JSON.stringify(input.specification)));
	});
	it("does not mutate caller evidence and produces a stable request digest", () => {
		const input = reviewFixture();
		const snapshot = structuredClone(input);
		expect(buildReviewRequest(input).requestSha256).toBe(buildReviewRequest(input).requestSha256);
		expect(input).toEqual(snapshot);
	});
	it("records byte-accurate Unicode-safe truncation and original/content hashes", () => {
		const result = buildReviewRequest({ ...reviewFixture(), diff: "한글".repeat(10_000) });
		const entry = result.manifest.find((m) => m.id === "diff")!;
		expect(entry.originalBytes).toBe(60_000);
		expect(entry.includedBytes + entry.omittedBytes).toBe(entry.originalBytes);
		expect(entry.includedBytes).toBeLessThanOrEqual(12_288);
		expect(result.payload.subtasks[0].description).not.toContain("\ufffd");
		expect(entry.sha256).not.toBe(entry.includedSha256);
	});
	it.each([0, 1, 5, NaN, 2.5])("rejects invalid candidate count %s", (candidateCount) => {
		expect(() => buildReviewRequest({ ...reviewFixture(), candidateCount })).toThrow("2..4");
	});
	it("retains explicit not-run evidence without asserting pass", () => {
		const result = buildReviewRequest({
			...reviewFixture(),
			tests: [
				{
					id: "planned",
					specItemIds: ["bounds"],
					command: "npm test",
					execution: "not_run",
					exitCode: null,
					output: "",
				},
			],
		});
		expect(result.payload.subtasks[0].description).toContain("not_run");
	});
	it("rejects fake execution results and missing spec bindings", () => {
		const input = reviewFixture();
		for (const patch of [
			{ execution: "not_run" },
			{ executedAt: undefined },
			{ exitCode: null },
			{ specItemIds: ["unknown"] },
		]) {
			expect(() =>
				buildReviewRequest({ ...input, tests: [{ ...input.tests[0], ...patch }] } as ReviewEvidenceInput),
			).toThrow();
		}
	});
	it("requires explicit disclosure approval and nonempty spec/diff", () => {
		for (const patch of [{ disclosureApproved: false }, { specification: [] }, { diff: "" }]) {
			expect(() => buildReviewRequest({ ...reviewFixture(), ...patch } as ReviewEvidenceInput)).toThrow();
		}
	});
	it.each([
		"password=hunter2",
		"Authorization: Bearer fake-private-value",
		"api_key=do-not-send",
		"BEGIN PRIVATE KEY",
	])("blocks secret-like evidence before transport: %s", (text) => {
		expect(() => buildReviewRequest({ ...reviewFixture(), diff: text })).toThrow("secrets");
	});
	it("does not count renamed or timestamp-only evidence as changed content", () => {
		const input = reviewFixture();
		const first = buildReviewRequest(input);
		const next = buildReviewRequest({
			...input,
			tests: [{ ...input.tests[0], id: "renamed", executedAt: "2026-10-04T01:00:00Z" }],
		});
		expect(next.manifest.at(-1)!.includedSha256).toBe(first.manifest.at(-1)!.includedSha256);
	});
});

it("rejects token-shaped secrets in outbound identifiers, not just prose", () => {
	const secret = `sk-${"a".repeat(30)}`;
	for (const patch of [{ packetId: secret }, { specRevision: secret }]) {
		expect(() => buildReviewRequest({ ...reviewFixture(), ...patch })).toThrow("secrets");
	}
});

it("scans transmitted timestamp metadata for embedded secret-like text", () => {
	const input = reviewFixture();
	expect(() =>
		buildReviewRequest({
			...input,
			tests: [
				{
					...input.tests[0],
					executedAt: "Sun Oct 04 2026 00:00:00 GMT+0000 (sk-proj-SYNTHETIC00000000000000000000)",
				},
			],
		}),
	).toThrow("secrets");
});
