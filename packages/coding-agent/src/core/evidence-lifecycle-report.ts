/** Spec 106 D1: the counts-only report for ONE session's evidence registry, plus the unattributed count. */
import {
	EVIDENCE_UNATTRIBUTED,
	type EvidenceArtifactRecord,
	type EvidenceHoldReason,
	type EvidenceLifecycleReport,
	type EvidenceProducer,
	type EvidenceProducerGroup,
	evidenceLifecycleDeleteEnabled,
	evidenceProcessRegistered,
	evidenceRegistryStats,
	listEvidenceArtifacts,
	type UnknownHoldShare,
} from "./evidence-lifecycle.ts";
import { evidenceHeldStats } from "./evidence-lifecycle-delete.ts";
import { currentEvidenceSession } from "./evidence-lifecycle-scope.ts";

const PRODUCER_GROUP: Readonly<Record<EvidenceProducer, EvidenceProducerGroup>> = {
	"goal-recall": "recall",
	"read-spill": "spill",
	"bash-spill": "spill",
	"tool-output-log": "bash",
	"bash-executor-log": "executor",
};

function share(unknown: number, present: number): number {
	return present === 0 ? 0 : Math.round((unknown / present) * 10_000) / 10_000;
}

function deletionField(sessionId: string, pendingReasons: Record<string, number>) {
	const pending = Object.values(pendingReasons).reduce((sum, n) => sum + n, 0);
	return { pending, pendingReasons, ...evidenceHeldStats(sessionId) };
}

export function evidenceLifecycleReport(sessionId: string = currentEvidenceSession()): EvidenceLifecycleReport {
	const groups: Record<EvidenceProducerGroup, { present: number; unknown: number }> = {
		recall: { present: 0, unknown: 0 },
		spill: { present: 0, unknown: 0 },
		bash: { present: 0, unknown: 0 },
		executor: { present: 0, unknown: 0 },
	};
	const byProducer: Partial<Record<EvidenceProducer, number>> = {};
	const presentBytesByProducer: Partial<Record<EvidenceProducer, number>> = {};
	const holdReasons: Partial<Record<EvidenceHoldReason, number>> = {};
	let [present, presentBytes, removed, unknown, blockedExhausted, deletes] = [0, 0, 0, 0, 0, 0];
	const pendingReasons: Record<string, number> = {};
	const would: EvidenceArtifactRecord[] = [];
	for (const record of listEvidenceArtifacts(sessionId)) {
		byProducer[record.producer] = (byProducer[record.producer] ?? 0) + 1;
		if (record.status === "deleted_after_use") deletes += 1;
		else if (record.status === "delete_pending" || record.status === "deleting") {
			const reason = record.deleteReason ?? record.status;
			pendingReasons[reason] = (pendingReasons[reason] ?? 0) + 1;
		} else if (record.status !== "present") removed += 1;
		if (record.status !== "present") {
			continue;
		}
		present += 1;
		presentBytes += record.bytes;
		presentBytesByProducer[record.producer] = (presentBytesByProducer[record.producer] ?? 0) + record.bytes;
		const group = groups[PRODUCER_GROUP[record.producer]];
		group.present += 1;
		if (record.holds.includes("unknown")) {
			group.unknown += 1;
			unknown += 1;
		}
		if (record.blockedExhausted) blockedExhausted += 1;
		for (const hold of record.holds) holdReasons[hold] = (holdReasons[hold] ?? 0) + 1;
		if (record.holds.length === 0) would.push(record);
	}
	const stats = evidenceRegistryStats(sessionId);
	return {
		mode: evidenceLifecycleDeleteEnabled() ? "delete" : "observe",
		registered: stats.registered,
		present,
		presentBytes,
		presentBytesByProducer,
		removedByExistingPolicy: removed,
		byProducer,
		holdReasons,
		unknownHoldShare: share(unknown, present),
		unknownHoldShareByProducer: Object.fromEntries(
			Object.entries(groups).map(([name, g]) => [name, { ...g, share: share(g.unknown, g.present) }]),
		) as Record<EvidenceProducerGroup, UnknownHoldShare>,
		blockedExhausted,
		wouldDelete: {
			count: would.length,
			bytes: would.reduce((sum, record) => sum + record.bytes, 0),
			artifactIds: would.map((record) => record.artifactId),
		},
		deletes,
		...(evidenceLifecycleDeleteEnabled() ? { deletion: deletionField(sessionId, pendingReasons) } : {}),
		overflow: stats.overflow,
		// Process-wide count of artifacts with no owning session; never merged into this session's counts.
		unattributed: sessionId === EVIDENCE_UNATTRIBUTED ? 0 : evidenceRegistryStats(EVIDENCE_UNATTRIBUTED).registered,
		processRegistered: evidenceProcessRegistered(),
	};
}
