import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildTurnMetricRecord,
	summarizeTurnMetrics,
	type TurnMetricInput,
	TurnMetricsSink,
} from "../src/core/turn-metrics.ts";

function metric(): TurnMetricInput {
	return {
		sessionId: "fixture",
		turnIndex: 0,
		startedAtEpochMs: 100,
		endedAtEpochMs: 200,
		usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, costUsd: 0.01 },
		toolCalls: [{ name: "bash", durationMs: 10, ok: false, error: "exit 1" }],
	};
}

describe("review F10/F11: metrics write boundary", () => {
	it.each(["password=fixture-private", "private.user@example.invalid", "/private/customer/file.txt"])(
		"never writes raw failure text: %s",
		(privateText) => {
			const record = buildTurnMetricRecord({
				...metric(),
				toolCalls: [{ name: "read", durationMs: 1, ok: false, error: privateText }],
			});
			expect(JSON.stringify(record)).not.toContain(privateText);
			expect(record.toolCalls?.[0]).not.toHaveProperty("error");
		},
	);
	it("projects known fields rather than spreading caller-owned nested payloads", () => {
		const input = Object.assign(metric(), {
			prompt: "root-private",
			toJSON: () => ({ secret: "serializer-private" }),
			usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, costUsd: 0.01, content: "usage-private" },
			contextCache: { planHit: true, hits: 1, misses: 0, query: "cache-private" },
		});
		const serialized = JSON.stringify(buildTurnMetricRecord(input));
		for (const text of ["root-private", "serializer-private", "usage-private", "cache-private"])
			expect(serialized).not.toContain(text);
	});
	it("records only error classes in the real JSONL sink", () => {
		const dir = mkdtempSync(join(tmpdir(), "omk-metric-boundary-"));
		try {
			const sink = new TurnMetricsSink({ dir });
			expect(
				sink.record({
					...metric(),
					toolCalls: [
						{ name: "bash", durationMs: 1, ok: false, error: "command timed out: password=fixture-private" },
					],
				}),
			).toBe(true);
			const bytes = readFileSync(sink.path, "utf8");
			expect(bytes).not.toContain("fixture-private");
			expect(JSON.parse(bytes).toolCalls[0].errorClass).toBe("timeout");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
	it("drops a record larger than the configured file bound", () => {
		const dir = mkdtempSync(join(tmpdir(), "omk-metric-size-"));
		try {
			const sink = new TurnMetricsSink({ dir, maxBytes: 1024 });
			const toolCalls = Array.from({ length: 100 }, () => ({ name: "bash", durationMs: 1, ok: true }));
			expect(sink.record({ ...metric(), toolCalls })).toBe(false);
			expect(sink.droppedCount).toBe(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
	it("drops invalid numeric input without making the agent fail", () => {
		const dir = mkdtempSync(join(tmpdir(), "omk-metric-invalid-"));
		try {
			const sink = new TurnMetricsSink({ dir });
			expect(sink.record({ ...metric(), endedAtEpochMs: Number.NaN })).toBe(false);
			expect(sink.droppedCount).toBe(1);
			expect(sink.writtenCount).toBe(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("review F11: persisted metric validation", () => {
	it.each([
		{ sessionId: undefined },
		{ turnIndex: -1 },
		{ durationMs: null },
		{ startedAtEpochMs: "100" },
		{ usage: { input: "secret", output: 2, cacheRead: 0, cacheWrite: 0, costUsd: 0.01 } },
		{ usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, costUsd: -1 } },
		{ toolCalls: "not-an-array" },
		{ toolCalls: [{ name: "read", ok: "false", durationMs: 1 }] },
		{ toolCalls: [{ name: "read", ok: false, durationMs: -1 }] },
		{ contextCache: { planHit: "yes", hits: 1, misses: 0 } },
		{ failovers: -2 },
		{ toolCallCount: 999 },
	])("counts malformed record %# instead of accepting or throwing", (patch) => {
		const line = JSON.stringify({ ...buildTurnMetricRecord(metric()), ...patch });
		const summary = summarizeTurnMetrics([line]);
		expect(summary.turns).toBe(0);
		expect(summary.malformedLines).toBe(1);
		expect(summary.totalCostUsd).toBe(0);
	});
	it("continues to aggregate valid v1 records without exposing legacy error text", () => {
		const line = JSON.stringify({
			...metric(),
			schemaVersion: "omk-turn-metrics-1",
			durationMs: 100,
			toolCallCount: 1,
			toolFailureCount: 1,
		});
		const summary = summarizeTurnMetrics([line]);
		expect(summary.turns).toBe(1);
		expect(summary.tools[0]).toMatchObject({ name: "bash", failures: 1 });
		expect(JSON.stringify(summary)).not.toContain("exit 1");
	});
});
