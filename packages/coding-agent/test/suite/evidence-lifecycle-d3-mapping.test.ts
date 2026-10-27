/**
 * Spec 118 D3 (observe only): producer -> consumer mapping for read-spill, tool-bash log and executor
 * `fullOutputPath`; `presentBytesByProducer` only with the flag on; `bash-spill` stays unmapped;
 * executor output is always pinned `user-visible` (excludeFromContext included). Nothing is deleted.
 */
import { existsSync, rmSync } from "node:fs";
import { basename, dirname } from "node:path";
import { fauxAssistantMessage } from "omk-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeBashWithOperations } from "../../src/core/bash-executor.ts";
import {
	listEvidenceArtifacts,
	registerEvidenceArtifact,
	resetEvidenceLifecycleForTest,
	SPILL_CONSUMERS,
	TOOL_OUTPUT_LOG_CONSUMERS,
} from "../../src/core/evidence-lifecycle.ts";
import { deleteEvidenceArtifact } from "../../src/core/evidence-lifecycle-delete.ts";
import { evidenceLifecycleReport } from "../../src/core/evidence-lifecycle-report.ts";
import { withEvidenceSession } from "../../src/core/evidence-lifecycle-scope.ts";
import { EVIDENCE_LIFECYCLE_ENTRY_TYPE } from "../../src/core/evidence-lifecycle-session.ts";
import { spillTruncatedOutput } from "../../src/core/tools/artifact-spill.ts";
import type { BashOperations } from "../../src/core/tools/bash.ts";
import { OutputAccumulator } from "../../src/core/tools/output-accumulator.ts";
import { DEFAULT_MAX_BYTES } from "../../src/core/tools/truncate.ts";
import { createHarness, type Harness } from "./harness.ts";

const RAW = "RAW-d3-map-5e1c";
const cleanup: string[] = [];
const harnesses: Harness[] = [];

beforeEach(() => {
	resetEvidenceLifecycleForTest();
	vi.stubEnv("OMK_EVIDENCE_LIFECYCLE", "0"); // default is observe; flag-off cases opt out explicitly
	vi.stubEnv("OMK_BASH_SANDBOX", "off");
});
afterEach(() => {
	while (harnesses.length > 0) harnesses.pop()?.cleanup();
	for (const p of cleanup.splice(0)) rmSync(p, { recursive: true, force: true });
	vi.unstubAllEnvs();
	resetEvidenceLifecycleForTest();
});

function spill(kind: "read" | "bash"): string {
	const { path } = spillTruncatedOutput({
		kind,
		preview: "p",
		full: `${RAW}\n`.repeat(8),
		truncated: true,
		path: "/x",
	});
	cleanup.push(dirname(path));
	return path;
}

async function toolLog(): Promise<string> {
	const acc = new OutputAccumulator({ maxBytes: 16 });
	acc.append(Buffer.from(`${RAW}\n`.repeat(4)));
	acc.finish();
	const snap = acc.snapshot({ persistIfTruncated: true });
	await acc.closeTempFile();
	if (!snap.fullOutputPath) throw new Error("no log");
	cleanup.push(snap.fullOutputPath);
	return snap.fullOutputPath;
}

const bigOps: BashOperations = {
	exec: async (_c, _cwd, { onData }) => {
		onData(Buffer.from(`${RAW}\n`.repeat(Math.ceil((DEFAULT_MAX_BYTES * 2) / RAW.length))));
		return { exitCode: 0 };
	},
};

async function executorLog(): Promise<string> {
	const result = await executeBashWithOperations("x", "/", bigOps);
	if (!result.fullOutputPath) throw new Error("no executor log");
	cleanup.push(result.fullOutputPath);
	return result.fullOutputPath;
}

