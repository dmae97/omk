/**
 * Session compaction service: capture / barrier / repair / transaction / commit.
 *
 * Extracted from AgentSession so the session keeps lifecycle orchestration
 * (abort controllers, extension events, auth, model resolution) while this
 * owns the integrity-critical compaction state machine. Every method preserves
 * the exact semantics of the original session implementation — the
 * compaction-transaction / session-integrity suites pin them.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { repairTranscriptIntegrity } from "omk-agent-core";
import type { Api, Message, Model, ToolResultMessage } from "omk-ai";
import { type CompactionControlState, controlStateDigest, validateControlState } from "./compaction/control-state.ts";
import type { CompactionResult } from "./compaction/index.ts";
import { decideCommitOverInertTail } from "./compaction/inert-tail.ts";
import { buildPreservedProvenance, PROVENANCE_CUSTOM_TYPES } from "./compaction/provenance.ts";
import {
	type CompactionBarrierResult,
	type CompactionEnvelope,
	type CompactionSourceIdentity,
	type CompactionTransaction,
	createCompactionEnvelope,
	createCompactionSourceIdentity,
	createCompactionTransaction,
	evaluateCompactionBarrier,
	validateCompactionEnvelope,
} from "./compaction/transaction.ts";
import type { SessionIntegrityReport } from "./session-integrity.ts";
import { inspectSessionIntegrity } from "./session-integrity.ts";
import type { CompactionEntry, SessionEntry, SessionManager } from "./session-manager.ts";

export interface CapturedCompactionState {
	readonly report: SessionIntegrityReport;
	readonly branchEntries: readonly SessionEntry[];
	readonly revision: CompactionTransaction["baseRevision"];
	readonly source: CompactionSourceIdentity;
	/**
	 * Digest of the host control-state snapshot captured under the same commit
	 * lock as `source`. `null` when no control authority is attached. A change
	 * between capture and commit discards the summary like a source mismatch.
	 */
	readonly controlStateDigest: string | null;
	readonly controlState: CompactionControlState | null;
}

export interface BegunCompaction {
	readonly capture: CapturedCompactionState;
	readonly transaction: CompactionTransaction;
}

export interface CommittedCompaction {
	readonly entry: CompactionEntry;
	readonly envelope: CompactionEnvelope;
}

export interface SessionCompactionServiceDeps {
	readonly sessionManager: SessionManager;
	readonly pendingToolCallIds: () => ReadonlySet<string>;
	readonly getUserMessageText: (message: Message) => string;
	readonly cwd: string;
	/**
	 * Optional host control authority. Called inside the compaction commit lock
	 * so the snapshot is bound to the same captured source as the summary. Must
	 * be deterministic for unchanged state — a changed snapshot discards the
	 * in-flight summary at commit. Return `null` only when no authority exists.
	 */
	readonly controlState?: () => CompactionControlState | null;
	readonly invalidateContextBudget: () => void;
	/** Refresh agent messages from the session manager after tail repair/commit. */
	readonly refreshAgentMessages: () => void;
	/** Hysteresis bookkeeping after a successful commit. */
	readonly recordCommit: () => void;
}

export class SessionCompactionService {
	private readonly deps: SessionCompactionServiceDeps;

	constructor(deps: SessionCompactionServiceDeps) {
		this.deps = deps;
	}

	captureState(): CapturedCompactionState {
		return this.deps.sessionManager.withCompactionCommitLock(() => this.captureStateLocked(this.readSessionBytes()));
	}

	private readSessionBytes(): Uint8Array {
		const { sessionManager } = this.deps;
		const sessionFile = sessionManager.getSessionFile();
		return sessionFile && existsSync(sessionFile)
			? new Uint8Array(readFileSync(sessionFile))
			: new TextEncoder().encode(
					`${[sessionManager.getHeader(), ...sessionManager.getEntries()]
						.filter((entry) => entry !== null)
						.map((entry) => JSON.stringify(entry))
						.join("\n")}\n`,
				);
	}

