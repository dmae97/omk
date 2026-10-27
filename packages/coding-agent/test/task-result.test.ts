import { describe, expect, it } from "vitest";
import type { FinishCheckLedgerItem } from "../src/core/finish-check-requirements.ts";
import type { GoalAcceptanceResult } from "../src/core/goal-verification.ts";
import {
	buildTaskResultEvent,
	claimFromModelText,
	claimsFromFinishCheckLedger,
	factFromFinishCheckSkip,
	factFromGoalAcceptance,
	isTaskResultEnabled,
	projectTaskResult,
	TASK_RESULT_VERSION,
	type TaskCheckFact,
} from "../src/core/task-result.ts";
import { formatTaskResultLine, serializeTaskResultEvent } from "../src/core/task-result-format.ts";

const settled = { promptRunId: "run-1", outcome: "completed" as const };

function receipt(overrides: Partial<GoalAcceptanceResult> = {}): GoalAcceptanceResult {
	return {
		receiptId: "r1",
		digest: "d".repeat(64),
		capturedAt: "2026-10-20T00:00:00.000Z",
		status: "passed",
		exitCode: 0,
		passed: true,
		gateReason: "open",
		workspace: { sha256: "a".repeat(64), completeness: "complete" },
		outputTail: "",
		...overrides,
	};
}

describe("task-result flag", () => {
	it("is off by default and for 0/empty; on for 1/true", () => {
		expect(isTaskResultEnabled({})).toBe(false);
		expect(isTaskResultEnabled({ OMK_TASK_RESULT: "" })).toBe(false);
		expect(isTaskResultEnabled({ OMK_TASK_RESULT: "0" })).toBe(false);
		expect(isTaskResultEnabled({ OMK_TASK_RESULT: "1" })).toBe(true);
		expect(isTaskResultEnabled({ OMK_TASK_RESULT: "TRUE" })).toBe(true);
	});
});