describe("spec 118 D3 decision 1: mapping (observe only)", () => {
	beforeEach(() => vi.stubEnv("OMK_EVIDENCE_LIFECYCLE", "observe"));

	it("read-spill and tool-bash log carry required consumers, no unknown hold, nothing would delete", async () => {
		spill("read");
		await toolLog();
		const records = listEvidenceArtifacts();
		expect(records.map((r) => [r.producer, r.requiredConsumers, r.holds])).toEqual([
			["read-spill", [...SPILL_CONSUMERS], ["awaiting-consumer"]],
			["tool-output-log", [...TOOL_OUTPUT_LOG_CONSUMERS], ["awaiting-consumer"]],
		]);
		const report = evidenceLifecycleReport();
		expect(report.unknownHoldShare).toBe(0);
		expect(report.wouldDelete.count).toBe(0);
		expect(report.deletes).toBe(0);
	});

	it("files stay on disk in observe and in delete mode (D2 deleter ignores D3 producers)", async () => {
		const paths = [spill("read"), await toolLog(), await executorLog()];
		vi.stubEnv("OMK_EVIDENCE_LIFECYCLE", "delete");
		for (const r of listEvidenceArtifacts()) expect(deleteEvidenceArtifact(r.artifactId).deleted).toBe(false);
		for (const p of paths) expect(existsSync(p)).toBe(true);
	});
});

describe("spec 118 D3 decision 2: presentBytesByProducer", () => {
	it("flag on: per-producer present bytes sum to presentBytes", async () => {
		vi.stubEnv("OMK_EVIDENCE_LIFECYCLE", "observe");
		spill("read");
		await toolLog();
		await executorLog();
		const report = evidenceLifecycleReport();
		const by = report.presentBytesByProducer;
		expect(Object.keys(by).sort()).toEqual(["bash-executor-log", "read-spill", "tool-output-log"]);
		expect(Object.values(by).reduce((a, b) => a + (b ?? 0), 0)).toBe(report.presentBytes);
		expect(JSON.stringify(report)).not.toContain(RAW);
	});

	it("no double counting: every path under one producer, registered once, per-path bytes sum to the totals", async () => {
		vi.stubEnv("OMK_EVIDENCE_LIFECYCLE", "observe");
		spill("read");
		await toolLog();
		await executorLog();
		await executorLog();
		const records = listEvidenceArtifacts();
		expect(records).toHaveLength(4);
		const producersOf = new Map<string, Set<string>>();
		for (const r of records)
			producersOf.set(r.pathSha256, (producersOf.get(r.pathSha256) ?? new Set()).add(r.producer));
		expect([...producersOf.values()].filter((set) => set.size > 1)).toEqual([]);
		expect(producersOf.size).toBe(records.length);
		expect(records.map((r) => r.artifactId)).toEqual(["ev-1", "ev-2", "ev-3", "ev-4"]);
		const report = evidenceLifecycleReport();
		const sums: Record<string, number> = {};
		for (const r of records) sums[r.producer] = (sums[r.producer] ?? 0) + r.bytes;
		expect(sums).toEqual(report.presentBytesByProducer);
		expect(records.reduce((a, r) => a + r.bytes, 0)).toBe(report.presentBytes);
	});

	it("flag off: nothing is registered and no evidence_lifecycle entry (so no field) is written", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		withEvidenceSession(harness.sessionManager.getSessionId(), () => spill("read"));
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("hi");
		expect(listEvidenceArtifacts(harness.sessionManager.getSessionId())).toEqual([]);
		const serialized = JSON.stringify(harness.sessionManager.getEntries());
		expect(serialized).not.toContain(EVIDENCE_LIFECYCLE_ENTRY_TYPE);
		expect(serialized).not.toContain("presentBytesByProducer");
	});

	it("flag observe: the session entry carries presentBytesByProducer", async () => {
		vi.stubEnv("OMK_EVIDENCE_LIFECYCLE", "observe");
		const harness = await createHarness();
		harnesses.push(harness);
		withEvidenceSession(harness.sessionManager.getSessionId(), () => spill("read"));
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("hi");
		const entry = harness.sessionManager
			.getEntries()
			.find((e) => e.type === "custom" && e.customType === EVIDENCE_LIFECYCLE_ENTRY_TYPE) as
			| { data: { report: { presentBytesByProducer: Record<string, number> } } }
			| undefined;
		expect(entry?.data.report.presentBytesByProducer["read-spill"]).toBeGreaterThan(0);
	});
});

