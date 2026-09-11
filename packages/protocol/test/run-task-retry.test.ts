import { describe, expect, it } from "vitest";
import { parseRunTaskRetryCommand } from "../src/index.ts";

const request = () => ({
	schemaVersion: "omk.verified-command.v1",
	kind: "retry_tasks",
	runId: "dag",
	commandId: "retry",
	expectedRevision: 10,
	expectedGeneration: 1,
	contractDigest: "a".repeat(64),
	baseDigest: "b".repeat(64),
	taskIds: ["right"],
});

describe("task retry intent", () => {
	it("snapshots the exact selection and supports explicit pending-only continuation", () => {
		const raw = request();
		const parsed = parseRunTaskRetryCommand(raw);
		raw.taskIds.push("left");
		expect(parsed.taskIds).toEqual(["right"]);
		expect(Object.isFrozen(parsed.taskIds)).toBe(true);
		expect(parseRunTaskRetryCommand({ ...request(), taskIds: [] }).taskIds).toEqual([]);
	});
	it.each([0, -1, 0.5, Infinity, NaN])("rejects invalid generation %s", (expectedGeneration) => {
		expect(() => parseRunTaskRetryCommand({ ...request(), expectedGeneration })).toThrow();
	});
	it.each(
		[null, "right", ["../right"], ["right", "right"], Array.from({ length: 17 }, (_, i) => `task${i}`)].map(
			(taskIds) => ({ taskIds }),
		),
	)("rejects invalid task selection %#", ({ taskIds }) => {
		expect(() => parseRunTaskRetryCommand({ ...request(), taskIds })).toThrow();
	});
	it("rejects changed action, missing input binding and injected approval", () => {
		expect(() => parseRunTaskRetryCommand({ ...request(), kind: "resume" })).toThrow();
		expect(() => parseRunTaskRetryCommand({ ...request(), baseDigest: "" })).toThrow();
		expect(() => parseRunTaskRetryCommand({ ...request(), approved: true })).toThrow();
	});
});
