import { describe, expect, it } from "vitest";
import {
	BoundedDigestAccumulator,
	boundConversationTextForSummary,
	buildBoundedDigest,
	DEFAULT_SESSION_DIGEST_MAX_CHARS,
} from "../src/core/session-digest.ts";

describe("bounded session digest", () => {
	it("returns the legacy joined text when input is under budget", () => {
		const result = buildBoundedDigest(["alpha", "beta", "gamma"], { maxChars: 100 });

		expect(result.text).toBe("alpha beta gamma");
		expect(result.truncated).toBe(false);
		expect(result.keptChars).toBe("alpha beta gamma".length);
	});

	it("does not reserve marker space until input exceeds the hard ceiling", () => {
		const text = "A".repeat(80);
		const result = buildBoundedDigest([text], { maxChars: 100 });

		expect(result.text).toBe(text);
		expect(result.truncated).toBe(false);
	});

	it("never exceeds the configured max chars", () => {
		const result = buildBoundedDigest(["HEADTOKEN", "x".repeat(200), "TAILTOKEN"], { maxChars: 80 });

		expect(result.text.length).toBeLessThanOrEqual(80);
		expect(result.truncated).toBe(true);
		expect(result.originalChars).toBeGreaterThan(result.keptChars);
	});

	it("keeps head and recent tail signal across truncation", () => {
		const result = buildBoundedDigest(["HEADTOKEN", "middle-".repeat(60), "TAILTOKEN"], { maxChars: 120 });

		expect(result.text).toContain("HEADTOKEN");
		expect(result.text).toContain("TAILTOKEN");
		expect(result.text).toContain("omk-digest:truncated");
	});

	it("is deterministic for the same input", () => {
		const segments = ["one", "two", "three".repeat(100), "four"];

		expect(buildBoundedDigest(segments, { maxChars: 90 }).text).toBe(
			buildBoundedDigest(segments, { maxChars: 90 }).text,
		);
	});

	it("streams with bounded output via the accumulator", () => {
		const accumulator = new BoundedDigestAccumulator({ maxChars: 1000 });
		for (let i = 0; i < 100_000; i++) {
			accumulator.push(`segment-${i}`);
		}

		const result = accumulator.result();
		expect(result.text.length).toBeLessThanOrEqual(1000);
		expect(result.truncated).toBe(true);
		expect(result.originalChars).toBeGreaterThan(DEFAULT_SESSION_DIGEST_MAX_CHARS);
	});

	it("matches the pure helper when fed the same segments", () => {
		const segments = ["a", "b".repeat(100), "c".repeat(100)];
		const accumulator = new BoundedDigestAccumulator({ maxChars: 70 });
		for (const segment of segments) accumulator.push(segment);

		expect(accumulator.result().text).toBe(buildBoundedDigest(segments, { maxChars: 70 }).text);
	});

	it("supports tail-only retention with headRatio zero", () => {
		const result = buildBoundedDigest(["HEAD", "middle".repeat(20), "TAIL"], {
			maxChars: 60,
			headRatio: 0,
		});

		expect(result.text).not.toContain("HEAD");
		expect(result.text).toContain("TAIL");
	});

	it("retains source content when the marker is larger than the max chars", () => {
		const result = buildBoundedDigest(["HEAD", "middle".repeat(20), "TAIL"], {
			maxChars: 12,
			marker: "<marker-too-long-for-budget>",
		});

		expect(result.text.length).toBeLessThanOrEqual(12);
		expect(result.truncated).toBe(true);
		expect(result.text).toContain("HEAD");
		expect(result.text).toContain("TAIL");
		expect(result.text).not.toContain("marker-too-long");
	});

	it("prefers source characters over partial markers for tiny budgets", () => {
		const result = buildBoundedDigest(["abcdef", "uvwxyz"], { maxChars: 2, marker: "[truncated]" });

		expect(result.text.length).toBeLessThanOrEqual(2);
		expect(result.text).not.toBe("[t");
	});

	it("leaves summary text unchanged below the raw ceiling", () => {
		const text = "short serialized conversation";

		expect(boundConversationTextForSummary(text, 1000)).toBe(text);
	});

	it("clamps summary text above the raw ceiling", () => {
		const text = `HEAD-${"x".repeat(400)}-TAIL`;
		const result = boundConversationTextForSummary(text, 100);

		expect(result.length).toBeLessThanOrEqual(100);
		expect(result).toContain("HEAD");
		expect(result).toContain("TAIL");
		expect(result).toContain("omk-digest:truncated");
	});
});
