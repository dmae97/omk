import { join } from "node:path";
import type { RunCheck, RunContract } from "omk-protocol";
import { assertCredentialFreeEvidenceCommand } from "../../guardrails/command-redaction.ts";
import { createEvidenceReceipt, parseSha256Hex, validateEvidenceReceipt } from "../../guardrails/evidence-receipt.ts";
import { computeWorkspaceManifestSha256 } from "../../guardrails/workspace-fingerprint.ts";
import type {
	EvidenceCommandDescriptor,
	EvidenceReceipt,
	EvidenceReceiptDisposition,
	WorkspaceFingerprint,
} from "../../types/evidence.ts";
import { redactSensitiveTextForced } from "../redaction.ts";
import { canonicalJson } from "../run-journal.ts";
import type { SandboxOutcome } from "./broker.ts";
import type { CandidateManifest } from "./candidate.ts";
import type { CheckObservation } from "./evidence-binding.ts";
import { publishObject, readJson, VerifiedRunError } from "./storage.ts";

function command(check: RunCheck): EvidenceCommandDescriptor {
	const executable = check.argv[0];
	if (!executable) throw new VerifiedRunError("integrity");
	return { kind: "argv", executable, argv: check.argv.slice(1) };
}

export function preflightCheckReceipts(contract: RunContract): void {
	for (const check of contract.checks) assertCredentialFreeEvidenceCommand(command(check));
}

function fingerprint(manifest: CandidateManifest): WorkspaceFingerprint {
	const files = [...manifest.files].sort((left, right) =>
		left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
	);
	const scope = { root: "/workspace", artifactPaths: files.map((file) => file.path) };
	const artifacts = files.map((file) => ({
		path: file.path,
		state: "file" as const,
		sha256: parseSha256Hex(file.digest),
		size: file.size,
	}));
	return { kind: "artifact-set", scope, artifacts, manifestSha256: computeWorkspaceManifestSha256(scope, artifacts) };
}

function disposition(result: Pick<SandboxOutcome, "failure" | "exitCode">): EvidenceReceiptDisposition {
	if (result.failure === "deadline") return { status: "timeout", exitCode: null };
	if (result.failure === "cancelled" || result.failure === "output_limit" || result.exitCode === null)
		return { status: "aborted", exitCode: null };
	return result.exitCode === 0 ? { status: "passed", exitCode: 0 } : { status: "failed", exitCode: result.exitCode };
}

export function storeCheckReceipt(
	runPath: string,
	contract: RunContract,
	execution: {
		readonly check: RunCheck;
		readonly executionId: string;
		readonly result: SandboxOutcome;
		readonly timeoutMs: number;
		readonly manifest: CandidateManifest;
	},
): string {
	const workspace = fingerprint(execution.manifest);
	const result = execution.result;
	const receipt = createEvidenceReceipt({
		receiptId: execution.executionId,
		goalId: contract.runId,
		claim: `Exact stdout for ${execution.check.claimId}`,
		command: command(execution.check),
		cwd: "/workspace",
		timeoutMs: execution.timeoutMs,
		startedAt: result.startedAt,
		finishedAt: result.finishedAt,
		durationMs: Date.parse(result.finishedAt) - Date.parse(result.startedAt),
		workspaceBefore: workspace,
		workspaceAfter: workspace,
		executor: "internal",
		toolCallId: execution.executionId,
		alreadyRedactedOutput: {
			redactionPolicyId: "omk-verified-run-v1+forced-text+prefix-32k-per-stream",
			stdout: Buffer.from(redactSensitiveTextForced(result.stdout.toString("utf8"))).subarray(0, 32768),
			stderr: Buffer.from(redactSensitiveTextForced(result.stderr.toString("utf8"))).subarray(0, 32768),
		},
		...disposition(result),
	});
	publishObject(join(runPath, "receipts", `${receipt.envelope.coreSha256}.json`), receipt);
	return receipt.envelope.coreSha256;
}

export function readCheckReceipts(
	runPath: string,
	contract: RunContract,
	binding: {
		readonly manifest: CandidateManifest;
		readonly checks: readonly CheckObservation[];
	},
): readonly EvidenceReceipt[] {
	const workspace = fingerprint(binding.manifest);
	return Object.freeze(
		binding.checks.map((observation) => {
			const digest = observation.receiptCoreDigest;
			if (!digest || !/^[a-f0-9]{64}$/.test(digest)) throw new VerifiedRunError("integrity");
			const receipt = validateEvidenceReceipt(readJson(join(runPath, "receipts", `${digest}.json`), 8388608));
			const core = receipt.core;
			const check = contract.checks.find((item) => item.claimId === observation.claimId);
			const expected = disposition(observation);
			if (
				!check ||
				canonicalJson(receipt.envelope) !== canonicalJson({ coreSha256: digest }) ||
				core.receiptId !== observation.executionId ||
				core.toolCallId !== observation.executionId ||
				core.goalId !== contract.runId ||
				core.executor !== "internal" ||
				core.claim !== `Exact stdout for ${check.claimId}` ||
				core.cwd !== "/workspace" ||
				core.status !== expected.status ||
				core.exitCode !== expected.exitCode ||
				core.timeoutMs === null ||
				core.timeoutMs > contract.budget.verifyMs ||
				canonicalJson(core.command) !== canonicalJson(command(check)) ||
				canonicalJson(core.workspaceBefore) !== canonicalJson(workspace) ||
				canonicalJson(core.workspaceAfter) !== canonicalJson(workspace)
			)
				throw new VerifiedRunError("integrity");
			return receipt;
		}),
	);
}
