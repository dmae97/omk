import { describe, expect, it } from "vitest";
import { AdaptOrchClient, type AdaptOrchTransport } from "../src/adaptorch-client.ts";
import { adjudicate } from "../src/adjudicator.ts";
import { createVerifierRegistry } from "../src/adjudicator-registry.ts";
import { projectVerdictToDisposition, runAdjudicationWithTimeout } from "../src/loop.ts";
import type { WorkPacket } from "../src/types.ts";

/** A scriptable fake transport: maps `adaptorch_get_run`/`_get_artifacts`/`_get_traces` calls by run_id. */
function makeFakeTransport(
	byRunId: Record<string, { run: unknown; artifacts: unknown; traces: unknown }>,
): AdaptOrchTransport {
	return {
		async callTool(name: string, args: Record<string, unknown>) {
			const runId = args.run_id as string;
			const fixture = byRunId[runId];
			if (!fixture) throw new Error(`no fixture for run_id ${runId}`);
			if (name === "adaptorch_get_run") return fixture.run;
			if (name === "adaptorch_get_artifacts") return fixture.artifacts;
			if (name === "adaptorch_get_traces") return fixture.traces;
			throw new Error(`unexpected tool call: ${name}`);
		},
	};
}

function makePacket(overrides: Partial<WorkPacket> = {}): WorkPacket {
	return {
		packet_id: "pkt-1",
		kind: "code-edit",
		created_at: "2026-01-01T00:00:00.000Z",
		payload: {},
		topology_decision: null,
		dispatch_records: [],
		state: "UNDER_REVIEW",
		retry_count: 0,
		transition_log: [],
		last_adjudication_ref: null,
		attempt_budget: { max_dispatch_attempts: 3, dispatch_attempts_used: 1 },
		last_human_approved_payload: {},
		...overrides,
	};
}

const registry = createVerifierRegistry([]); // everything falls back to DEFAULT

describe("adjudicate — single run_id", () => {
	it("produces CONFIRMED for a clean success with substantive artifacts and no error spans", async () => {
		const client = new AdaptOrchClient(
			makeFakeTransport({
				"run-1": {
					run: { run_id: "run-1", status: "completed" },
					artifacts: [{ path: "out.md", size_bytes: 42 }],
					traces: [{ kind: "write", level: "info" }],
				},
			}),
		);
		const result = await adjudicate(
			{ dispatch_record_id: "d1", kind: "code-edit", run_ids: ["run-1"] },
			client,
			registry,
		);
		expect(result.verdict).toBe("CONFIRMED");
		expect(result.per_run).toHaveLength(1);
	});

	it("produces INDETERMINATE (not CONFIRMED) for an empty-artifact 'success' — never trusts absence of evidence", async () => {
		const client = new AdaptOrchClient(
			makeFakeTransport({
				"run-2": {
					run: { run_id: "run-2", status: "completed" },
					artifacts: [],
					traces: [{ kind: "write", level: "info" }],
				},
			}),
		);
		const result = await adjudicate(
			{ dispatch_record_id: "d2", kind: "code-edit", run_ids: ["run-2"] },
			client,
			registry,
		);
		expect(result.verdict).toBe("INDETERMINATE");
		expect(result.per_run[0].reason).toContain("artifacts-empty-unexpected");
	});

	it("produces CORROBORATED-FAILURE for a reported failure with no contradicting evidence", async () => {
		const client = new AdaptOrchClient(
			makeFakeTransport({
				"run-3": {
					run: { run_id: "run-3", status: "failed" },
					artifacts: [{ path: "partial.md", size_bytes: 1 }],
					traces: [{ kind: "write", level: "error" }],
				},
			}),
		);
		const result = await adjudicate(
			{ dispatch_record_id: "d3", kind: "code-edit", run_ids: ["run-3"] },
			client,
			registry,
		);
		expect(result.verdict).toBe("CORROBORATED-FAILURE");
	});

	it("produces CONTRADICTED when status says success but a trace shows an error span", async () => {
		const client = new AdaptOrchClient(
			makeFakeTransport({
				"run-4": {
					run: { run_id: "run-4", status: "completed" },
					artifacts: [{ path: "out.md", size_bytes: 10 }],
					traces: [{ kind: "tool_call", level: "error" }],
				},
			}),
		);
		const result = await adjudicate(
			{ dispatch_record_id: "d4", kind: "code-edit", run_ids: ["run-4"] },
			client,
			registry,
		);
		expect(result.verdict).toBe("CONTRADICTED");
		expect(result.per_run[0].reason).toContain("error-span-scan");
	});

	it("produces VERIFIER-ERROR (not CORROBORATED-FAILURE/CONTRADICTED) when the fetch itself throws", async () => {
		const client = new AdaptOrchClient({
			async callTool() {
				throw new Error("transport exploded");
			},
		});
		const result = await adjudicate(
			{ dispatch_record_id: "d5", kind: "code-edit", run_ids: ["run-5"] },
			client,
			registry,
		);
		expect(result.verdict).toBe("VERIFIER-ERROR");
	});

	it("rejects a malformed request (empty run_ids) as VERIFIER-ERROR without calling the client", async () => {
		const client = new AdaptOrchClient({
			async callTool() {
				throw new Error("should not be called");
			},
		});
		const result = await adjudicate({ dispatch_record_id: "d6", kind: "code-edit", run_ids: [] }, client, registry);
		expect(result.verdict).toBe("VERIFIER-ERROR");
		expect(result.per_run).toHaveLength(0);
	});
});

