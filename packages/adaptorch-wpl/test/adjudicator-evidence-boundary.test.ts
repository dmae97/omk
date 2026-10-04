import { describe, expect, it, vi } from "vitest";
import { AdaptOrchClient } from "../src/adaptorch-client.ts";
import { type AdjudicationRequest, adjudicate } from "../src/adjudicator.ts";
import { createVerifierRegistry } from "../src/adjudicator-registry.ts";
import { evaluateCorrectnessWall } from "../src/evaluate-correctness-wall.ts";
import { createInMemoryAdaptOrchClient } from "../src/in-memory-adaptorch.ts";

// Synthetic fixtures only, deliberately including malformed and partial responses.
const request = { dispatch_record_id: "synthetic-d", kind: "review", run_ids: ["synthetic-r"] };
const run = { run_id: "synthetic-r", status: "SUCCEEDED" };
const artifacts = [{ path: "review.md", size_bytes: 12 }];
const traces = [{ kind: "tool_call", severity: "info" }];
const registry = createVerifierRegistry([]);
function fixture(artifactResponse: unknown, traceResponse: unknown) {
	return createInMemoryAdaptOrchClient({ "synthetic-r": { run, artifacts: artifactResponse, traces: traceResponse } });
}

describe("adjudicator evidence boundaries", () => {
	it.each([null, {}, "synthetic-r", [], [null], [""], [" "]])(
		"fails closed on invalid run_ids: %j",
		async (run_ids) => {
			const callTool = vi.fn(async () => run);
			const result = await adjudicate(
				{ ...request, run_ids } as unknown as AdjudicationRequest,
				new AdaptOrchClient({ callTool }),
				registry,
			);
			expect(result.reason_code).toBe("MALFORMED_REQUEST");
			expect(callTool).not.toHaveBeenCalled();
		},
	);
	it.each([{}, "unavailable", 1, true, { error: "no access" }, { items: {} }, { data: null }])(
		"rejects malformed artifact envelopes: %j",
		async (payload) => {
			const result = await adjudicate(request, fixture(payload, traces), registry);
			expect(result.verdict).toBe("VERIFIER-ERROR");
			expect(result.reason_code).toBe("EVIDENCE_MALFORMED");
		},
	);
	it.each([{}, "unavailable", false, { error: "full-profile-only" }, { spans: {} }])(
		"rejects malformed trace envelopes: %j",
		async (payload) => {
			const result = await adjudicate(request, fixture(artifacts, payload), registry);
			expect(result.reason_code).toBe("EVIDENCE_MALFORMED");
		},
	);
	it.each([[], null, undefined])("keeps missing artifact evidence unverified: %j", async (payload) => {
		const result = await adjudicate(request, fixture(payload, traces), registry);
		expect(result.verdict).toBe("INDETERMINATE");
		expect(result.reason_code).toBe("EVIDENCE_EMPTY");
	});
	it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("does not ignore size_bytes=%s", async (size_bytes) => {
		const result = await adjudicate(request, fixture([{ path: "review.md", size_bytes }], traces), registry);
		expect(result.verdict).toBe("CONTRADICTED");
		expect(result.reason_code).toBe("EMPTY_ARTIFACT_CONTENT");
	});
	it("does not promote successful registered structural checks", async () => {
		const content_check = vi.fn(() => ({ ok: true }));
		const trace_check = vi.fn(() => ({ ok: true }));
		const result = await adjudicate(
			request,
			fixture(artifacts, traces),
			createVerifierRegistry([{ kind: "review", content_check, trace_check }]),
		);
		expect(content_check).toHaveBeenCalledOnce();
		expect(trace_check).toHaveBeenCalledOnce();
		expect(result.reason_code).toBe("VERIFICATION_UNAVAILABLE");
	});
	it("allows zero artifacts only as a structural exception, never proof", async () => {
		const result = await adjudicate(
			request,
			fixture([], traces),
			createVerifierRegistry([{ kind: "review", allow_zero_artifacts: true }]),
		);
		expect(result.reason_code).toBe("VERIFICATION_UNAVAILABLE");
	});
	it("accepts recognized list envelopes without treating them as execution proof", async () => {
		const result = await adjudicate(request, fixture({ items: artifacts }, { spans: traces }), registry);
		expect(result.reason_code).toBe("VERIFICATION_UNAVAILABLE");
	});
	it.each(["RUNNING", "CANCELLING"])("does not fetch premature evidence for %s", async (status) => {
		const callTool = vi.fn(async () => ({ ...run, status }));
		const result = await adjudicate(request, new AdaptOrchClient({ callTool }), registry);
		expect(result.reason_code).toBe("RUN_NOT_TERMINAL");
		expect(callTool).toHaveBeenCalledTimes(1);
	});
	it("retains a blocked disposition when another run fails to fetch", async () => {
		const client = new AdaptOrchClient({
			async callTool(name, args) {
				if (args.run_id === "missing") throw new Error("synthetic missing run");
				if (name !== "adaptorch_get_run") throw new Error("blocked evidence must not need full-only traces");
				return { ...run, correctness_wall: { verdict: "BLOCKED", blockers: ["capability-unavailable"] } };
			},
		});
		const result = await evaluateCorrectnessWall({ kind: "review", runIds: ["synthetic-r", "missing"], client });
		expect(result.receipt.adjudicationVerdict).toBe("VERIFIER-ERROR");
		expect(result.verdictCard.verdict).toBe("BLOCKED");
		expect(result.verdictCard.blocked_reasons.some((reason) => reason.includes("blocked this run"))).toBe(true);
		expect(result.receipt.canApply).toBe(false);
		expect(result.receipt.shouldSubmit).toBe(false);
	});
});
