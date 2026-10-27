/**
 * Spec 106 D1: which session owns an evidence artifact. AgentSession runs prompts and user bash inside
 * `withEvidenceSession(sessionId, …)`; producers (read/bash tools, executor, goal recall) read the owner
 * from this async context. No context ⇒ the explicit `unattributed` bucket, never another session.
 * Flag off (`OMK_EVIDENCE_LIFECYCLE=0`; default is `observe`) ⇒ the AsyncLocalStorage is never constructed or entered; `withEvidenceSession` just calls `fn`.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { evidenceLifecycleObserveEnabled } from "./evidence-lifecycle-types.ts";

export const EVIDENCE_UNATTRIBUTED = "unattributed";

let owner: AsyncLocalStorage<string> | undefined;
let runs = 0;

export function withEvidenceSession<T>(sessionId: string, fn: () => T): T {
	if (!evidenceLifecycleObserveEnabled()) return fn();
	owner ??= new AsyncLocalStorage<string>();
	runs += 1;
	return owner.run(sessionId, fn);
}

export function currentEvidenceSession(): string {
	return owner?.getStore() ?? EVIDENCE_UNATTRIBUTED;
}

/** Test seam: whether the store was ever constructed and how many times a scope was entered. */
export function evidenceScopeStatsForTest(): { readonly constructed: boolean; readonly runs: number } {
	return { constructed: owner !== undefined, runs };
}

/** Test seam: forget the store so a flag-off test can prove it is never constructed. */
export function resetEvidenceScopeForTest(): void {
	owner = undefined;
	runs = 0;
}
