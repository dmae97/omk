import { describe, expect, it } from "vitest";
import {
	type AgentContext,
	aggregateGateResults,
	type CommandGate,
	type CommandReceipt,
	checkReviewerExecutorIndependence,
	type EvidencePolicy,
	evaluateCommandGate,
	evaluateOutputMatchers,
	type OutputMatcher,
	type RequirementLink,
	type VerificationGateResult,
	verifyTraceability,
} from "../../src/core/orchestration/verification-contract.ts";

function gate(id: string, pass: boolean): VerificationGateResult {
	return { id, kind: "command", pass };
}

describe("evaluateOutputMatchers", () => {
	it("passes includes when substring present in stdout", () => {
		const m: OutputMatcher = { source: "stdout", predicate: "includes", value: "ok" };
		const r = evaluateOutputMatchers({ stdout: "all ok", stderr: "" }, [m]);
		expect(r.pass).toBe(true);
		expect(r.failures).toEqual([]);
	});

	it("fails includes when substring absent", () => {
		const m: OutputMatcher = { source: "stdout", predicate: "includes", value: "ok" };
		const r = evaluateOutputMatchers({ stdout: "nope", stderr: "" }, [m]);
		expect(r.pass).toBe(false);
		expect(r.failures.length).toBe(1);
	});

	it("selects the stderr stream", () => {
		const m: OutputMatcher = { source: "stderr", predicate: "includes", value: "warn" };
		expect(evaluateOutputMatchers({ stdout: "clean", stderr: "a warn" }, [m]).pass).toBe(true);
		expect(evaluateOutputMatchers({ stdout: "a warn", stderr: "clean" }, [m]).pass).toBe(false);
	});

	it("selects the combined stream and defaults combined to stdout+stderr", () => {
		const m: OutputMatcher = { source: "combined", predicate: "includes", value: "merged" };
		expect(evaluateOutputMatchers({ stdout: "out ", stderr: "merged" }, [m]).pass).toBe(true);
		expect(evaluateOutputMatchers({ stdout: "merged", stderr: "err" }, [m]).pass).toBe(true);
		expect(evaluateOutputMatchers({ stdout: "a", stderr: "b" }, [m]).pass).toBe(false);
	});

	it("passes regex on match", () => {
		const m: OutputMatcher = { source: "stdout", predicate: "regex", value: "^ok$" };
		expect(evaluateOutputMatchers({ stdout: "ok", stderr: "" }, [m]).pass).toBe(true);
	});

	it("fails regex on no match", () => {
		const m: OutputMatcher = { source: "stdout", predicate: "regex", value: "^ok$" };
		expect(evaluateOutputMatchers({ stdout: "ok\nextra", stderr: "" }, [m]).pass).toBe(false);
	});

	it("treats an invalid regex as a failure", () => {
		const m: OutputMatcher = { source: "stdout", predicate: "regex", value: "[" };
		const r = evaluateOutputMatchers({ stdout: "anything", stderr: "" }, [m]);
		expect(r.pass).toBe(false);
		expect(r.failures.length).toBe(1);
	});

	it("passes not-includes when substring absent", () => {
		const m: OutputMatcher = { source: "stdout", predicate: "not-includes", value: "fail" };
		expect(evaluateOutputMatchers({ stdout: "all good", stderr: "" }, [m]).pass).toBe(true);
	});

	it("fails not-includes when substring present", () => {
		const m: OutputMatcher = { source: "stdout", predicate: "not-includes", value: "fail" };
		expect(evaluateOutputMatchers({ stdout: "we fail here", stderr: "" }, [m]).pass).toBe(false);
	});

	it("passes when there are no matchers", () => {
		expect(evaluateOutputMatchers({ stdout: "x", stderr: "y" }, []).pass).toBe(true);
	});
});

describe("evaluateCommandGate", () => {
	function receipt(over: Partial<CommandReceipt> = {}): CommandReceipt {
		return { exitCode: 0, stdout: "ok", stderr: "", ...over };
	}

	it("passes with exact exit code", () => {
		const g: CommandGate = { id: "g1", cmd: "true", expectedExitCode: 0, timeoutMs: 1000 };
		expect(evaluateCommandGate(g, receipt({ exitCode: 0 })).pass).toBe(true);
	});

	it("fails when exit code mismatches exact", () => {
		const g: CommandGate = { id: "g1", cmd: "true", expectedExitCode: 0, timeoutMs: 1000 };
		expect(evaluateCommandGate(g, receipt({ exitCode: 2 })).pass).toBe(false);
	});

	it("passes when exit code falls inside range", () => {
		const g: CommandGate = { id: "g1", cmd: "x", expectedExitCode: { min: 1, max: 3 }, timeoutMs: 1000 };
		expect(evaluateCommandGate(g, receipt({ exitCode: 2 })).pass).toBe(true);
		expect(evaluateCommandGate(g, receipt({ exitCode: 1 })).pass).toBe(true);
		expect(evaluateCommandGate(g, receipt({ exitCode: 3 })).pass).toBe(true);
	});

	it("fails when exit code falls outside range", () => {
		const g: CommandGate = { id: "g1", cmd: "x", expectedExitCode: { min: 1, max: 3 }, timeoutMs: 1000 };
		expect(evaluateCommandGate(g, receipt({ exitCode: 0 })).pass).toBe(false);
		expect(evaluateCommandGate(g, receipt({ exitCode: 4 })).pass).toBe(false);
	});

	it("skips the exit-code constraint when expectedExitCode is undefined", () => {
		const g: CommandGate = { id: "g1", cmd: "x", timeoutMs: 1000 };
		expect(evaluateCommandGate(g, receipt({ exitCode: 137 })).pass).toBe(true);
	});

	it("passes when exit code and matchers both satisfy", () => {
		const g: CommandGate = {
			id: "g1",
			cmd: "x",
			expectedExitCode: 0,
			matchers: [
				{ source: "stdout", predicate: "includes", value: "ok" },
				{ source: "stderr", predicate: "not-includes", value: "error" },
			],
			timeoutMs: 1000,
		};
		expect(evaluateCommandGate(g, receipt({ exitCode: 0, stdout: "build ok", stderr: "" })).pass).toBe(true);
	});

	it("fails when a matcher fails even if exit code matches", () => {
		const g: CommandGate = {
			id: "g1",
			cmd: "x",
			expectedExitCode: 0,
			matchers: [{ source: "stdout", predicate: "regex", value: "^ok$" }],
			timeoutMs: 1000,
		};
		const r = evaluateCommandGate(g, receipt({ exitCode: 0, stdout: "not ok" }));
		expect(r.pass).toBe(false);
		expect(r.matcherFailures?.length).toBe(1);
	});
});

