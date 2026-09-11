import { parseRunContract, parseRunResumeCommand, parseRunStartCommand } from "omk-protocol";
import { parseNamespaceIdentity } from "./namespace-identity.ts";
import { parseRecoveryBudget } from "./recovery-clock.ts";
import type { RunEvent } from "./run-types.ts";
import { VerifiedRunError } from "./storage.ts";

function text(value: unknown): string {
	if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new VerifiedRunError("integrity");
	return value;
}
function digest(value: unknown): string {
	const result = text(value);
	if (!/^[a-f0-9]{64}$/.test(result)) throw new VerifiedRunError("integrity");
	return result;
}
function integer(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new VerifiedRunError("integrity");
	return value;
}

export function parseRunEvent(raw: unknown): RunEvent {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new VerifiedRunError("integrity");
	const value: Record<string, unknown> = Object.fromEntries(Object.entries(raw));
	switch (value.kind) {
		case "created":
			return {
				kind: value.kind,
				contract: parseRunContract(value.contract),
				command: parseRunStartCommand(value.command),
			};
		case "budget_anchored":
			if (value.driver !== "linux-pidns-gate-v1") throw new VerifiedRunError("integrity");
			return {
				kind: value.kind,
				budget: parseRecoveryBudget(value.budget),
				environmentDigest: digest(value.environmentDigest),
				driver: value.driver,
			};
		case "dispatch": {
			if (value.role !== "writer" && value.role !== "verifier") throw new VerifiedRunError("integrity");
			return {
				kind: value.kind,
				executionId: text(value.executionId),
				role: value.role,
				claimId: value.claimId === null ? null : text(value.claimId),
			};
		}
		case "process_ready":
			return {
				kind: value.kind,
				executionId: text(value.executionId),
				identity: parseNamespaceIdentity(value.identity),
			};
		case "writer_opened":
			return { kind: value.kind };
		case "model_request":
			return { kind: value.kind, requestId: text(value.requestId) };
		case "writer_closed":
			if (typeof value.completed !== "boolean") throw new VerifiedRunError("integrity");
			return { kind: value.kind, completed: value.completed };
		case "exited":
			return {
				kind: value.kind,
				executionId: text(value.executionId),
				failure: value.failure === null ? null : text(value.failure),
			};
		case "candidate":
			return {
				kind: value.kind,
				digest: digest(value.digest),
				...(value.observedMs === undefined ? {} : { observedMs: integer(value.observedMs) }),
				...(value.verificationDeadlineMs === undefined
					? {}
					: { verificationDeadlineMs: integer(value.verificationDeadlineMs) }),
			};
		case "resumed":
			if (!Array.isArray(value.reconciledExecutionIds) || value.reconciledExecutionIds.length > 128)
				throw new VerifiedRunError("integrity");
			return {
				kind: value.kind,
				command: parseRunResumeCommand(value.command),
				observedMs: integer(value.observedMs),
				reconciledExecutionIds: Object.freeze(value.reconciledExecutionIds.map(text)),
			};
		case "evaluated":
			if (typeof value.verified !== "boolean") throw new VerifiedRunError("integrity");
			return { kind: value.kind, receiptDigest: digest(value.receiptDigest), verified: value.verified };
		case "failed":
			return { kind: value.kind, code: text(value.code) };
		default:
			throw new VerifiedRunError("integrity");
	}
}
