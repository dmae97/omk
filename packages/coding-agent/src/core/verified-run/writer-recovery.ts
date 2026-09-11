import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { MAX_VERIFIED_RUN_GENERATIONS, type RunWriterRestartCommand } from "omk-protocol";
import { commandEnvironmentDigest, probeVerifiedSandbox } from "./broker.ts";
import { loadCandidate, materializeCandidate } from "./candidate.ts";
import { preflightCheckReceipts } from "./check-receipt.ts";
import type { JournalSnapshot } from "./journal.ts";
import { probeNamespace } from "./namespace-identity.ts";
import { readRunClock, remainingRunTime } from "./recovery-clock.ts";
import { requireRunJournal, withRecoveryLease } from "./recovery-command.ts";
import type { RunProjection } from "./run-types.ts";
import type { VerifiedRunRuntime } from "./session-port.ts";
import { readRegularFile, VerifiedRunError } from "./storage.ts";
import { verifyCandidate } from "./verification-phase.ts";
import { publishWriterCandidate } from "./writer-completion.ts";
import { executeWriter } from "./writer-phase.ts";

export interface WriterRecoveryInspection {
	readonly state: RunProjection;
	readonly readiness:
		| "ready"
		| "terminal"
		| "input_checkpoint_missing"
		| "candidate_present"
		| "unsettled"
		| "expired"
		| "clock_changed"
		| "clock_rollback"
		| "recovery_limit"
		| "model_request_limit"
		| "integrity";
	readonly remainingWorkMs: number | null;
	readonly ownership: "lease_required";
}

function assertWriterRecoverable(runPath: string, snapshot: JournalSnapshot): number {
	const state = snapshot.state;
	const first = snapshot.records[0]?.event;
	if (state.execution === "failed" || state.receiptDigest) throw new VerifiedRunError("resume_terminal");
	if (first?.kind !== "created" || !state.inputDigest || !state.budget || !state.environmentDigest)
		throw new VerifiedRunError("input_checkpoint_missing");
	if (state.candidateDigest || state.verificationDeadlineMs !== null) throw new VerifiedRunError("candidate_present");
	if (state.generation >= MAX_VERIFIED_RUN_GENERATIONS) throw new VerifiedRunError("recovery_limit");
	const clock = readRunClock();
	const remaining = remainingRunTime(state.budget, state.budget.workDeadlineMs, clock);
	if (clock.nowMs < (state.lastClockMs ?? state.budget.startedMs)) throw new VerifiedRunError("clock_rollback");
	if (remaining <= 0) throw new VerifiedRunError("deadline");
	if (
		first.contract.profile === "linux-scripted-agent-v1" &&
		first.contract.writer.maxRequests - state.modelRequests < first.contract.writer.steps.length + 1
	)
		throw new VerifiedRunError("model_request_limit");
	for (const id of state.activeExecutionIds) {
		const dispatch = snapshot.records.find(
			(record) =>
				record.generation === state.generation &&
				record.event.kind === "dispatch" &&
				record.event.executionId === id,
		)?.event;
		const identity = state.processes.find((item) => item.executionId === id)?.identity;
		if (
			dispatch?.kind !== "dispatch" ||
			dispatch.role !== "writer" ||
			!identity ||
			probeNamespace(identity) !== "gone"
		)
			throw new VerifiedRunError("unsettled");
	}
	if (readRegularFile(join(runPath, "issuer.key"), 32).length !== 32) throw new VerifiedRunError("integrity");
	loadCandidate(runPath, state.inputDigest, first.contract.budget);
	if (commandEnvironmentDigest(first.contract, "gated-v1") !== state.environmentDigest)
		throw new VerifiedRunError("integrity");
	return remaining;
}

export function inspectWriterRecovery(runPath: string): WriterRecoveryInspection {
	const snapshot = requireRunJournal(runPath);
	let readiness: WriterRecoveryInspection["readiness"] = "ready";
	let remainingWorkMs: number | null = null;
	try {
		remainingWorkMs = assertWriterRecoverable(runPath, snapshot);
	} catch (error) {
		if (!(error instanceof Error)) throw error;
		switch (error instanceof VerifiedRunError ? error.code : "integrity") {
			case "resume_terminal":
				readiness = "terminal";
				break;
			case "deadline":
				readiness = "expired";
				remainingWorkMs = 0;
				break;
			case "input_checkpoint_missing":
				readiness = "input_checkpoint_missing";
				break;
			case "candidate_present":
				readiness = "candidate_present";
				break;
			case "unsettled":
				readiness = "unsettled";
				break;
			case "clock_changed":
				readiness = "clock_changed";
				break;
			case "clock_rollback":
				readiness = "clock_rollback";
				break;
			case "recovery_limit":
				readiness = "recovery_limit";
				break;
			case "model_request_limit":
				readiness = "model_request_limit";
				break;
			default:
				readiness = "integrity";
		}
	}
	return Object.freeze({ state: snapshot.state, readiness, remainingWorkMs, ownership: "lease_required" });
}

/** Re-run isolated local work in a new copy. Never reuse an interrupted workspace or replenish a budget. */
export async function restartIsolatedWriter(
	runPath: string,
	command: RunWriterRestartCommand,
	options: { readonly runtime?: VerifiedRunRuntime; readonly signal?: AbortSignal },
): Promise<RunProjection> {
	if (options.signal?.aborted) throw new VerifiedRunError("cancelled");
	return withRecoveryLease(runPath, command, async ({ snapshot, journal }) => {
		assertWriterRecoverable(runPath, snapshot);
		const first = snapshot.records[0]?.event;
		if (first?.kind !== "created") throw new VerifiedRunError("integrity");
		if (first.contract.profile === "linux-scripted-agent-v1" && !options.runtime)
			throw new VerifiedRunError("writer_backend_missing");
		preflightCheckReceipts(first.contract);
		probeVerifiedSandbox();
		assertWriterRecoverable(runPath, snapshot);
		if (options.signal?.aborted) throw new VerifiedRunError("cancelled");
		journal.append({
			kind: "writer_restarted",
			command,
			observedMs: readRunClock().nowMs,
			reconciledExecutionIds: snapshot.state.activeExecutionIds,
		});
		const state = journal.state;
		if (!state.budget || !state.inputDigest) throw new VerifiedRunError("integrity");
		const deadline = performance.now() + remainingRunTime(state.budget, state.budget.workDeadlineMs);
		const base = loadCandidate(runPath, state.inputDigest, first.contract.budget);
		const workspace = join(runPath, `writer-${state.generation}`);
		materializeCandidate(base, workspace);
		const context = {
			runPath,
			contract: first.contract,
			journal,
			...(options.signal ? { signal: options.signal } : {}),
		};
		await executeWriter(context, { workspace, deadline, ...(options.runtime ? { runtime: options.runtime } : {}) });
		publishWriterCandidate(context, workspace, deadline);
		return verifyCandidate(context);
	});
}
