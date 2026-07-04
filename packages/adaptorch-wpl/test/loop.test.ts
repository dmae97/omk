import { describe, expect, it } from "vitest";
import type { AdjudicationResult } from "../src/adjudicator.ts";
import { ADJUDICATION_REASON_CODES, type AdjudicationReasonCode } from "../src/adjudicator-registry.ts";
import { decideNextTransition, projectVerdictToDisposition } from "../src/loop.ts";
import type { WorkPacket } from "../src/types.ts";

function makePacket(overrides: Partial<WorkPacket> = {}): WorkPacket {
	return {
		packet_id: "pkt-loop",
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

function contradicted(reasonCode: AdjudicationReasonCode, reason: string): AdjudicationResult {
	return { verdict: "CONTRADICTED", reason_code: reasonCode, reason, per_run: [] };
}

describe("projectVerdictToDisposition — CONTRADICTED reason-code table", () => {
	it("maps every reason code in the closed set to a valid disposition (totality)", async () => {
		for (const code of ADJUDICATION_REASON_CODES) {
			const disposition = await projectVerdictToDisposition(
				contradicted(code, `synthetic reason for ${code}`),
				makePacket({ retry_count: 1 }),
			);
			expect(disposition.targetState).toBe("DECLINED");
			expect(["escalate", "reroute", "retry_same_topology"]).toContain(disposition.nextActionKind);
		}
	});

	it("escalates SCOPE_VIOLATION regardless of retry_count", async () => {
		for (const retryCount of [0, 1, 2]) {
			const disposition = await projectVerdictToDisposition(
				contradicted("SCOPE_VIOLATION", "write outside lane"),
				makePacket({ retry_count: retryCount }),
			);
			expect(disposition).toEqual({ targetState: "DECLINED", nextActionKind: "escalate" });
		}
	});

	it("reroutes SCHEMA_DRIFT and CONTENT_CHECK_FAILED only on recurrence (retry_count >= 1)", async () => {
		for (const code of ["SCHEMA_DRIFT", "CONTENT_CHECK_FAILED"] as const) {
			const first = await projectVerdictToDisposition(contradicted(code, "drift"), makePacket({ retry_count: 0 }));
			expect(first.nextActionKind).toBe("retry_same_topology");
			const recurring = await projectVerdictToDisposition(
				contradicted(code, "drift"),
				makePacket({ retry_count: 1 }),
			);
			expect(recurring.nextActionKind).toBe("reroute");
		}
	});

	it("regression: incidental 'scope'/'schema' wording in the free-text reason never changes the disposition", async () => {
		// Pre-reason-code behavior string-matched result.reason, so a content check whose
		// human-readable explanation mentioned "telescope" or "scoped variable" falsely
		// escalated. The disposition must now come from reason_code alone.
		const trickyReasons = [
			"content-check-failed: artifact mentions a telescope",
			"content-check-failed: unused scoped variable in output",
			"trace-check-failed: scope of work unclear",
		];
		for (const reason of trickyReasons) {
			const disposition = await projectVerdictToDisposition(
				contradicted("TRACE_ERROR_SPAN", reason),
				makePacket({ retry_count: 0 }),
			);
			expect(disposition.nextActionKind).toBe("retry_same_topology");
		}

		// And the inverse: schema drift no longer needs the word "schema" in the text.
		const drift = await projectVerdictToDisposition(
			contradicted("SCHEMA_DRIFT", "output shape mismatch"),
			makePacket({ retry_count: 1 }),
		);
		expect(drift.nextActionKind).toBe("reroute");
	});
});

describe("decideNextTransition — DECLINED branch", () => {
	it("lets escalate win regardless of remaining budget", () => {
		const state = decideNextTransition(makePacket({ retry_count: 0 }), {
			targetState: "DECLINED",
			nextActionKind: "escalate",
		});
		expect(state).toBe("ESCALATED");
	});

	it("queues a retry while attempt budget remains, and closes once exhausted", () => {
		const retryable = decideNextTransition(makePacket({ retry_count: 2 }), {
			targetState: "DECLINED",
			nextActionKind: "retry_same_topology",
		});
		expect(retryable).toBe("RETRY_QUEUED");

		const exhausted = decideNextTransition(makePacket({ retry_count: 3 }), {
			targetState: "DECLINED",
			nextActionKind: "retry_same_topology",
		});
		expect(exhausted).toBe("CLOSED");
	});
});
