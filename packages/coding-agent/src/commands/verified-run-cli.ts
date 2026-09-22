import { join } from "node:path";
import { parseRunContract, RunContractError, VERIFIED_COMMAND_VERSION } from "omk-protocol";
import { getAgentDir } from "../config.ts";
import { planVerifiedRun, RunCoordinator } from "../core/verified-run/coordinator.ts";
import { publishPolicyDigest } from "../core/verified-run/run-publish.ts";
import type { VerifiedRunRuntime } from "../core/verified-run/session-port.ts";
import { digestBytes, readJson, VerifiedRunError } from "../core/verified-run/storage.ts";
import { withRunSignal } from "./verified-run-signal.ts";

const USAGE = `Usage: omk run plan --contract FILE [--json]
       omk run start --contract FILE --approve DIGEST --command-id ID [--state-dir DIR]
       omk run inspect|evidence|status|events ID [--state-dir DIR] [--json]
       omk run authority [--state-dir DIR] [--json]
       omk run inspect ID --recovery|--writer-recovery|--task-recovery [--state-dir DIR]
       omk run retry-tasks ID --execute --tasks ID[,ID...]|- --approve DIGEST --base DIGEST --revision N --generation N --command-id ID [--state-dir DIR]
       omk run restart-writer ID --execute --approve DIGEST --base DIGEST --revision N --generation N --command-id ID [--state-dir DIR]
       omk run resume ID --execute --approve DIGEST --candidate DIGEST --revision N --generation N --command-id ID [--state-dir DIR]
       omk run publish ID --execute --contract FILE --approve DIGEST --candidate DIGEST --parent OID --receipt DIGEST --revision N --generation N --command-id ID [--state-dir DIR]
       omk run artifact ID --candidate DIGEST --path PATH [--state-dir DIR]
The opt-in command, scripted-agent and bounded command-DAG profiles never apply changes to the original workspace.
Resume rechecks a fixed candidate. Writer/task recovery preserves input checkpoints and budgets. Command-DAG concurrency defaults to 1 and supports an explicit cap of 2. Plan amendment, managed apply and TUI/RPC control are not implemented.`;

interface Parsed {
	readonly action:
		| "plan"
		| "start"
		| "resume"
		| "restart-writer"
		| "retry-tasks"
		| "publish"
		| "inspect"
		| "status"
		| "events"
		| "authority"
		| "evidence"
		| "artifact";
	readonly id: string | undefined;
	readonly flags: ReadonlyMap<string, string>;
}

function parse(args: readonly string[]): Parsed {
	const action = args[1];
	if (
		action !== "plan" &&
		action !== "start" &&
		action !== "resume" &&
		action !== "restart-writer" &&
		action !== "retry-tasks" &&
		action !== "publish" &&
		action !== "inspect" &&
		action !== "status" &&
		action !== "events" &&
		action !== "authority" &&
		action !== "evidence" &&
		action !== "artifact"
	)
		throw new VerifiedRunError("usage");
	const hasId = action !== "plan" && action !== "start" && action !== "authority";
	const id = hasId ? args[2] : undefined;
	if (hasId && (!id || id.startsWith("--"))) throw new VerifiedRunError("usage");
	const allowed =
		action === "plan"
			? ["--contract", "--json"]
			: action === "start"
				? ["--contract", "--approve", "--command-id", "--state-dir", "--json"]
				: action === "resume" || action === "restart-writer" || action === "retry-tasks"
					? [
							"--execute",
							"--approve",
							action === "resume" ? "--candidate" : "--base",
							...(action === "retry-tasks" ? ["--tasks"] : []),
							"--revision",
							"--generation",
							"--command-id",
							"--state-dir",
							"--json",
						]
					: action === "publish"
						? [
								"--execute",
								"--contract",
								"--approve",
								"--candidate",
								"--parent",
								"--receipt",
								"--revision",
								"--generation",
								"--command-id",
								"--state-dir",
								"--json",
							]
						: action === "artifact"
							? ["--candidate", "--path", "--state-dir", "--json"]
							: action === "inspect"
								? ["--state-dir", "--json", "--recovery", "--writer-recovery", "--task-recovery"]
								: ["--state-dir", "--json"];
	const flags = new Map<string, string>();
	for (let index = hasId ? 3 : 2; index < args.length; index++) {
		const flag = args[index];
		if (!allowed.includes(flag) || flags.has(flag)) throw new VerifiedRunError("usage");
		const value = ["--json", "--execute", "--recovery", "--writer-recovery", "--task-recovery"].includes(flag)
			? "true"
			: args[++index];
		if (!value || value.startsWith("--")) throw new VerifiedRunError("usage");
		flags.set(flag, value);
	}
	if (["--recovery", "--writer-recovery", "--task-recovery"].filter((flag) => flags.has(flag)).length > 1)
		throw new VerifiedRunError("usage");
	return { action, id, flags };
}

function required(parsed: Parsed, name: string): string {
	const value = parsed.flags.get(name);
	if (!value) throw new VerifiedRunError("usage");
	return value;
}

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
		const coordinator = new RunCoordinator(
			parsed.flags.get("--state-dir") ?? join(getAgentDir(), "verified-runs"),
			runtime,
		);
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
				const state = await withRunSignal((signal) =>
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
				const state = await withRunSignal((signal) =>
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
				const state = await withRunSignal((signal) =>
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
				: "verified-run: operation_failed";
		process.stderr.write(`${message}\n${usage ? `${USAGE}\n` : ""}`);
		return { handled: true, exitCode: usage ? 2 : 1 };
	}
}