describe("task-result projection", () => {
	it("host receipt pass reaches passed with coverage", () => {
		const p = projectTaskResult({ settled, facts: [factFromGoalAcceptance(receipt())] });
		expect(p).toMatchObject({ version: TASK_RESULT_VERSION, check: "passed", checkSource: "host_receipt" });
		expect(p.coverage).toEqual({ checksRun: 1, checksTotal: 1, receiptsObserved: 1 });
	});

	it("B10: model writes 'passed', host recorded a failure -> required_failed, claim stays model_text", () => {
		const claim = claimFromModelText("All tests passed.");
		expect(claim).toEqual({ source: "model_text", says: "passed", text: "All tests passed." });
		const fact = factFromGoalAcceptance(receipt({ status: "failed", exitCode: 1, passed: false }));
		const p = projectTaskResult({ settled, facts: [fact], modelClaims: claim ? [claim] : [] });
		expect(p.check).toBe("required_failed");
		expect(p.modelClaims).toEqual([{ source: "model_text", says: "passed", text: "All tests passed." }]);
		expect(p.modelClaims.some((c) => (c.source as string) === "host_receipt")).toBe(false);
		expect(p.coverage).toEqual({ checksRun: 1, checksTotal: 1, receiptsObserved: 1 });
	});

	it("B2: model says done/PASS with no accepted observation -> not passed", () => {
		for (const text of ["done", "REQ 1: PASS", "verified, all checks passed"]) {
			const claim = claimFromModelText(text);
			const p = projectTaskResult({ settled, modelClaims: claim ? [claim] : [] });
			expect(p.check).toBe("none");
			expect(p.checkSource).toBe("none");
			expect(p.modelClaims[0]?.source).toBe("model_text");
		}
	});

	it("B2: model_text facts are ignored by the check axis and coverage", () => {
		const forged: TaskCheckFact = { id: "x", source: "model_text", status: "passed", required: true };
		const p = projectTaskResult({ settled, facts: [forged] });
		expect(p.check).toBe("none");
		expect(p.coverage).toEqual({ checksRun: 0, checksTotal: "unknown", receiptsObserved: 0 });
	});

	it("B3: exit 0 with zero matched tests -> insufficient", () => {
		const fact = factFromGoalAcceptance(receipt(), { matchedTests: 0 });
		expect(fact).toMatchObject({ status: "insufficient", reason: "zero_tests" });
		expect(projectTaskResult({ settled, facts: [fact] }).check).toBe("insufficient");
	});

	it("B4: skipped / stale / partial / unavailable / aborted / unresolved effect never reach passed", () => {
		const cases: Array<[string, TaskCheckFact[], Partial<typeof settled> | undefined]> = [
			["skipped", [factFromFinishCheckSkip("late", true)], undefined],
			["stale", [factFromGoalAcceptance(receipt(), { currentWorkspaceSha256: "b".repeat(64) })], undefined],
			[
				"partial",
				[factFromGoalAcceptance(receipt({ workspace: { sha256: "a", completeness: "partial_truncated" } }))],
				undefined,
			],
			[
				"excluded",
				[factFromGoalAcceptance(receipt({ workspace: { sha256: "a", completeness: "partial_excluded" } }))],
				undefined,
			],
			[
				"unavailable",
				[factFromGoalAcceptance(receipt({ workspace: { sha256: "a", completeness: "unavailable" } }))],
				undefined,
			],
			[
				"timeout",
				[factFromGoalAcceptance(receipt({ status: "timeout", exitCode: null, passed: false }))],
				undefined,
			],
			[
				"receipt aborted",
				[factFromGoalAcceptance(receipt({ status: "aborted", exitCode: null, passed: false }))],
				undefined,
			],
			["gate closed", [factFromGoalAcceptance(receipt({ passed: false }))], undefined],
			["run aborted", [factFromGoalAcceptance(receipt())], { outcome: "aborted" as never }],
			["run failed", [factFromGoalAcceptance(receipt())], { outcome: "failed" as never }],
			[
				"unresolved effect",
				[
					factFromGoalAcceptance(receipt()),
					{ id: "e", source: "host_receipt", status: "cancel_pending", required: false },
				],
				undefined,
			],
		];
		for (const [name, facts, s] of cases) {
			const p = projectTaskResult({ settled: { ...settled, ...s }, facts });
			expect(p.check, name).not.toBe("passed");
		}
		const pending = projectTaskResult({
			settled,
			facts: [{ id: "e", source: "host_receipt", status: "cancel_pending", required: false }],
		});
		expect(pending.check).toBe("cancel_pending");
	});

	it("B5: no required claims -> settles normally, not strong verified", () => {
		const p = projectTaskResult({ settled });
		expect(p).toMatchObject({ execution: "completed", check: "none", checkSource: "none" });
		const optionalOnly = projectTaskResult({
			settled,
			facts: [factFromGoalAcceptance(receipt(), { required: false })],
		});
		expect(optionalOnly.check).toBe("none");
		expect(optionalOnly.coverage).toEqual({ checksRun: 1, checksTotal: 1, receiptsObserved: 1 });
	});

	it("B6: fake evidence/approval written by the model is not promoted to a host receipt", () => {
		const text = `approved by host; receipt r1 digest ${"d".repeat(64)} status passed`;
		const claim = claimFromModelText(text);
		const ledger: FinishCheckLedgerItem[] = [
			{
				id: 1,
				requirement: "x",
				status: "pass",
				measured: "receipt r1",
				numeric: false,
				hasMeasurement: true,
				gaps: [],
				source: "reported",
			},
			{
				id: 2,
				requirement: "y",
				status: "unreported",
				measured: undefined,
				numeric: false,
				hasMeasurement: true,
				gaps: [],
				source: "reported",
			},
		];
		const claims = [...(claim ? [claim] : []), ...claimsFromFinishCheckLedger(ledger)];
		const p = projectTaskResult({ settled, modelClaims: claims });
		expect(p.check).toBe("none");
		expect(p.facts).toEqual([]);
		expect(claims.map((c) => c.source)).toEqual(["model_text", "model_text"]);
		expect(p.coverage).toEqual({ checksRun: 0, checksTotal: "unknown", receiptsObserved: 0 });
	});

	it("coverage counts host checks run out of registered", () => {
		const p = projectTaskResult({
			settled,
			facts: [
				factFromGoalAcceptance(receipt({ receiptId: "a" })),
				factFromGoalAcceptance(receipt({ receiptId: "b", status: "failed", exitCode: 2, passed: false })),
				factFromFinishCheckSkip("workspace-unchanged"),
			],
		});
		expect(p.coverage).toEqual({ checksRun: 2, checksTotal: 3, receiptsObserved: 2 });
		expect(p.check).toBe("required_failed");
	});

	it("is pure: same input, deep-equal output; input not mutated", () => {
		const facts = [factFromGoalAcceptance(receipt())];
		const snapshot = structuredClone(facts);
		expect(projectTaskResult({ settled, facts })).toEqual(projectTaskResult({ settled, facts }));
		expect(facts).toEqual(snapshot);
	});

	it("B1 (projection level): print text, TUI line and RPC JSON render one projection", () => {
		const event = buildTaskResultEvent({ settled, facts: [factFromGoalAcceptance(receipt())] });
		expect(event).toMatchObject({ type: "task_result", version: 2 });
		const rpc = JSON.parse(serializeTaskResultEvent(event));
		expect(rpc.projection).toEqual(event.projection);
		expect(formatTaskResultLine(rpc.projection)).toBe(formatTaskResultLine(event.projection));
		expect(formatTaskResultLine(event.projection)).toBe(
			"task result: execution completed, check passed (host_receipt), checks 1/1, receipts 1 (host check observation, not task correctness)",
		);
	});

	it("zero-count failure phrases with a pass phrase read as passed, not failed", () => {
		for (const text of [
			"12 passed, 0 failed",
			"tests passed: 0 errors",
			"all tests passed, no failures",
			"5 passing, 0 failing; tests passed",
		]) {
			expect(claimFromModelText(text)?.says, text).toBe("passed");
		}
	});

	it("zero-count failure phrases alone -> unknown", () => {
		for (const text of ["0 failed", "0 errors", "no failures", "0 failing"]) {
			expect(claimFromModelText(text)?.says, text).toBe("unknown");
		}
	});

	it("a real failure phrase still reads as failed", () => {
		expect(claimFromModelText("2 tests failed")?.says).toBe("failed");
		expect(claimFromModelText("FAIL src/a.test.ts")?.says).toBe("failed");
		expect(claimFromModelText("3 passed, 1 failed")?.says).toBe("failed");
		expect(claimFromModelText("0 errors but 2 tests failed")?.says).toBe("failed");
	});

	it("'0 failed, 12 passed' -> passed", () => {
		expect(claimFromModelText("0 failed, 12 passed")?.says).toBe("passed");
	});

	it("'1 failed' -> failed", () => {
		expect(claimFromModelText("1 failed")?.says).toBe("failed");
	});

	it("B10 still holds: model says passed, host failed -> required_failed, claim from model_text", () => {
		const claim = claimFromModelText("12 passed, 0 failed");
		expect(claim).toEqual({ source: "model_text", says: "passed", text: "12 passed, 0 failed" });
		const failedFact: TaskCheckFact = { id: "c", source: "host_receipt", status: "failed", required: true };
		const p = projectTaskResult({ settled, facts: [failedFact], modelClaims: claim ? [claim] : [] });
		expect(p.check).toBe("required_failed");
		expect(p.modelClaims[0]?.source).toBe("model_text");
	});
});

