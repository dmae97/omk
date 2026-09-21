import {
	parseRunContract,
	parseRunResumeCommand,
	parseRunStartCommand,
	parseRunTaskRetryCommand,
	parseRunWriterRestartCommand,
} from "omk-protocol";
import type { RunTaskCheckpoint } from "./dag-types.ts";
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
function oid(value: unknown, zeroAllowed: boolean): string {
	if (typeof value !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value))
		throw new VerifiedRunError("integrity");
	if (!zeroAllowed && /^0+$/.test(value)) throw new VerifiedRunError("integrity");
	return value;
}

function checkpoint(raw: unknown): RunTaskCheckpoint {
	if (typeof raw !== "object" || raw === null) throw new VerifiedRunError("integrity");
	const value: Record<string, unknown> = Object.fromEntries(Object.entries(raw));
	if (value.status !== "succeeded" || value.failure !== null) throw new VerifiedRunError("integrity");
	return Object.freeze({
		taskId: text(value.taskId),
		attempt: integer(value.attempt),
		generation: integer(value.generation),
		status: "succeeded",
		inputDigest: digest(value.inputDigest),
		outputDigest: digest(value.outputDigest),
		failure: null,
	});
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
				...(value.taskId === undefined ? {} : { taskId: text(value.taskId) }),
			};
		}
		case "input_checkpoint":
			return { kind: value.kind, digest: digest(value.digest) };
		case "process_ready":
			return {
				kind: value.kind,
				executionId: text(value.executionId),
				identity: parseNamespaceIdentity(value.identity),
			};
		case "task_started":
			return {
				kind: value.kind,
				taskId: text(value.taskId),
				attempt: integer(value.attempt),
				inputDigest: digest(value.inputDigest),
				observedMs: integer(value.observedMs),
			};
		case "task_finished":
			return {
				kind: value.kind,
				taskId: text(value.taskId),
				attempt: integer(value.attempt),
				outputDigest: value.outputDigest === null ? null : digest(value.outputDigest),
				failure: value.failure === null ? null : text(value.failure),
				observedMs: integer(value.observedMs),
			};
		case "tasks_paused":
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
		case "tasks_retried":
		case "writer_restarted": {
			if (!Array.isArray(value.reconciledExecutionIds) || value.reconciledExecutionIds.length > 128)
				throw new VerifiedRunError("integrity");
			const fields = {
				observedMs: integer(value.observedMs),
				reconciledExecutionIds: Object.freeze(value.reconciledExecutionIds.map(text)),
			};
			switch (value.kind) {
				case "resumed":
					return { ...fields, kind: value.kind, command: parseRunResumeCommand(value.command) };
				case "writer_restarted":
					return { ...fields, kind: value.kind, command: parseRunWriterRestartCommand(value.command) };
				case "tasks_retried":
					if (!Array.isArray(value.adopted) || value.adopted.length > 16) throw new VerifiedRunError("integrity");
					return {
						...fields,
						kind: value.kind,
						command: parseRunTaskRetryCommand(value.command),
						adopted: Object.freeze(value.adopted.map(checkpoint)),
					};
				default:
					throw new VerifiedRunError("integrity");
			}
		}
		case "evaluated":
			if (typeof value.verified !== "boolean") throw new VerifiedRunError("integrity");
			return { kind: value.kind, receiptDigest: digest(value.receiptDigest), verified: value.verified };
		case "publish_intent": {
			const candidateOid = oid(value.candidateOid, false);
			const parentOid = oid(value.parentOid, true);
			if (value.targetRef !== "refs/omk/accepted" || parentOid.length !== candidateOid.length)
				throw new VerifiedRunError("integrity");
			return {
				kind: value.kind,
				commandId: text(value.commandId),
				candidateDigest: digest(value.candidateDigest),
				candidateOid,
				parentOid,
				targetRef: value.targetRef,
				receiptDigest: digest(value.receiptDigest),
				policyDigest: digest(value.policyDigest),
				generation: integer(value.generation),
			};
		}
		case "published": {
			const candidateOid = oid(value.candidateOid, false);
			const previousOid = oid(value.previousOid, true);
			if (previousOid.length !== candidateOid.length) throw new VerifiedRunError("integrity");
			return { kind: value.kind, commandId: text(value.commandId), candidateOid, previousOid };
		}
		case "publish_failed":
			return { kind: value.kind, commandId: text(value.commandId), code: text(value.code) };
		case "failed":
			return { kind: value.kind, code: text(value.code) };
		default:
			throw new VerifiedRunError("integrity");
	}
}