describe("aggregateGateResults", () => {
	const all: EvidencePolicy = { mode: "all" };

	it("all policy passes when every gate passes", () => {
		expect(aggregateGateResults([gate("a", true), gate("b", true)], all).pass).toBe(true);
	});

	it("all policy fails when any gate fails", () => {
		expect(aggregateGateResults([gate("a", true), gate("b", false)], all).pass).toBe(false);
	});

	it("all policy fails when there are no gates (no evidence)", () => {
		expect(aggregateGateResults([], all).pass).toBe(false);
	});

	it("quorum policy passes when requiredPasses is met", () => {
		const policy: EvidencePolicy = { mode: "quorum", requiredPasses: 2 };
		const r = aggregateGateResults([gate("a", true), gate("b", true), gate("c", false)], policy);
		expect(r.pass).toBe(true);
		expect(r.passedCount).toBe(2);
	});

	it("quorum policy fails when below requiredPasses", () => {
		const policy: EvidencePolicy = { mode: "quorum", requiredPasses: 2 };
		expect(aggregateGateResults([gate("a", true), gate("b", false), gate("c", false)], policy).pass).toBe(false);
	});
});

describe("verifyTraceability", () => {
	it("passes when every requirement maps to a passed gate", () => {
		const links: RequirementLink[] = [
			{ requirementId: "R1", gateIds: ["g1"] },
			{ requirementId: "R2", gateIds: ["g2", "g3"] },
		];
		expect(verifyTraceability(["R1", "R2"], links, ["g1", "g2"]).pass).toBe(true);
	});

	it("fails when a requirement maps only to gates that did not pass", () => {
		const links: RequirementLink[] = [{ requirementId: "R1", gateIds: ["g1"] }];
		const r = verifyTraceability(["R1"], links, ["g2"]);
		expect(r.pass).toBe(false);
		expect(r.failures.length).toBe(1);
	});

	it("fails on a traceability gap: requirement with no link", () => {
		const links: RequirementLink[] = [{ requirementId: "R1", gateIds: ["g1"] }];
		const r = verifyTraceability(["R1", "R2"], links, ["g1"]);
		expect(r.pass).toBe(false);
		expect(r.failures.some((f) => f.includes("R2"))).toBe(true);
	});

	it("respects minPassingGates greater than 1", () => {
		const links: RequirementLink[] = [{ requirementId: "R1", gateIds: ["g1", "g2"], minPassingGates: 2 }];
		expect(verifyTraceability(["R1"], links, ["g1"]).pass).toBe(false);
		expect(verifyTraceability(["R1"], links, ["g1", "g2"]).pass).toBe(true);
	});
});

describe("checkReviewerExecutorIndependence", () => {
	const executor: AgentContext = { modelId: "claude-sonnet-4.5", contextId: "ctx-exec" };

	it("fails when same model and same context without freshContext", () => {
		const reviewer: AgentContext = { modelId: "claude-sonnet-4.5", contextId: "ctx-exec" };
		expect(checkReviewerExecutorIndependence(executor, reviewer)).toBe(false);
	});

	it("fails when same model and same context even if freshContext is true", () => {
		const reviewer: AgentContext = { modelId: "claude-sonnet-4.5", contextId: "ctx-exec", freshContext: true };
		expect(checkReviewerExecutorIndependence(executor, reviewer)).toBe(false);
	});

	it("passes when modelId differs", () => {
		const reviewer: AgentContext = { modelId: "deepseek-v4-pro", contextId: "ctx-exec" };
		expect(checkReviewerExecutorIndependence(executor, reviewer)).toBe(true);
	});

	it("passes when contextId differs and reviewer.freshContext is true", () => {
		const reviewer: AgentContext = {
			modelId: "claude-sonnet-4.5",
			contextId: "ctx-review-fresh",
			freshContext: true,
		};
		expect(checkReviewerExecutorIndependence(executor, reviewer)).toBe(true);
	});

	it("fails when contextId differs but freshContext is false", () => {
		const reviewer: AgentContext = { modelId: "claude-sonnet-4.5", contextId: "ctx-other", freshContext: false };
		expect(checkReviewerExecutorIndependence(executor, reviewer)).toBe(false);
	});
});
