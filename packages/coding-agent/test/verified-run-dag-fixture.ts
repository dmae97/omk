import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { planVerifiedRun, RunCoordinator } from "../src/core/run-execution-api.ts";

export function dagFixture(root: string, fail = false) {
	const workspace = join(root, "workspace");
	const stateRoot = join(root, "state");
	mkdirSync(workspace);
	writeFileSync(join(workspace, "input"), "original");
	const right = ["/bin/sh", "-c", "test ! -e left && tr a-z A-Z < input > right"];
	const contract = {
		schemaVersion: "omk.verified-run.v1",
		profile: "linux-command-dag-v1",
		runId: "dag",
		goal: "Join independent outputs",
		workspace: { root: workspace, baseDigest: "0".repeat(64) },
		writablePaths: ["left", "right", "joined"],
		writer: {
			kind: "command-dag",
			tasks: [
				{ id: "left", dependsOn: [], writablePaths: ["left"], attempts: [["/bin/cp", "input", "left"]] },
				{
					id: "right",
					dependsOn: [],
					writablePaths: ["right"],
					attempts: fail ? [["/bin/sh", "-c", "printf partial > right; exit 1"], right] : [right],
				},
				{
					id: "join",
					dependsOn: ["left", "right"],
					writablePaths: ["joined"],
					attempts: [["/bin/sh", "-c", "cat left right > joined"]],
				},
			],
		},
		checks: [{ claimId: "joined", argv: ["/bin/cat", "joined"], stdout: "originalORIGINAL" }],
		// cleanupMs bounds how long the broker waits to confirm a SIGKILL'd sandbox
		// child was reaped. Falling short fail-closes to `unsettled` -> `quarantined`,
		// which is right in production but makes the cancel test — which asserts the
		// drained/settled path — fail when vitest reaps many children at once. The
		// timer is armed only on stop() and cleared on close, so a larger budget
		// costs nothing on paths that settle normally. Kept in line with verifyMs.
		budget: { workMs: 30000, verifyMs: 5000, cleanupMs: 15000, maxOutputBytes: 4096, maxFiles: 100, maxBytes: 65536 },
		apply: "artifact-only",
	};
	contract.workspace.baseDigest = planVerifiedRun(contract).baseDigest;
	const plan = planVerifiedRun(contract);
	const approval = { approvedContractDigest: plan.contractDigest };
	const command = {
		schemaVersion: "omk.verified-command.v1",
		kind: "start",
		runId: "dag",
		commandId: "start",
		expectedRevision: 0,
		expectedGeneration: 0,
		contractDigest: plan.contractDigest,
	};
	return {
		workspace,
		stateRoot,
		runPath: join(stateRoot, "dag"),
		contract,
		plan,
		approval,
		command,
		coordinator: new RunCoordinator(stateRoot),
	};
}
