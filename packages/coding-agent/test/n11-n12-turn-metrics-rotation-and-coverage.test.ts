import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderStatsReport } from "../src/commands/stats-cli.ts";
import {
	buildTurnMetricRecord,
	summarizeTurnMetrics,
	type TurnMetricInput,
	TurnMetricsSink,
} from "../src/core/turn-metrics.ts";
import { TurnReliabilityCollector } from "../src/core/turn-metrics-reliability.ts";

function makeTurn(overrides: Partial<TurnMetricInput> = {}): TurnMetricInput {
	return {
		sessionId: "sess-n11-n12",
		turnIndex: 0,
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		startedAtEpochMs: 1_000,
		endedAtEpochMs: 2_000,
		usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, costUsd: 0.01 },
		stopReason: "stop",
		toolCalls: [],
		...overrides,
	};
}

describe("N11: TurnMetricsSink enforces maxBytes when rotation rename fails", () => {
	let dir: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "omk-n11-rotate-"));
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("drops the incoming metric, increments failure counters, and keeps file within maxBytes on rename error", () => {
		const maxBytes = 1024;
		const sink = new TurnMetricsSink({ dir, maxBytes });

		// Fill turns.jsonl close to 1024 bytes.
		// Fill turns.jsonl close to 1024 bytes without triggering rotation yet.
		for (let i = 0; i < 2; i++) {
			expect(sink.record(makeTurn({ turnIndex: i }))).toBe(true);
		}
		expect(fs.statSync(sink.path).size).toBeGreaterThan(500);
		// Block renameSync(turns.jsonl, turns.jsonl.1) with a real non-empty directory at turns.jsonl.1.
		const blockingDir = `${sink.path}.1`;
		fs.mkdirSync(blockingDir, { recursive: true });
		fs.writeFileSync(path.join(blockingDir, "keep"), "x");

		// Writing another turn that requires rotation must NOT exceed maxBytes and must NOT throw.
		const sizeBeforeFail = fs.statSync(sink.path).size;
		const ok = sink.record(makeTurn({ turnIndex: 99, sessionId: `sess-${"a".repeat(220)}` }));
		expect(ok).toBe(false);
		expect(sink.rotationFailureCount).toBe(1);
		expect(sink.droppedCount).toBe(1);
		expect(fs.statSync(sink.path).size).toBe(sizeBeforeFail);
		expect(fs.statSync(sink.path).size).toBeLessThanOrEqual(maxBytes);
	});
});

describe("N12: compaction and failover telemetry wiring and unmeasured/coverage distinction", () => {
	it("marks uncollected historical turns as unknown instead of reporting 0 compactions and 0 failovers", () => {
		const rawLines = [
			JSON.stringify(buildTurnMetricRecord(makeTurn({ turnIndex: 0 }))),
			JSON.stringify(buildTurnMetricRecord(makeTurn({ turnIndex: 1 }))),
		];
		const summary = summarizeTurnMetrics(rawLines);
		expect(summary.compactionCoverage).toEqual({ turnsMeasured: 0, turnsUnknown: 2, turnsTotal: 2 });
		expect(summary.failoverCoverage).toEqual({ turnsMeasured: 0, turnsUnknown: 2, turnsTotal: 2 });

		const report = renderStatsReport(summary, "/tmp/turns.jsonl").join("\n");
		expect(report).toContain("compactions unknown (0/2 measured)");
		expect(report).toContain("failovers unknown (0/2 measured)");
	});

	it("shows partial coverage when legacy unmeasured turns mix with newly measured turns", () => {
		const rawLines = [
			JSON.stringify(buildTurnMetricRecord(makeTurn({ turnIndex: 0 }))),
			JSON.stringify(buildTurnMetricRecord(makeTurn({ turnIndex: 1, compacted: true, failovers: 2 }))),
		];
		const summary = summarizeTurnMetrics(rawLines);
		expect(summary.compactions).toBe(1);
		expect(summary.failovers).toBe(2);
		expect(summary.compactionCoverage).toEqual({ turnsMeasured: 1, turnsUnknown: 1, turnsTotal: 2 });
		expect(summary.failoverCoverage).toEqual({ turnsMeasured: 1, turnsUnknown: 1, turnsTotal: 2 });

		const report = renderStatsReport(summary, "/tmp/turns.jsonl").join("\n");
		expect(report).toContain("compactions 1 (1/2 measured)");
		expect(report).toContain("failovers 2 (1/2 measured)");
	});

	it("shows plain measured counts when all turns explicitly report compaction and failover values", () => {
		const rawLines = [
			JSON.stringify(buildTurnMetricRecord(makeTurn({ turnIndex: 0, compacted: false, failovers: 0 }))),
			JSON.stringify(buildTurnMetricRecord(makeTurn({ turnIndex: 1, compacted: false, failovers: 0 }))),
		];
		const summary = summarizeTurnMetrics(rawLines);
		expect(summary.compactionCoverage).toEqual({ turnsMeasured: 2, turnsUnknown: 0, turnsTotal: 2 });
		expect(summary.failoverCoverage).toEqual({ turnsMeasured: 2, turnsUnknown: 0, turnsTotal: 2 });

		const report = renderStatsReport(summary, "/tmp/turns.jsonl").join("\n");
		expect(report).toContain("compactions 0 · failovers 0");
		expect(report).not.toContain("unknown");
	});

	it("TurnReliabilityCollector captures real compaction and failover success events and resets on consume", () => {
		const collector = new TurnReliabilityCollector();
		expect(collector.consume()).toEqual({ compacted: false, failovers: 0 });

		collector.noteCompaction();
		collector.noteFailover();
		collector.noteFailover();
		expect(collector.consume()).toEqual({ compacted: true, failovers: 2 });
		expect(collector.consume()).toEqual({ compacted: false, failovers: 0 });
	});
});
