import type { AgentMessage } from "omk-agent-core";
import { beforeEach, describe, expect, it } from "vitest";
import { findCutPoint } from "../src/core/compaction/index.ts";
import type { SessionEntry } from "../src/core/session-manager.ts";

/**
 * `findCutPoint` walks backwards until the kept tail exceeds its budget, then
 * cuts at the closest valid cut point at or after that entry. Tool results are
 * never valid cut points, so when the entry that blew the budget is one, no
 * candidate qualifies — and the search used to leave `cutIndex` at its default
 * of the OLDEST cut point, keeping the whole history.
 *
 * That is the common shape of a coding-agent overflow: the newest entry is one
 * huge tool output. Compaction then reduced nothing, and overflow recovery
 * spent both of its attempts re-sending an unchanged context before giving up.
 */

let counter = 0;
let lastId: string | null = null;

beforeEach(() => {
	counter = 0;
	lastId = null;
});

function entry(message: AgentMessage): SessionEntry {
	const id = `entry-${counter++}`;
	const created = {
		type: "message",
		id,
		parentId: lastId,
		timestamp: new Date().toISOString(),
		message,
	} as SessionEntry;
	lastId = id;
	return created;
}

const user = (text: string) => entry({ role: "user", content: text, timestamp: Date.now() } as AgentMessage);

const assistant = (text: string) =>
	entry({
		role: "assistant",
		content: [{ type: "text", text }],
		usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
		stopReason: "toolUse",
		timestamp: Date.now(),
		api: "anthropic-messages",
		provider: "anthropic",
		model: "test-model",
	} as unknown as AgentMessage);

const toolResult = (text: string) =>
	entry({
		role: "toolResult",
		content: [{ type: "text", text }],
		toolCallId: "call-1",
		toolName: "bash",
		isError: false,
		timestamp: Date.now(),
	} as unknown as AgentMessage);

/** Six completed exchanges, then a fresh request whose tool output is enormous. */
function sessionEndingInHugeToolResult(): SessionEntry[] {
	const entries: SessionEntry[] = [];
	for (let i = 0; i < 6; i++) {
		entries.push(user(`request ${i} ${"x".repeat(400)}`));
		entries.push(assistant(`reply ${i}`));
	}
	entries.push(user("latest request"));
	entries.push(assistant("calling the tool"));
	entries.push(toolResult("R".repeat(400_000)));
	return entries;
}

describe("findCutPoint with an oversized trailing tool result", () => {
	it("discards history instead of keeping all of it", () => {
		const entries = sessionEndingInHugeToolResult();

		const result = findCutPoint(entries, 0, entries.length, 20_000);

		expect(result.firstKeptEntryIndex).toBeGreaterThan(0);
		// The whole point: compaction has to make progress.
		expect(entries.length - result.firstKeptEntryIndex).toBeLessThan(entries.length);
	});

	it("keeps the call and its result together as one turn", () => {
		const entries = sessionEndingInHugeToolResult();

		const result = findCutPoint(entries, 0, entries.length, 20_000);

		// Cutting at the assistant that issued the call keeps its tool result,
		// which is the smallest tail that still makes sense.
		const kept = entries.slice(result.firstKeptEntryIndex);
		expect(kept).toHaveLength(2);
		const roles = kept.map((item) => (item.type === "message" ? item.message.role : item.type));
		expect(roles).toEqual(["assistant", "toolResult"]);
		// Cutting mid-turn means the turn prefix gets summarized rather than dropped.
		expect(result.isSplitTurn).toBe(true);
	});

	it("still prefers a cut point at or after the offending entry when one exists", () => {
		// An oversized assistant message IS a valid cut point, so the fallback
		// must not fire and the tail is just that message.
		const entries: SessionEntry[] = [];
		for (let i = 0; i < 6; i++) {
			entries.push(user(`request ${i} ${"x".repeat(400)}`));
			entries.push(assistant(`reply ${i}`));
		}
		entries.push(assistant("A".repeat(400_000)));

		const result = findCutPoint(entries, 0, entries.length, 20_000);

		expect(result.firstKeptEntryIndex).toBe(entries.length - 1);
	});

	it("keeps everything when the session fits the budget", () => {
		const entries = [user("hello"), assistant("hi"), toolResult("small output")];

		const result = findCutPoint(entries, 0, entries.length, 100_000);

		expect(result.firstKeptEntryIndex).toBe(0);
	});

	it("never returns a cut point outside the requested range", () => {
		const entries = sessionEndingInHugeToolResult();

		for (const budget of [1, 100, 20_000, 500_000]) {
			const result = findCutPoint(entries, 0, entries.length, budget);
			expect(result.firstKeptEntryIndex).toBeGreaterThanOrEqual(0);
			expect(result.firstKeptEntryIndex).toBeLessThan(entries.length);
		}
	});
});