describe("spec 118 D3 decision 3: bash-spill excluded", () => {
	it("stays unmapped (unknown hold) and its code path is unchanged", () => {
		vi.stubEnv("OMK_EVIDENCE_LIFECYCLE", "observe");
		const path = spill("bash");
		const [record] = listEvidenceArtifacts();
		expect(record.producer).toBe("bash-spill");
		expect(record.requiredConsumers).toBeUndefined();
		expect(record.holds).toEqual(["unknown"]);
		expect(existsSync(path)).toBe(true);
	});
});

describe("spec 118 D3 decision 4: executor pinned user-visible", () => {
	beforeEach(() => vi.stubEnv("OMK_EVIDENCE_LIFECYCLE", "observe"));

	it("direct executor (unknown caller) fails closed to user-visible", async () => {
		await executorLog();
		const [record] = listEvidenceArtifacts();
		expect(record).toMatchObject({ producer: "bash-executor-log", userVisible: true, holds: ["user-visible"] });
		expect(record.requiredConsumers).toEqual([]);
	});

	it("aborted executor output is pinned too", async () => {
		const controller = new AbortController();
		const ops: BashOperations = {
			exec: async (_c, _cwd, { onData }) => {
				onData(Buffer.from(`${RAW}\n`.repeat(Math.ceil((DEFAULT_MAX_BYTES * 2) / RAW.length))));
				controller.abort();
				throw new Error("aborted");
			},
		};
		const result = await executeBashWithOperations("x", "/", ops, { signal: controller.signal });
		if (result.fullOutputPath) cleanup.push(result.fullOutputPath);
		expect(result.cancelled).toBe(true);
		expect(listEvidenceArtifacts().map((r) => r.holds)).toEqual([["user-visible"]]);
	});

	it("the pin comes from the executor helper, not the registry: each executor log is pinned", async () => {
		const path = await executorLog();
		// A bare registry call without the pin is not pinned; only the executor helper adds it.
		registerEvidenceArtifact({ producer: "bash-executor-log", path, requiredConsumers: [] });
		expect(listEvidenceArtifacts().at(-1)?.holds).toEqual([]);
		await executorLog();
		expect(listEvidenceArtifacts().at(-1)?.holds).toEqual(["user-visible"]);
	});

	it("session executeBash with excludeFromContext is still user-visible", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const result = await withEvidenceSession(harness.sessionManager.getSessionId(), () =>
			harness.session.executeBash(`yes ${RAW} | head -c ${DEFAULT_MAX_BYTES * 2}`, undefined, {
				excludeFromContext: true,
			}),
		);
		if (result.fullOutputPath) cleanup.push(result.fullOutputPath);
		expect(result.truncated).toBe(true);
		const records = listEvidenceArtifacts(harness.sessionManager.getSessionId());
		expect(records.map((r) => [r.producer, r.holds])).toEqual([["bash-executor-log", ["user-visible"]]]);
	});
});

describe("default config (OMK_EVIDENCE_LIFECYCLE unset = delete): executor log is never deleted", () => {
	beforeEach(() => vi.stubEnv("OMK_EVIDENCE_LIFECYCLE", undefined));

	it("omk-bash-*.log stays pinned user-visible and survives a direct delete", async () => {
		const path = await executorLog();
		expect(basename(path)).toMatch(/^omk-bash-[0-9a-f]+\.log$/);
		const [record] = listEvidenceArtifacts();
		expect(record).toMatchObject({ producer: "bash-executor-log", userVisible: true, holds: ["user-visible"] });
		expect(deleteEvidenceArtifact(record.artifactId)).toMatchObject({ deleted: false });
		expect(existsSync(path)).toBe(true);
		expect(listEvidenceArtifacts()[0]).toMatchObject({ status: "present", holds: ["user-visible"] });
		expect(evidenceLifecycleReport().deletes).toBe(0);
	});
});
