import { lstatSync } from "node:fs";
import { join } from "node:path";
import type { AuthorityGrantRecord } from "./authority-events.ts";
import { readRunJournal } from "./journal.ts";
import { readRunClock, remainingRunTime } from "./recovery-clock.ts";
import type { RunProjection } from "./run-types.ts";
import { VerifiedRunError } from "./storage.ts";

/** Shared by grant compaction and workspace GC; an unknown clock is not elapsed time. */
export function runRecoveryHold(state: RunProjection): string | null {
	if (state.activeExecutionIds.length || state.writerOpen || state.settlement !== "settled") return "unsettled";
	if (state.publication === "intent" || state.publication === "reconciliation_required") return "publication_open";
	if (state.execution === "succeeded" || state.execution === "failed" || !state.budget) return null;
	try {
		return remainingRunTime(state.budget, state.budget.verifyCapMs, readRunClock()) === 0 ? null : "recoverable";
	} catch (error) {
		if (!(error instanceof VerifiedRunError)) throw error;
		return error.code === "clock_changed" ? null : "clock_unknown";
	}
}

/** Called with the authority lease held. Missing/damaged run evidence keeps a potentially recoverable grant. */
export function retainRunGrant(root: string, grant: AuthorityGrantRecord): boolean {
	if (
		grant.dispatchId !== grant.commandId ||
		!grant.claims.some((claim) => claim.namespace === "filesystem" && claim.instanceId === "verified-run")
	)
		return false;
	if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(grant.token.sessionId)) return true;
	try {
		const runPath = join(root, grant.token.sessionId);
		if (!lstatSync(runPath).isDirectory()) return true;
		const snapshot = readRunJournal(runPath);
		if (!snapshot || snapshot.state.runId !== grant.token.sessionId) return true;
		if (!snapshot.records.some(({ event }) => event.kind === "dispatch" && event.executionId === grant.commandId))
			return true;
		return runRecoveryHold(snapshot.state) !== null;
	} catch {
		return true;
	}
}
