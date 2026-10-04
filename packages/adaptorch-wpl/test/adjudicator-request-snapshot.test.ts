import { describe, expect, it, vi } from "vitest";
import { AdaptOrchClient } from "../src/adaptorch-client.ts";
import { type AdjudicationRequest, adjudicate } from "../src/adjudicator.ts";
import { aggregateRunVerdicts } from "../src/adjudicator-aggregate.ts";
import { type CheckResult, createVerifierRegistry } from "../src/adjudicator-registry.ts";
import { mapToB2C } from "../src/b2c-mapper.ts";

function request(): AdjudicationRequest {
	return { dispatch_record_id: "original-dispatch", kind: "original-kind", run_ids: ["run-a", "run-b"] };
}
function transport(onRun?: (runId: string) => void) {
	const callTool = vi.fn(async (name: string, args: Record<string, unknown>) => {
		if (name === "adaptorch_get_run") {
			onRun?.(args.run_id as string);
			return { run_id: args.run_id, status: "SUCCEEDED" };
		}
		if (name === "adaptorch_get_artifacts") return [{ path: "synthetic.md", size_bytes: 1 }];
		if (name === "adaptorch_get_traces") return [{ kind: "write" }];
		throw new Error("unexpected synthetic tool");
	});
	return { client: new AdaptOrchClient({ callTool }), callTool };
}

describe("adjudication request snapshot", () => {
	it("captures all identities before a registry mutates the caller request", async () => {
		const input = request();
		const { client, callTool } = transport();
		const get = vi.fn((kind: string) => {
			input.dispatch_record_id = "replaced-dispatch";
			input.kind = "replaced-kind";
			input.run_ids.length = 0;
			return { kind };
		});
		const result = await adjudicate(input, client, { get });
		expect(get).toHaveBeenCalledWith("original-kind");
		expect(result.verdict).toBe("INDETERMINATE");
		expect(result.per_run.map((run) => run.run_id)).toEqual(["run-a", "run-b"]);
		expect(
			callTool.mock.calls.filter(([name]) => name === "adaptorch_get_run").map(([, args]) => args.run_id),
		).toEqual(["run-a", "run-b"]);
	});

	it.each(["replace", "splice", "reverse"])("keeps run identities stable during getRun (%s)", async (mutation) => {
		const input = request();
		const { client, callTool } = transport(() => {
			input.kind = "changed-kind";
			input.dispatch_record_id = "changed-dispatch";
			if (mutation === "replace") input.run_ids = ["injected-run"];
			if (mutation === "splice") input.run_ids.splice(0, 2, "injected-run");
			if (mutation === "reverse") input.run_ids.reverse();
		});
		const result = await adjudicate(input, client, createVerifierRegistry([]));
		expect(result.verdict).not.toBe("CONFIRMED");
		expect(result.per_run.map((run) => run.run_id)).toEqual(["run-a", "run-b"]);
		expect(callTool.mock.calls.every(([, args]) => ["run-a", "run-b"].includes(args.run_id as string))).toBe(true);
	});

	it.each([Array(1), ["run-a", ...Array(1)], [undefined], []])(
		"rejects sparse or empty run arrays before lookup",
		async (run_ids) => {
			const input = { ...request(), run_ids } as AdjudicationRequest;
			const get = vi.fn(() => ({ kind: "original-kind" }));
			const { client, callTool } = transport();
			const result = await adjudicate(input, client, { get });
			expect(result.verdict).toBe("VERIFIER-ERROR");
			expect(result.reason_code).toBe("MALFORMED_REQUEST");
			expect(get).not.toHaveBeenCalled();
			expect(callTool).not.toHaveBeenCalled();
		},
	);

	it.each(["", " ", undefined, null, 3])(
		"rejects invalid dispatch identity before lookup: %j",
		async (dispatch_record_id) => {
			const input = { ...request(), dispatch_record_id } as AdjudicationRequest;
			const get = vi.fn(() => ({ kind: "original-kind" }));
			const { client, callTool } = transport();
			const result = await adjudicate(input, client, { get });
			expect(result.reason_code).toBe("MALFORMED_REQUEST");
			expect(get).not.toHaveBeenCalled();
			expect(callTool).not.toHaveBeenCalled();
		},
	);
});

describe("empty aggregate boundary", () => {
	it("rejects sparse aggregate entries and unsupported confirmed inputs", () => {
		for (const per_run of [
			Array(1),
			[{ run_id: "r", verdict: "CONFIRMED", reason_code: "ALL_CHECKS_PASSED", reason: "unsupported" }],
		]) {
			const result = aggregateRunVerdicts(per_run as Parameters<typeof aggregateRunVerdicts>[0]);
			expect(result.verdict).toBe("VERIFIER-ERROR");
			expect(result.reason_code).toBe("MALFORMED_REQUEST");
		}
	});
	it("cannot convert zero outcomes to CONFIRMED or ALL_CHECKS_PASSED", () => {
		expect(aggregateRunVerdicts([])).toEqual({
			verdict: "VERIFIER-ERROR",
			reason_code: "MALFORMED_REQUEST",
			reason: "adjudication-produced-no-recognized-run-outcomes",
		});
	});
});

describe("negative check reason integrity", () => {
	it.each(["ALL_CHECKS_PASSED", "unrecognized-code", undefined])(
		"never promotes a rejected content check code: %s",
		async (code) => {
			const { client } = transport();
			const result = await adjudicate(
				request(),
				client,
				createVerifierRegistry([
					{ kind: "original-kind", content_check: () => ({ ok: false, code }) as CheckResult },
				]),
			);
			expect(result.verdict).toBe("CONTRADICTED");
			expect(result.reason_code).toBe("CONTENT_CHECK_FAILED");
		},
	);
	it("does not emit passed wording for a caller-supplied negative outcome with a success reason", () => {
		const mapped = mapToB2C({
			kind: "review",
			runIds: ["run-a"],
			previewOnly: false,
			policyFlags: [],
			diffPaths: ["example.ts"],
			adjudication: {
				verdict: "CONTRADICTED",
				reason_code: "ALL_CHECKS_PASSED",
				reason: "invalid caller pair",
				per_run: [],
			},
		});
		expect(mapped.verdictCard.passed_checks).toEqual([]);
		expect(mapped.receipt.canApply).toBe(false);
		expect(mapped.receipt.shouldSubmit).toBe(false);
	});
	it("rejects incoherent or unknown reason codes at the aggregate boundary", () => {
		for (const reason_code of ["ALL_CHECKS_PASSED", "unrecognized-code"] as const) {
			const result = aggregateRunVerdicts([
				{ run_id: "run-a", verdict: "CONTRADICTED", reason_code, reason: "invalid" },
			] as Parameters<typeof aggregateRunVerdicts>[0]);
			expect(result.verdict).toBe("VERIFIER-ERROR");
			expect(result.reason_code).toBe("MALFORMED_REQUEST");
		}
	});
});
