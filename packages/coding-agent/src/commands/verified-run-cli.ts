import { join } from "node:path";
import { parseRunContract, RunContractError, VERIFIED_COMMAND_VERSION } from "omk-protocol";
import { getAgentDir } from "../config.ts";
import { cancelVerifiedRun } from "../core/verified-run/cancel-request.ts";
import { planVerifiedRun, RunCoordinator } from "../core/verified-run/coordinator.ts";
import { collectVerifiedRuns } from "../core/verified-run/run-gc.ts";
import { publishPolicyDigest } from "../core/verified-run/run-publish.ts";
import type { VerifiedRunRuntime } from "../core/verified-run/session-port.ts";
import { digestBytes, readJson, stateRunPath, VerifiedRunError } from "../core/verified-run/storage.ts";
import { operationFailure, parse, required, retention, USAGE, waitMs } from "./verified-run-cli-args.ts";
import { withRunSignal } from "./verified-run-signal.ts";

export async function runVerifiedRunCli(
	args: string[],
	runtime?: VerifiedRunRuntime,
): Promise<{ readonly handled: boolean; readonly exitCode: number }> {
	if (args[0] !== "run") return { handled: false, exitCode: 0 };
	if (args.length === 2 && args[1] === "--help") {
		process.stdout.write(`${USAGE}\n`);
		return { handled: true, exitCode: 0 };
	}
	try {
		const parsed = parse(args);
		const stateRoot = parsed.flags.get("--state-dir") ?? join(getAgentDir(), "verified-runs");
		const coordinator = new RunCoordinator(stateRoot, runtime);
		let result: unknown;
		let exitCode = 0;
		switch (parsed.action) {
			case "plan":
				result = planVerifiedRun(readJson(required(parsed, "--contract")));
				break;
			case "start": {
				const approvedContractDigest = required(parsed, "--approve");
				const commandId = required(parsed, "--command-id");
				const contract = parseRunContract(readJson(required(parsed, "--contract")));
				const state = await withRunSignal(stateRunPath(stateRoot, contract.runId), (signal) =>
					coordinator.start(
						contract,
						{
							schemaVersion: VERIFIED_COMMAND_VERSION,
							kind: "start",
							runId: contract.runId,
							commandId,
							expectedRevision: 0,
							expectedGeneration: 0,
							contractDigest: approvedContractDigest,
						},
						{ approvedContractDigest, signal },
					),
				);
				result = state;
				exitCode = state.application === "candidate_ready" ? 0 : 1;
				break;
			}
			case "resume":
			case "retry-tasks":
			case "restart-writer": {
				required(parsed, "--execute");
				const approvedContractDigest = required(parsed, "--approve");
				const request = {
					schemaVersion: VERIFIED_COMMAND_VERSION,
					runId: parsed.id ?? "",
					commandId: required(parsed, "--command-id"),
					expectedRevision: Number(required(parsed, "--revision")),
					expectedGeneration: Number(required(parsed, "--generation")),
					contractDigest: approvedContractDigest,
				};
				const state = await withRunSignal(stateRunPath(stateRoot, request.runId), (signal) =>
					parsed.action === "retry-tasks"
						? coordinator.retryTasks(
								{
									...request,
									kind: "retry_tasks",
									baseDigest: required(parsed, "--base"),
									taskIds: required(parsed, "--tasks") === "-" ? [] : required(parsed, "--tasks").split(","),
								},
								{ approvedContractDigest, signal },
							)
						: parsed.action === "resume"
							? coordinator.resume(
									{ ...request, kind: "resume", candidateDigest: required(parsed, "--candidate") },
									{ approvedContractDigest, signal },
								)
							: coordinator.restartWriter(
									{ ...request, kind: "restart_writer", baseDigest: required(parsed, "--base") },
									{ approvedContractDigest, signal },
								),
				);
				result = state;
				exitCode = state.application === "candidate_ready" ? 0 : 1;
				break;
			}
			case "publish": {
				required(parsed, "--execute");
				const approvedContractDigest = required(parsed, "--approve");
				const contract = parseRunContract(readJson(required(parsed, "--contract")));
				const state = await withRunSignal(stateRunPath(stateRoot, parsed.id ?? ""), (signal) =>
					coordinator.publish(
						{
							schemaVersion: VERIFIED_COMMAND_VERSION,
							kind: "publish",
							runId: parsed.id ?? "",
							commandId: required(parsed, "--command-id"),
							expectedRevision: Number(required(parsed, "--revision")),
							expectedGeneration: Number(required(parsed, "--generation")),
							contractDigest: approvedContractDigest,
							candidateDigest: required(parsed, "--candidate"),
							parentOid: required(parsed, "--parent"),
							receiptDigest: required(parsed, "--receipt"),
							policyDigest: publishPolicyDigest(contract),
						},
						{ approvedContractDigest, signal },
					),
				);
				result = state;
				exitCode = state.publication === "accepted" ? 0 : 1;
				break;
			}
			case "cancel": {
				const outcome = await cancelVerifiedRun(stateRunPath(stateRoot, parsed.id ?? ""), {
					waitMs: waitMs(parsed),
				});
				result = { ...outcome, status: coordinator.status(outcome.runId) };
				exitCode = outcome.outcome === "pending" ? 1 : 0;
				break;
			}
			case "gc": {
				const report = collectVerifiedRuns(stateRoot, {
					olderThanMs: retention(parsed),
					execute: parsed.flags.has("--execute"),
				});
				result = report;
				exitCode = report.runs.some((entry) => entry.reason === "remove_failed") ? 1 : 0;
				break;
			}
			case "inspect":
				result = parsed.flags.has("--recovery")
					? coordinator.inspectRecovery(parsed.id ?? "")
					: parsed.flags.has("--writer-recovery")
						? coordinator.inspectWriterRecovery(parsed.id ?? "")
						: parsed.flags.has("--task-recovery")
							? coordinator.inspectTaskRecovery(parsed.id ?? "")
							: coordinator.inspect(parsed.id ?? "");
				break;
			case "status": {
				const status = coordinator.status(parsed.id ?? "");
				result = status;
				// Same truth the start/publish exit codes encode: a recovered,
				// quarantined or unverified run is never a clean exit 0.
				exitCode = status.cleanSuccess ? 0 : 1;
				break;
			}
			case "events":
				result = coordinator.events(parsed.id ?? "");
				break;
			case "authority":
				result = coordinator.inspectAuthority();
				break;
			case "evidence": {
				const projection = coordinator.evidenceRead(parsed.id ?? "");
				result = { ...projection.evidence, ...projection };
				exitCode = projection.authenticity === "valid" && projection.verification === "passed" ? 0 : 1;
				break;
			}
			case "artifact": {
				const candidate = required(parsed, "--candidate");
				const path = required(parsed, "--path");
				const bytes = coordinator.artifact(parsed.id ?? "", candidate, path);
				result = {
					candidateDigest: candidate,
					path,
					digest: digestBytes(bytes),
					byteCount: bytes.length,
					encoding: "base64",
					data: bytes.toString("base64"),
				};
				break;
			}
			default: {
				const exhaustive: never = parsed.action;
				throw new VerifiedRunError(String(exhaustive));
			}
		}
		process.stdout.write(`${JSON.stringify(result)}\n`);
		return { handled: true, exitCode };
	} catch (error) {
		const usage = error instanceof RunContractError || (error instanceof VerifiedRunError && error.code === "usage");
		const message =
			error instanceof VerifiedRunError || error instanceof RunContractError
				? error.message
				: operationFailure(error);
		process.stderr.write(`${message}\n${usage ? `${USAGE}\n` : ""}`);
		return { handled: true, exitCode: usage ? 2 : 1 };
	}
}
