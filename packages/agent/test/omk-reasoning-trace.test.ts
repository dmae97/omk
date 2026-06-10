import { describe, expect, test } from "vitest";
import {
	createOmkReasoningTrace,
	generateOmkConsentReport,
	redactOmkText,
	redactOmkTrace,
	summarizeOmkTrace,
} from "../src/omk-reasoning-trace.ts";

function makeTrace() {
	return createOmkReasoningTrace({
		turnId: "turn-1",
		userRequest: "fix /home/yu/project with password=secret",
		intent: "code_edit",
		risk: "write",
		confidence: 0.8,
		planSummary: "Patch config for user@example.com",
		planSteps: ["inspect", "patch", "test"],
		toolsSelected: ["read", "edit", "bash"],
		mcpSelected: ["filesystem"],
		connectedMcp: ["filesystem"],
		disconnectedMcp: ["memory"],
		skillsSelected: ["omk-quality-gate"],
		hooksSelected: ["pre-shell-guard"],
		toolSequence: [
			{ name: "bash", args: "echo password=secret", resultSummary: "passed", success: true, durationMs: 100 },
		],
		decisionRecords: [{ point: "route", chosen: "workspace", alternatives: ["read-only"], reason: "write risk" }],
		durationMs: 90_000,
		testResult: { passed: 3, failed: 0, skipped: 1, duration: "1s", failures: [] },
		diffSummary: "updated /home/yu/project/file.ts",
		filesChanged: ["file.ts"],
		commandsRun: ["npm run check"],
		status: "success",
		resultSummary: "done for user@example.com",
		acceptReject: "accept",
		resultConfidence: 0.9,
		privacyLevel: "l1",
		consentGiven: true,
	});
}

describe("OMK reasoning trace", () => {
	test("creates structured evidence trace without raw chain of thought", () => {
		const trace = makeTrace();

		expect(trace.id).toBeTruthy();
		expect(trace.plan.steps).toEqual(["inspect", "patch", "test"]);
		expect(trace.plan.connectedMcp).toEqual(["filesystem"]);
		expect(trace.plan.disconnectedMcp).toEqual(["memory"]);
		expect(trace.plan.hooksSelected).toEqual(["pre-shell-guard"]);
		expect(trace.execution.toolSequence[0].name).toBe("bash");
		expect(trace.evidence.commandsRun).toEqual(["npm run check"]);
	});

	test("redacts secrets and user paths", () => {
		const redacted = redactOmkTrace(makeTrace());

		expect(redacted.userIntent.raw).toContain("/home/[USER]");
		expect(redacted.userIntent.raw).toContain("[PASSWORD_REDACTED]");
		expect(redacted.result.summary).toContain("[EMAIL_REDACTED]");
		expect(redactOmkText("hello", "l0").text).toBe("[REDACTED_L0]");
	});

	test("summarizes trace for user-facing evidence", () => {
		const summary = summarizeOmkTrace(makeTrace());

		expect(summary.intent).toBe("code_edit");
		expect(summary.toolsUsed).toEqual(["bash"]);
		expect(summary.testResult).toBe("3/3 passed");
		expect(summary.duration).toBe("2m 30s");
	});

	test("generates consent-aware report", () => {
		const report = generateOmkConsentReport({
			trace: makeTrace(),
			consentLevel: "l1",
			language: "ko",
			includeFiles: false,
			includeCommands: true,
		});

		expect(report.report).toContain("작업 추론 요약");
		expect(report.redactedFields).toEqual(["filesChanged"]);
		expect(report.eligibleForDataset).toBe(true);
	});
});
