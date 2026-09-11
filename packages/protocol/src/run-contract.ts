import { parseRunDagWriter, type RunDagWriter } from "./run-dag.ts";
import {
	RunContractError,
	runAbsolutePath,
	runArgv,
	runArray,
	runDigest,
	runId,
	runLimit,
	runObject,
	runRelativePath,
	runText,
} from "./run-parsing.ts";

export { RunContractError } from "./run-parsing.ts";
export const VERIFIED_RUN_VERSION = "omk.verified-run.v1" as const;
export const VERIFIED_COMMAND_VERSION = "omk.verified-command.v1" as const;

interface RunContractFields {
	readonly schemaVersion: typeof VERIFIED_RUN_VERSION;
	readonly runId: string;
	readonly goal: string;
	readonly workspace: { readonly root: string; readonly baseDigest: string };
	readonly writablePaths: readonly string[];
	readonly checks: readonly RunCheck[];
	readonly budget: RunPhaseBudget;
	readonly apply: "artifact-only";
}
export interface RunScriptedWriter {
	readonly kind: "scripted-agent";
	readonly steps: readonly (readonly string[])[];
	readonly maxRequests: number;
}
export type RunContract = RunContractFields &
	(
		| { readonly profile: "linux-command-v1"; readonly writer: readonly string[] }
		| { readonly profile: "linux-scripted-agent-v1"; readonly writer: RunScriptedWriter }
		| { readonly profile: "linux-command-dag-v1"; readonly writer: RunDagWriter }
	);
export interface RunCheck {
	readonly claimId: string;
	readonly argv: readonly string[];
	readonly stdout: string;
}
export interface RunPhaseBudget {
	readonly workMs: number;
	readonly verifyMs: number;
	readonly cleanupMs: number;
	readonly maxOutputBytes: number;
	readonly maxFiles: number;
	readonly maxBytes: number;
}
export interface RunStartCommand {
	readonly schemaVersion: typeof VERIFIED_COMMAND_VERSION;
	readonly kind: "start";
	readonly runId: string;
	readonly commandId: string;
	readonly expectedRevision: 0;
	readonly expectedGeneration: 0;
	readonly contractDigest: string;
}

function check(value: unknown): RunCheck {
	const input = runObject(value, ["claimId", "argv", "stdout"]);
	if (typeof input.stdout !== "string" || input.stdout.length > 65536) throw new RunContractError("stdout");
	return Object.freeze({ claimId: runId(input.claimId), argv: runArgv(input.argv), stdout: input.stdout });
}

export function parseRunContract(value: unknown): RunContract {
	const input = runObject(value, [
		"schemaVersion",
		"profile",
		"runId",
		"goal",
		"workspace",
		"writablePaths",
		"writer",
		"checks",
		"budget",
		"apply",
	]);
	if (input.schemaVersion !== VERIFIED_RUN_VERSION || input.apply !== "artifact-only")
		throw new RunContractError("version/profile/apply");
	const workspace = runObject(input.workspace, ["root", "baseDigest"]);
	const budget = runObject(input.budget, [
		"workMs",
		"verifyMs",
		"cleanupMs",
		"maxOutputBytes",
		"maxFiles",
		"maxBytes",
	]);
	const checks = runArray(input.checks, check, 32);
	if (new Set(checks.map((item) => item.claimId)).size !== checks.length)
		throw new RunContractError("duplicate claim");
	const writablePaths = runArray(input.writablePaths, runRelativePath, 128);
	if (new Set(writablePaths).size !== writablePaths.length) throw new RunContractError("duplicate path");
	const fields: RunContractFields = {
		schemaVersion: VERIFIED_RUN_VERSION,
		runId: runId(input.runId),
		goal: runText(input.goal, "goal", 16384),
		workspace: Object.freeze({ root: runAbsolutePath(workspace.root), baseDigest: runDigest(workspace.baseDigest) }),
		writablePaths,
		checks,
		apply: "artifact-only",
		budget: Object.freeze({
			workMs: runLimit(budget.workMs, "workMs"),
			verifyMs: runLimit(budget.verifyMs, "verifyMs"),
			cleanupMs: runLimit(budget.cleanupMs, "cleanupMs"),
			maxOutputBytes: runLimit(budget.maxOutputBytes, "maxOutputBytes", 1048576),
			maxFiles: runLimit(budget.maxFiles, "maxFiles", 10000),
			maxBytes: runLimit(budget.maxBytes, "maxBytes", 104857600),
		}),
	};
	switch (input.profile) {
		case "linux-command-v1":
			return Object.freeze({ ...fields, profile: input.profile, writer: runArgv(input.writer) });
		case "linux-command-dag-v1":
			return Object.freeze({
				...fields,
				profile: input.profile,
				writer: parseRunDagWriter(input.writer, writablePaths),
			});
		case "linux-scripted-agent-v1": {
			const writer = runObject(input.writer, ["kind", "steps", "maxRequests"]);
			if (writer.kind !== "scripted-agent") throw new RunContractError("writer.kind");
			return Object.freeze({
				...fields,
				profile: input.profile,
				writer: Object.freeze({
					kind: writer.kind,
					steps: runArray(writer.steps, runArgv, 16),
					maxRequests: runLimit(writer.maxRequests, "maxRequests", 32),
				}),
			});
		}
		default:
			throw new RunContractError("version/profile/apply");
	}
}

/** Parsing is not approval. The coordinator requires approval via its trusted host call. */
export function parseRunStartCommand(value: unknown): RunStartCommand {
	const input = runObject(value, [
		"schemaVersion",
		"kind",
		"runId",
		"commandId",
		"expectedRevision",
		"expectedGeneration",
		"contractDigest",
	]);
	if (
		input.schemaVersion !== VERIFIED_COMMAND_VERSION ||
		input.kind !== "start" ||
		input.expectedRevision !== 0 ||
		input.expectedGeneration !== 0
	)
		throw new RunContractError("command version/kind/precondition");
	return Object.freeze({
		schemaVersion: VERIFIED_COMMAND_VERSION,
		kind: "start",
		runId: runId(input.runId),
		commandId: runId(input.commandId),
		expectedRevision: 0,
		expectedGeneration: 0,
		contractDigest: runDigest(input.contractDigest),
	});
}
