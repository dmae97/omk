/**
 * Spec 106 D1 session sink (flag `OMK_EVIDENCE_LIFECYCLE=observe` only): one versioned custom session entry
 * per settled prompt, so goal-less sessions are sampled too. A `custom` entry (not a custom message) is
 * never sent to the model. Digests and counts only; flag off writes nothing.
 */
import {
	dropEvidenceSession,
	type EvidenceLifecycleReport,
	evidenceLifecycleObserveEnabled,
} from "./evidence-lifecycle.ts";
import { evidenceLifecycleReport } from "./evidence-lifecycle-report.ts";
import { withEvidenceSession } from "./evidence-lifecycle-scope.ts";
import { SessionShutdown } from "./session-shutdown.ts";

export const EVIDENCE_LIFECYCLE_ENTRY_TYPE = "evidence_lifecycle";

export interface EvidenceLifecycleEntryData {
	readonly schemaVersion: 1;
	/** Each entry is the whole report so far, not a delta: analyse the last entry per session. */
	readonly aggregation: "cumulative";
	/** 0-based, monotonic per session (counts this session's earlier entries, so it survives resume). */
	readonly settleIndex: number;
	readonly report: EvidenceLifecycleReport;
}

export function appendEvidenceLifecycleEntry(sink: {
	appendCustomEntry(customType: string, data?: unknown): string;
	getEntries(): readonly { type: string; customType?: string }[];
	getSessionId(): string;
}): void {
	if (!evidenceLifecycleObserveEnabled()) return;
	try {
		const settleIndex = sink
			.getEntries()
			.filter((e) => e.type === "custom" && e.customType === EVIDENCE_LIFECYCLE_ENTRY_TYPE).length;
		const data: EvidenceLifecycleEntryData = {
			schemaVersion: 1,
			aggregation: "cumulative",
			settleIndex,
			report: evidenceLifecycleReport(sink.getSessionId()),
		};
		sink.appendCustomEntry(EVIDENCE_LIFECYCLE_ENTRY_TYPE, data);
	} catch {
		// Observation must never fail the prompt.
	}
}

interface SessionIdSource {
	getSessionId(): string;
}

interface OperationRunner {
	run<T>(operation: () => Promise<T>): Promise<T>;
}

/**
 * `runner.run(fn)` with `source`'s session as the owner of artifacts produced inside it.
 * Flag off: exactly `runner.run(fn)`.
 */
export function evidenceScope<T>(source: SessionIdSource, runner: OperationRunner, fn: () => Promise<T>): Promise<T> {
	if (!evidenceLifecycleObserveEnabled()) return runner.run(fn);
	return withEvidenceSession(source.getSessionId(), () => runner.run(fn));
}

/** Session disposed: drop its registry key (records only; files untouched). */
export function dropSessionEvidence(source: SessionIdSource): void {
	dropEvidenceSession(source.getSessionId());
}

type EvidenceSink = Parameters<typeof appendEvidenceLifecycleEntry>[0];

/**
 * `SessionShutdown` bound to one session's D1 evidence: `runEvidence` starts agent loops in the session's
 * evidence scope, `settled` appends the observe entry, and both finalize paths drop the registry key first.
 * Flag off: `runEvidence` is exactly `run`, `settled` writes nothing.
 */
export class EvidenceSessionShutdown extends SessionShutdown {
	private readonly sink: () => EvidenceSink;

	constructor(sink: () => EvidenceSink) {
		super();
		this.sink = sink;
	}

	runEvidence<T>(fn: () => Promise<T>): Promise<T> {
		return evidenceScope(this.sink(), this, fn);
	}

	settled(): void {
		appendEvidenceLifecycleEntry(this.sink());
	}

	private dropThen(finalize: () => void): () => void {
		return () => {
			dropSessionEvidence(this.sink());
			finalize();
		};
	}

	override closeSession(...args: Parameters<SessionShutdown["closeSession"]>): Promise<void> {
		const [source, owned, finalize] = args;
		return super.closeSession(source, owned, this.dropThen(finalize));
	}

	override disposeIdle(finalize: () => void): void {
		super.disposeIdle(this.dropThen(finalize));
	}
}