describe("adjudicate — fanout_n aggregation (worst wins)", () => {
	it("is CONFIRMED only when every run_id is individually CONFIRMED", async () => {
		const client = new AdaptOrchClient(
			makeFakeTransport({
				"run-a": {
					run: { run_id: "run-a", status: "completed" },
					artifacts: [{ path: "a.md", size_bytes: 1 }],
					traces: [{ kind: "write", level: "info" }],
				},
				"run-b": {
					run: { run_id: "run-b", status: "completed" },
					artifacts: [{ path: "b.md", size_bytes: 1 }],
					traces: [{ kind: "write", level: "info" }],
				},
			}),
		);
		const result = await adjudicate(
			{ dispatch_record_id: "d7", kind: "code-edit", run_ids: ["run-a", "run-b"] },
			client,
			registry,
		);
		expect(result.verdict).toBe("CONFIRMED");
		expect(result.per_run).toHaveLength(2);
	});

	it("takes the worst verdict when run_ids disagree (CONTRADICTED beats CONFIRMED)", async () => {
		const client = new AdaptOrchClient(
			makeFakeTransport({
				"run-good": {
					run: { run_id: "run-good", status: "completed" },
					artifacts: [{ path: "good.md", size_bytes: 1 }],
					traces: [],
				},
				"run-bad": {
					run: { run_id: "run-bad", status: "completed" },
					artifacts: [{ path: "bad.md", size_bytes: 1 }],
					traces: [{ level: "error" }],
				},
			}),
		);
		const result = await adjudicate(
			{ dispatch_record_id: "d8", kind: "code-edit", run_ids: ["run-good", "run-bad"] },
			client,
			registry,
		);
		expect(result.verdict).toBe("CONTRADICTED");
		expect(result.per_run).toHaveLength(2);
	});
});

describe("projectVerdictToDisposition", () => {
	it("routes CONFIRMED to targetState CONFIRMED with no next action", async () => {
		const disposition = await projectVerdictToDisposition(
			{ verdict: "CONFIRMED", reason: "ok", per_run: [] },
			makePacket(),
		);
		expect(disposition).toEqual({ targetState: "CONFIRMED", nextActionKind: "none" });
	});

	it("routes VERIFIER-ERROR to escalate — never to retry_same_topology or reroute", async () => {
		const disposition = await projectVerdictToDisposition(
			{ verdict: "VERIFIER-ERROR", reason: "run-status-unparseable", per_run: [] },
			makePacket({ retry_count: 2 }), // even with retries available, must still escalate
		);
		expect(disposition).toEqual({ targetState: "DECLINED", nextActionKind: "escalate" });
	});

	it("routes a scope-violation CONTRADICTED reason to escalate, not retry", async () => {
		const disposition = await projectVerdictToDisposition(
			{ verdict: "CONTRADICTED", reason: "scope-violation: path outside lane scope", per_run: [] },
			makePacket(),
		);
		expect(disposition.nextActionKind).toBe("escalate");
	});

	it("routes an ordinary CONTRADICTED reason to retry_same_topology by default", async () => {
		const disposition = await projectVerdictToDisposition(
			{ verdict: "CONTRADICTED", reason: "error-span-scan: 1 error span(s) found", per_run: [] },
			makePacket(),
		);
		expect(disposition.nextActionKind).toBe("retry_same_topology");
	});
});

describe("runAdjudicationWithTimeout", () => {
	it("returns ok:false when adjudicate() does not settle before the timeout (the ADJUDICATION_FAILED trigger)", async () => {
		const client = new AdaptOrchClient({
			callTool: () => new Promise(() => {}), // never resolves
		});
		const result = await runAdjudicationWithTimeout(
			{ dispatch_record_id: "d9", kind: "code-edit", run_ids: ["run-hang"] },
			client,
			registry,
			25,
		);
		expect(result.ok).toBe(false);
	});

	it("returns ok:true with the verdict when adjudicate() completes normally", async () => {
		const client = new AdaptOrchClient(
			makeFakeTransport({
				"run-fast": {
					run: { run_id: "run-fast", status: "completed" },
					artifacts: [{ path: "x", size_bytes: 1 }],
					traces: [{ kind: "write", level: "info" }],
				},
			}),
		);
		const result = await runAdjudicationWithTimeout(
			{ dispatch_record_id: "d10", kind: "code-edit", run_ids: ["run-fast"] },
			client,
			registry,
			5000,
		);
		expect(result).toEqual({
			ok: true,
			result: { verdict: "CONFIRMED", reason: "all-checks-passed", per_run: expect.any(Array) },
		});
	});
});
