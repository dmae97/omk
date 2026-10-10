import { describe, expect, it } from "vitest";
import {
	boundedHeadTail,
	boundedTail,
	buildCheckpointTask,
} from "../examples/extensions/subagent/checkpoint-runtime.ts";

const GOAL = "GOAL: migrate the billing module without touching public APIs.";
const DONE = "DONE WHEN: all billing tests pass.";

function longBrief(fillerChars: number): string {
	return `${GOAL}\n${"x".repeat(fillerChars)}\n${DONE}`;
}

describe("subagent checkpoint task briefs", () => {
	it("keeps the goal and the completion criteria of a long shard brief", () => {
		const task = buildCheckpointTask({
			originalTask: longBrief(10_000),
			shardTask: longBrief(10_000),
			shardId: "s1",
			shardIndex: 0,
			shardCount: 1,
			attempt: 1,
			cutoffMs: 60_000,
			checkpointFilePath: "/tmp/cp.json",
		});
		const [, current] = task.split("Current shard:\n");
		expect(current).toContain(GOAL);
		expect(current).toContain(DONE);
		expect(current).toContain("middle chars omitted");
		const [, original] = task.split("Original logical task (context only):\n");
		expect(original.startsWith(GOAL)).toBe(true);
	});

	it("bounds output to roughly the limit and leaves short briefs untouched", () => {
		const bounded = boundedHeadTail(longBrief(10_000), 3_500);
		expect(bounded.length).toBeLessThan(3_500 + 80);
		expect(boundedHeadTail("short", 3_500)).toBe("short");
	});

	it("still keeps only the tail for streamed evidence", () => {
		expect(boundedTail(longBrief(10_000), 100)).not.toContain(GOAL);
	});
});
