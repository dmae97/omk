/**
 * Spec 106 D1 session sink: a goal-less session gets exactly one `evidence_lifecycle` custom entry per
 * settled prompt when OMK_EVIDENCE_LIFECYCLE=observe; flag off writes none. Never in model context.
 */
import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { fauxAssistantMessage } from "omk-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	evidenceRegistrySessionCount,
	evidenceRegistryStats,
	resetEvidenceLifecycleForTest,
} from "../../src/core/evidence-lifecycle.ts";
import { withEvidenceSession } from "../../src/core/evidence-lifecycle-scope.ts";
import { EVIDENCE_LIFECYCLE_ENTRY_TYPE } from "../../src/core/evidence-lifecycle-session.ts";
import type { SessionManager } from "../../src/core/session-manager.ts";
import { spillTruncatedOutput } from "../../src/core/tools/artifact-spill.ts";
import { createHarness, type Harness } from "./harness.ts";

const SECRET = "SECRET-RAW-d1-session-91c2";
const harnesses: Harness[] = [];
const spills: string[] = [];

beforeEach(() => resetEvidenceLifecycleForTest());
afterEach(() => {
	while (harnesses.length > 0) harnesses.pop()?.cleanup();
	for (const dir of spills.splice(0)) rmSync(dir, { recursive: true, force: true });
	vi.unstubAllEnvs();
	resetEvidenceLifecycleForTest();
});

function entries(sm: SessionManager) {
	return sm.getEntries().filter((e) => e.type === "custom" && e.customType === EVIDENCE_LIFECYCLE_ENTRY_TYPE);
}

/** A spill produced by this session (as the read tool would inside its prompt). */
function spill(harness?: Harness): string {
	if (harness) return withEvidenceSession(harness.sessionManager.getSessionId(), () => spill());
	const { path } = spillTruncatedOutput({ kind: "read", preview: "p", full: SECRET, truncated: true, path: "/x" });
	spills.push(dirname(path));
	return path;
}

describe("spec 106 D1 session sink", () => {
	it("flag off: no evidence_lifecycle entry, even after settle and dispose", async () => {
		vi.stubEnv("OMK_EVIDENCE_LIFECYCLE", "0"); // default is observe; flag-off cases opt out explicitly
		const harness = await createHarness();
		harnesses.push(harness);
		spill();
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("hello");
		harness.session.dispose();
		expect(entries(harness.sessionManager)).toHaveLength(0);
	});

	it("flag observe: a goal-less session gets the entry exactly once per settle, counts only, not in context", async () => {
		vi.stubEnv("OMK_EVIDENCE_LIFECYCLE", "observe");
		const harness = await createHarness();
		harnesses.push(harness);
		const path = spill(harness);
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("hello");
		const written = entries(harness.sessionManager);
		expect(written).toHaveLength(1);
		const data = (written[0] as { data: Record<string, unknown> }).data;
		expect(data).toMatchObject({
			schemaVersion: 1,
			aggregation: "cumulative",
			settleIndex: 0,
			report: {
				mode: "observe",
				deletes: 0,
				present: 1,
				unknownHoldShare: 0,
				unknownHoldShareByProducer: { spill: { present: 1, unknown: 0, share: 0 } },
			},
		});
		const serialized = JSON.stringify(harness.sessionManager.getEntries());
		expect(serialized).not.toContain(SECRET);
		expect(serialized).not.toContain(path);
		expect(JSON.stringify(harness.session.messages)).not.toContain(EVIDENCE_LIFECYCLE_ENTRY_TYPE);
		harness.session.dispose();
		expect(entries(harness.sessionManager)).toHaveLength(1);
	});

	it("flag observe: two prompts give 2 cumulative entries, settleIndex 0 and 1; the last covers both", async () => {
		vi.stubEnv("OMK_EVIDENCE_LIFECYCLE", "observe");
		const harness = await createHarness();
		harnesses.push(harness);
		for (const text of ["a", "b"]) {
			spill(harness);
			harness.setResponses([fauxAssistantMessage("ok")]);
			await harness.session.prompt(text);
		}
		const data = entries(harness.sessionManager).map(
			(e) => (e as { data: { settleIndex: number; aggregation: string; report: Record<string, number> } }).data,
		);
		expect(data.map((d) => [d.settleIndex, d.aggregation])).toEqual([
			[0, "cumulative"],
			[1, "cumulative"],
		]);
		const [first, last] = data;
		expect(first?.report.registered).toBe(1);
		// Analysis reads the last entry per session: it includes the artifacts of both prompts.
		expect(last?.report.registered).toBe(2);
		expect(last?.report.present).toBe(2);
		for (const key of ["registered", "present", "presentBytes"]) {
			expect(last?.report[key] ?? 0).toBeGreaterThanOrEqual(first?.report[key] ?? 0);
		}
	});

	it("two sessions in one process: each entry holds only its own artifacts; dispose drops the key", async () => {
		vi.stubEnv("OMK_EVIDENCE_LIFECYCLE", "observe");
		vi.stubEnv("OMK_BASH_SANDBOX", "off");
		const a = await createHarness();
		const b = await createHarness();
		harnesses.push(a, b);
		// Many short lines: the executor's rolling buffer may drop leading pipe chunks, and what it keeps
		// (>= ~36 KB) must still trip truncateTail. A single 120 KB line could leave < 50 KB and no spill
		// depending on how the pipe chunked it (flaky under load); >2000 kept lines always truncates.
		const big = "seq 1 40000";
		const outputs: string[] = [];
		for (const [harness, runs] of [
			[a, 1],
			[b, 2],
		] as const) {
			for (let i = 0; i < runs; i++) {
				const result = await harness.session.executeBash(big);
				if (result.fullOutputPath) outputs.push(result.fullOutputPath);
			}
			harness.setResponses([fauxAssistantMessage("ok")]);
			await harness.session.prompt("go");
		}
		for (const path of outputs) rmSync(path, { force: true });
		const report = (h: Harness) =>
			(entries(h.sessionManager).at(-1) as { data: { report: Record<string, unknown> } }).data.report;
		expect(report(a)).toMatchObject({ registered: 1, byProducer: { "bash-executor-log": 1 }, unattributed: 0 });
		expect(report(b)).toMatchObject({ registered: 2, byProducer: { "bash-executor-log": 2 }, unattributed: 0 });
		const idA = a.sessionManager.getSessionId();
		const idB = b.sessionManager.getSessionId();
		expect(idA).not.toBe(idB);
		expect(evidenceRegistryStats(idA).registered).toBe(1);
		a.session.dispose();
		expect(evidenceRegistryStats(idA).registered).toBe(0);
		expect(evidenceRegistryStats(idB).registered).toBe(2);
		b.session.dispose();
		expect(evidenceRegistryStats(idB).registered).toBe(0);
		expect(evidenceRegistrySessionCount()).toBe(0);
	});
});
