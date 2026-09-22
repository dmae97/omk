import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { GitOperationBudget } from "./git-execution.ts";
import { casRef, GitRefCasError, OMK_ACCEPTED_REF, resolveRef, sealCandidateCommit } from "./git-plumbing.ts";
import { readGitNotice, readGitRequest, readGitStartGate, writeGitControl } from "./git-worker-protocol.ts";
import { VerifiedRunError } from "./storage.ts";

async function waitFor(path: string, budget: GitOperationBudget): Promise<void> {
	while (!existsSync(path)) {
		budget.remaining();
		await delay(5);
	}
	budget.remaining();
}

/** Fixed trusted worker. Request bytes are data; no plugin, model or tool discovery is performed. */
async function main(): Promise<void> {
	const path = process.argv[2];
	if (!path || !/^\/workspace\/\.git\/omk-publish-[A-Za-z0-9_-]+\/request\.json$/.test(path))
		throw new VerifiedRunError("git_worker_protocol");
	const stage = dirname(path);
	const request = readGitRequest(path);
	const remaining = Number((BigInt(request.deadlineNs) - process.hrtime.bigint()) / 1_000_000n);
	const budget = new GitOperationBudget({ timeoutMs: Math.min(request.timeoutMs, remaining) });
	const candidateOid = sealCandidateCommit("/workspace", request.input, budget);
	writeGitControl(join(stage, "prepared.json"), { kind: "prepared", candidateOid });
	await waitFor(join(stage, "cas-go.json"), budget);
	const go = readGitStartGate(join(stage, "cas-go.json"));
	if (go.kind !== "prepared" || go.candidateOid !== candidateOid) throw new VerifiedRunError("git_worker_protocol");
	let kind: "committed" | "ref-rejected" = "committed";
	try {
		casRef("/workspace", OMK_ACCEPTED_REF, candidateOid, request.input.parentOid, budget);
	} catch (error) {
		if (!(error instanceof GitRefCasError)) throw error;
		if (resolveRef("/workspace", OMK_ACCEPTED_REF) !== candidateOid) kind = "ref-rejected";
	}
	writeGitControl(join(stage, "result.json"), { kind, candidateOid });
	// Keep the namespace owned while the host observes CAS and persists its result.
	await waitFor(join(stage, "finish.json"), budget);
	const finish = readGitNotice(join(stage, "finish.json"));
	if (finish.kind !== kind || finish.candidateOid !== candidateOid) throw new VerifiedRunError("git_worker_protocol");
}

try {
	await main();
} catch {
	process.stderr.write("git_worker_failed\n");
	process.exitCode = 1;
}
