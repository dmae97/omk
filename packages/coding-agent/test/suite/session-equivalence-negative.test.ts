/**
 * Negative controls (spec agent-session-split §5): prove on every CI run that the
 * equivalence harness really compares requests, event payloads, event order, raw
 * cache-boundary offsets and raw byte sizes.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compareBytes, goldenPath } from "./session-equivalence.ts";
import { SCENARIOS } from "./session-equivalence-scenarios.ts";

type Golden = { requests: unknown[]; events: unknown[]; trace: unknown };

function flipOneByte(text: string, needle: string, from = 0): string {
	const at = text.indexOf(needle, from);
	expect(at).toBeGreaterThanOrEqual(0);
	const i = at + needle.length - 1;
	const ch = text[i] === "a" ? "b" : "a";
	const out = text.slice(0, i) + ch + text.slice(i + 1);
	expect(Buffer.byteLength(out)).toBe(Buffer.byteLength(text));
	return out;
}

/** Bump the first `"<key>": <number>` by one; every other byte (including all text) stays the same. */
function bumpNumber(text: string, key: string): string {
	const match = new RegExp(`"${key}": (\\d+)`).exec(text);
	expect(match).not.toBeNull();
	const [whole, digits] = match as RegExpExecArray;
	return text.replace(whole, `"${key}": ${Number(digits) + 1}`);
}

const pick = (value: unknown) =>
	JSON.stringify(value, null, "\t")
		.split("\n")
		.find((l) => /"[^"]+": "[^<"]+"/.test(l));

const SESSION_SCENARIOS = Object.keys(SCENARIOS).filter((name) => name !== "spec103b-trace");

describe("equivalence harness negative controls", () => {
	for (const name of SESSION_SCENARIOS) {
		const golden = readFileSync(goldenPath(name), "utf8");
		const parsed = JSON.parse(golden) as Golden;

		it(`${name}: a 1-byte change in a recorded request fails the comparison`, () => {
			const line = pick(parsed.requests[parsed.requests.length - 1]);
			expect(line).toBeDefined();
			const mutated = flipOneByte(golden, (line as string).trim().slice(0, -2));
			expect(compareBytes(golden, mutated).equal).toBe(false);
		});

		it(`${name}: a 1-byte change in a session event fails the comparison`, () => {
			const eventsStart = golden.indexOf('\n\t"events"');
			const line = (pick(parsed.events[0]) as string).trim().slice(0, -2);
			const mutated = flipOneByte(golden, line, eventsStart);
			const result = compareBytes(golden, mutated);
			expect(result.equal).toBe(false);
			expect(result.firstDiffByte).toBeGreaterThanOrEqual(eventsStart);
		});

		it(`${name}: swapping the order of two session events fails the comparison`, () => {
			const i = parsed.events.findIndex(
				(e, k) => k > 0 && JSON.stringify(e) !== JSON.stringify(parsed.events[k - 1]),
			);
			expect(i).toBeGreaterThan(0);
			const events = [...parsed.events];
			[events[i - 1], events[i]] = [events[i], events[i - 1]];
			const swapped = `${JSON.stringify({ ...parsed, events }, null, "\t")}\n`;
			expect(compareBytes(golden, swapped).equal).toBe(false);
		});

		it(`${name}: the cache boundary shifted by 1 with identical text fails the comparison`, () => {
			const mutated = bumpNumber(golden, "systemPromptCacheBoundary");
			expect(mutated.replace(/"systemPromptCacheBoundary": \d+/g, "")).toBe(
				golden.replace(/"systemPromptCacheBoundary": \d+/g, ""),
			);
			expect(compareBytes(golden, mutated).equal).toBe(false);
		});
	}

	it("forced-compaction: a 1-unit change in a recorded *Bytes size fails the comparison", () => {
		const golden = readFileSync(goldenPath("forced-compaction"), "utf8");
		const key = /"([A-Za-z]*Bytes)": \d+/.exec(golden)?.[1];
		expect(key).toBeDefined();
		const mutated = bumpNumber(golden, key as string);
		expect(compareBytes(golden, mutated).equal).toBe(false);
	});

	it("spec103b-trace: a 1-byte change in the caps-on trace fails the comparison", () => {
		const golden = readFileSync(goldenPath("spec103b-trace"), "utf8");
		const mutated = flipOneByte(golden, '"capsOn"');
		expect(compareBytes(golden, mutated).equal).toBe(false);
	});
});