	private captureStateLocked(bytes: Uint8Array): CapturedCompactionState {
		const { sessionManager } = this.deps;
		const report = inspectSessionIntegrity(bytes, { activeLeafId: sessionManager.getLeafId() });
		const branchEntries = report.activeBranch;
		let latestCompactionIndex = -1;
		for (let index = branchEntries.length - 1; index >= 0; index -= 1) {
			if (branchEntries[index]?.type === "compaction") {
				latestCompactionIndex = index;
				break;
			}
		}
		const latestCompaction = branchEntries[latestCompactionIndex];
		const firstKeptIndex =
			latestCompaction?.type === "compaction"
				? branchEntries.findIndex((entry) => entry.id === latestCompaction.firstKeptEntryId)
				: -1;
		const sourceEntries = branchEntries.slice(
			latestCompactionIndex < 0 ? 0 : firstKeptIndex < 0 ? latestCompactionIndex : firstKeptIndex,
		);
		const firstEntry = sourceEntries[0];
		const lastEntry = sourceEntries[sourceEntries.length - 1];
		if (!firstEntry || !lastEntry || report.activeLeafId === null) {
			const barrier = evaluateCompactionBarrier(report, [...this.deps.pendingToolCallIds()]);
			if (barrier.status !== "ready") throw this.barrierError(barrier);
			throw new Error("Nothing to compact: the active session branch is empty");
		}
		const revision = sessionManager.getDurableHeadToken();
		const source = createCompactionSourceIdentity({
			sessionId: revision.sessionId,
			entryIds: sourceEntries.map((entry) => entry.id),
			firstEntryId: firstEntry.id,
			lastEntryId: lastEntry.id,
			sourceSha256: createHash("sha256")
				.update(sourceEntries.map((entry) => JSON.stringify(entry)).join("\n"), "utf8")
				.digest("hex"),
			activeLeafId: report.activeLeafId,
			messageCount: report.activeMessages.length,
		});
		const controlState = validateControlState(this.deps.controlState?.() ?? null);
		return {
			report,
			branchEntries,
			revision,
			source,
			controlStateDigest: controlStateDigest(controlState),
			controlState,
		};
	}

	barrierError(barrier: CompactionBarrierResult): Error {
		if (barrier.status === "defer") {
			return new Error(`Compaction deferred until the transcript closes (${barrier.reason})`);
		}
		return new Error(
			`Compaction failed closed on transcript integrity (${barrier.reason}). Run the session doctor before retrying.`,
		);
	}

	evaluateBarrier(
		capture: CapturedCompactionState,
		includeMissingTailAsPending: boolean,
		excludedPendingIds: ReadonlySet<string> = new Set(),
	): CompactionBarrierResult {
		const pending = new Set([...this.deps.pendingToolCallIds()].filter((id) => !excludedPendingIds.has(id)));
		if (includeMissingTailAsPending) {
			for (const issue of capture.report.transcript?.issues ?? []) {
				if (issue.kind === "missing_result") pending.add(issue.toolCallId);
			}
		}
		return evaluateCompactionBarrier(capture.report, [...pending]);
	}

	repairEmergencyTail(capture: CapturedCompactionState): {
		readonly capture: CapturedCompactionState;
		readonly repairedToolCallIds: ReadonlySet<string>;
	} {
		const { sessionManager } = this.deps;
		const barrier = this.evaluateBarrier(capture, true);
		if (barrier.status !== "defer" || barrier.reason !== "missing_active_tail_results") {
			if (barrier.status !== "ready") throw this.barrierError(barrier);
			return { capture, repairedToolCallIds: new Set() };
		}
		const repairedMessages = repairTranscriptIntegrity(
			[...capture.report.activeMessages],
			"Tool result missing; synthesized to close an emergency compaction barrier",
		);
		const inserted = repairedMessages.slice(capture.report.activeMessages.length);
		const repairedToolCallIds = new Set<string>();
		for (const message of inserted) {
			if (message.role !== "toolResult") {
				throw new Error("Emergency compaction repair produced a non-tool result");
			}
			const toolResult: ToolResultMessage = message;
			repairedToolCallIds.add(toolResult.toolCallId);
			sessionManager.appendMessage(toolResult);
		}
		sessionManager.appendCustomEntry(PROVENANCE_CUSTOM_TYPES.compactionTranscriptRepaired, {
			insertedToolCallIds: [...repairedToolCallIds],
			reason: "emergency_compaction",
		});
		this.deps.invalidateContextBudget();
		const closedCapture = this.captureState();
		const closedBarrier = this.evaluateBarrier(closedCapture, false, repairedToolCallIds);
		if (closedBarrier.status !== "ready") throw this.barrierError(closedBarrier);
		this.deps.refreshAgentMessages();
		return { capture: closedCapture, repairedToolCallIds };
	}

