import { readFileSync, writeFileSync } from "node:fs";
import { RunCoordinator } from "../../src/core/run-execution-api.ts";
import { VerifiedRunJournal } from "../../src/core/verified-run/journal.ts";
import type { RunEvent } from "../../src/core/verified-run/run-types.ts";

const [stateRoot, contractPath, contractDigest, mode, checkpoint] = process.argv.slice(2);
if (!stateRoot || !contractPath || !contractDigest || !checkpoint) throw new Error("fixture arguments");
const append = VerifiedRunJournal.prototype.append;
VerifiedRunJournal.prototype.append = function (event: RunEvent) {
	const verifier = event.kind === "evaluated" || (event.kind === "exited" && this.state.candidateDigest !== null);
	const stop = () => {
		writeFileSync(checkpoint, "ready");
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
	};
	if (verifier && mode === "receipt-written" && event.kind === "evaluated") stop();
	const state = append.call(this, event);
	if (verifier && mode === "exit-written" && event.kind === "exited") stop();
	return state;
};
await new RunCoordinator(stateRoot).start(
	JSON.parse(readFileSync(contractPath, "utf8")),
	{
		schemaVersion: "omk.verified-command.v1",
		kind: "start",
		runId: "verifier",
		commandId: "start",
		expectedRevision: 0,
		expectedGeneration: 0,
		contractDigest,
	},
	{ approvedContractDigest: contractDigest },
);