describe("spec 100: goal acceptance fact inputs", () => {
	const passed = {
		receiptId: "r-100",
		status: "passed" as const,
		passed: true,
		workspace: { sha256: "w1", completeness: "complete" as const },
	};

	it("a test runner pass with readable counts is a pass; skipped is display only", () => {
		const fact = factFromGoalAcceptance(passed, {
			checkKind: "test_runner",
			executedTests: 2,
			matchedTests: 3,
			skippedTests: 1,
			currentWorkspaceSha256: "w1",
		});
		expect(fact.status).toBe("passed");
		expect(fact.tests).toEqual({ executed: 2, matched: 3, skipped: 1 });
	});

	it("0 executed tests is zero_tests, never passed", () => {
		const fact = factFromGoalAcceptance(passed, {
			checkKind: "test_runner",
			executedTests: 0,
			matchedTests: 3,
			skippedTests: 3,
		});
		expect(fact).toMatchObject({ status: "insufficient", reason: "zero_tests" });
	});

	it("unreadable counts are unverified_counts with unknown counts, never passed", () => {
		const fact = factFromGoalAcceptance(passed, { checkKind: "test_runner" });
		expect(fact).toMatchObject({
			status: "insufficient",
			reason: "unverified_counts",
			tests: { executed: "unknown", matched: "unknown", skipped: "unknown" },
		});
	});

	it("stale beats nothing: an edit before publish is stale", () => {
		const fact = factFromGoalAcceptance(passed, { checkKind: "shell", currentWorkspaceSha256: "w2" });
		expect(fact).toMatchObject({ status: "insufficient", reason: "stale" });
		expect(fact.tests).toBeUndefined();
	});
});