	priorCommittedSourceDigests(): string[] {
		const digests: string[] = [];
		for (const entry of this.deps.sessionManager.getEntries()) {
			if (entry.type !== "compaction" || typeof entry.details !== "object" || entry.details === null) continue;
			if (Object.getOwnPropertyDescriptor(entry.details, "compactionEnvelope") === undefined) continue;
			const envelope = validateCompactionEnvelope(Reflect.get(entry.details, "compactionEnvelope"));
			if (envelope.summary !== entry.summary) {
				throw new Error(`Compaction entry ${entry.id} has invalid provenance. Run the session doctor.`);
			}
			digests.push(envelope.source.sourceSha256);
		}
		return digests;
	}

	beginTransaction(compactionModel: Model<Api>, emergency: boolean): BegunCompaction {
		let capture = this.captureState();
		if (emergency) {
			capture = this.repairEmergencyTail(capture).capture;
		} else {
			const barrier = this.evaluateBarrier(capture, false);
			if (barrier.status !== "ready") throw this.barrierError(barrier);
		}
		const transaction = createCompactionTransaction({
			transactionId: randomUUID(),
			baseRevision: capture.revision,
			source: capture.source,
			createdAt: new Date().toISOString(),
			model: { provider: compactionModel.provider, id: compactionModel.id },
			preserved: buildPreservedProvenance(capture, this.deps.getUserMessageText, this.deps.cwd),
		});
		if (this.priorCommittedSourceDigests().includes(transaction.source.sourceSha256)) {
			throw new Error("This exact compaction source was already compacted");
		}
		return { capture, transaction };
	}

	detailsWithEnvelope(details: unknown, envelope: CompactionEnvelope): unknown {
		if (typeof details === "object" && details !== null && !Array.isArray(details)) {
			return { ...details, compactionEnvelope: envelope };
		}
		return {
			compactionEnvelope: envelope,
			...(details === undefined ? {} : { resultDetails: details }),
		};
	}

	commit(begun: BegunCompaction, result: CompactionResult, fromExtension: boolean): CommittedCompaction {
		if (!begun.transaction.source.entryIds.includes(result.firstKeptEntryId)) {
			throw new Error("Compaction first-kept entry is outside the captured source");
		}
		const committed = this.deps.sessionManager.withCompactionCommitLock(() => {
			const bytes = this.readSessionBytes();
			const current = this.captureStateLocked(bytes);
			const barrier = this.evaluateBarrier(current, false);
			const { transaction, decision } = decideCommitOverInertTail({
				transaction: begun.transaction,
				currentRevision: current.revision,
				currentSource: current.source,
				currentBytes: bytes,
				barrier,
				priorCommittedSourceDigests: this.priorCommittedSourceDigests(),
				// Extension state written during summarization must not livelock compaction,
				// but an extension-provided summary may read that state: never rebase it.
				rebaseAllowed: !fromExtension,
			});
			switch (decision.decision) {
				case "duplicate":
					throw new Error("This exact compaction source was already compacted");
				case "stale":
					throw new Error(
						`Session changed during compaction (${decision.reason}); generated summary was discarded`,
					);
				case "defer":
				case "fail_closed":
					throw this.barrierError(barrier);
				case "commit": {
					if (current.controlStateDigest !== begun.capture.controlStateDigest) {
						throw new Error("Control state changed during compaction; generated summary was discarded");
					}
					const envelope = createCompactionEnvelope({
						transaction,
						decision,
						summary: result.summary,
						summarySha256: createHash("sha256").update(result.summary, "utf8").digest("hex"),
					});
					const entryId = this.deps.sessionManager.appendCompaction(
						result.summary,
						result.firstKeptEntryId,
						result.tokensBefore,
						this.detailsWithEnvelope(result.details, envelope),
						fromExtension,
					);
					const entry = this.deps.sessionManager.getEntry(entryId);
					if (!entry || entry.type !== "compaction") {
						throw new Error("Compaction commit did not produce a compaction entry");
					}
					return { entry, envelope };
				}
			}
		});
		this.deps.recordCommit();
		return committed;
	}
}
