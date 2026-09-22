import { commandEnvironmentDigest } from "./broker.ts";
import { classifyEvidenceRead, type EvidenceRead } from "./evidence.ts";
import { requireRunJournal } from "./recovery-command.ts";
import { VerifiedRunError } from "./storage.ts";

/** Read-only projection. A missing current sandbox cannot invalidate a historical attestation. */
export function readEvidenceProjection(runPath: string): EvidenceRead {
	const journal = requireRunJournal(runPath);
	const first = journal.records[0]?.event;
	if (first?.kind !== "created") throw new VerifiedRunError("missing_run");
	let current: string | { status: "unsupported" | "unknown" };
	try {
		current = commandEnvironmentDigest(first.contract, journal.state.budget ? "gated-v1" : "legacy");
	} catch (error) {
		if (error instanceof VerifiedRunError)
			current = { status: error.code.startsWith("unsupported") ? "unsupported" : "unknown" };
		else if (
			error instanceof Error &&
			"code" in error &&
			["ENOENT", "ENOTDIR", "EACCES", "EIO"].includes(String(error.code))
		)
			current = { status: error.code === "ENOENT" || error.code === "ENOTDIR" ? "unsupported" : "unknown" };
		else throw error;
	}
	return classifyEvidenceRead(runPath, journal, current);
}
