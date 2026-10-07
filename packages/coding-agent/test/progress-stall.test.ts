import { describe, expect, it } from "vitest";
import {
	detectProgressStall,
	nearDuplicateSignature,
	normalizeBashCommand,
	PROGRESS_STALL_WINDOW,
	type StallRecord,
	signatureSimilarity,
	trimStallRecords,
} from "../src/core/progress-stall.ts";
import {
	isProgressStallSteerSuppressed,
	setProgressStallSteerSuppressed,
} from "../src/core/progress-stall-steer-gate.ts";
import { createEnvRemainingBudgetFraction } from "../src/core/remaining-budget-fraction.ts";

function bash(command: string, extra?: Partial<StallRecord>): StallRecord {
	return { toolName: "bash", args: { command }, ...extra };
}

describe("progress-stall normalizer", () => {
	it("masks numbers, quotes, and deep paths", () => {
		expect(normalizeBashCommand(`python3 -c "print(42)"  /a/b/c/d/e.py`)).toContain("STR");
		expect(normalizeBashCommand(`echo 12 34`)).toBe("echo N N");
		expect(nearDuplicateSignature(bash('python3 -c "x=1"'))).toBe(nearDuplicateSignature(bash('python3 -c "x=99"')));
	});

	it("scores near-duplicate regex trial variants highly", () => {
		const a = nearDuplicateSignature(
			bash(`python3 << 'PY'\nimport json, re\npairs=json.load(open("/app/re.json"))\nfen = "a"\nPY`),
		);
		const b = nearDuplicateSignature(
			bash(`python3 << 'PY'\nimport json, re\npairs=json.load(open("/app/re.json"))\nfen = "b-other"\nPY`),
		);
		expect(signatureSimilarity(a, b)).toBeGreaterThanOrEqual(0.65);
	});
});

describe("detectProgressStall", () => {
	it("still blocks exact identical repeats at 6", () => {
		const records = Array.from({ length: 6 }, () => bash("ls"));
		expect(detectProgressStall(records, { warnAfter: 3, stopAfter: 6 })?.kind).toBe("stop");
		expect(detectProgressStall(records.slice(0, 3), { warnAfter: 3, stopAfter: 6 })?.kind).toBe("warn");
	});

	it("steers on near-duplicate bash without file progress", () => {
		const records: StallRecord[] = [];
		for (let index = 0; index < 14; index += 1) {
			records.push(bash(`python3 -c "print(${index}); import re, json; json.load(open('/app/re.json'))"`));
		}
		const detection = detectProgressStall(records, {
			windowSize: 32,
			similarityThreshold: 0.65,
			similarNeed: 6,
			noProgressAfter: 12,
		});
		expect(detection?.kind).toBe("steer");
		if (detection?.kind === "steer") {
			expect(detection.similarCount).toBeGreaterThanOrEqual(6);
			expect(detection.noProgressCalls).toBe(12);
		}
	});

	it("does not steer a distinct productive edit/write sequence", () => {
		const records: StallRecord[] = [];
		for (let index = 0; index < 20; index += 1) {
			if (index % 3 === 0) {
				records.push({
					toolName: "edit",
					args: { path: `f${index}.ts`, oldText: "a", newText: "b" },
					fileMutated: true,
				});
			} else {
				records.push(bash(`python3 -c "print(${index})"`));
			}
		}
		expect(
			detectProgressStall(records, {
				windowSize: 32,
				similarityThreshold: 0.65,
				similarNeed: 6,
				noProgressAfter: 12,
			}),
		).toBeUndefined();
	});

	it("bounds the ring buffer at W after many pushes", () => {
		const records: StallRecord[] = [];
		for (let index = 0; index < 10_000; index += 1) {
			records.push(bash(`echo ${index}`));
			trimStallRecords(records, PROGRESS_STALL_WINDOW);
		}
		expect(records.length).toBe(PROGRESS_STALL_WINDOW);
	});
});

describe("progress-stall helpers", () => {
	it("toggles the finish-check steer suppression gate", () => {
		setProgressStallSteerSuppressed(false);
		expect(isProgressStallSteerSuppressed()).toBe(false);
		setProgressStallSteerSuppressed(true);
		expect(isProgressStallSteerSuppressed()).toBe(true);
		setProgressStallSteerSuppressed(false);
	});

	it("reports remaining budget from OMK_TIME_BUDGET_SEC", () => {
		let now = 1_000;
		const remaining = createEnvRemainingBudgetFraction({
			env: { OMK_TIME_BUDGET_SEC: "100" },
			now: () => now,
			startedAt: 1_000,
		});
		expect(remaining()).toBeCloseTo(1);
		now = 1_000 + 80_000;
		expect(remaining()).toBeCloseTo(0.2);
		expect(createEnvRemainingBudgetFraction({ env: {} })()).toBeUndefined();
	});
});
