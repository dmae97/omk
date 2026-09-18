import { runArray, runDigest, runLimit, runObject, runText } from "./run-parsing.ts";
import type {
	StrictEvidenceBinding,
	StrictEvidenceCompletion,
	StrictEvidenceSnapshot,
} from "./strict-evidence-types.ts";

export function parseStrictEvidenceBinding(value: unknown): StrictEvidenceBinding {
	const raw = runObject(value, [
		"taskId",
		"candidateHash",
		"contractDigest",
		"environmentDigest",
		"checkCodeDigest",
		"dependencyDigest",
		"generation",
		"verificationRound",
	]);
	return Object.freeze({
		taskId: runText(raw.taskId, "taskId"),
		candidateHash: runText(raw.candidateHash, "candidateHash"),
		contractDigest: runDigest(raw.contractDigest),
		environmentDigest: runDigest(raw.environmentDigest),
		checkCodeDigest: runDigest(raw.checkCodeDigest),
		dependencyDigest: runDigest(raw.dependencyDigest),
		generation: runLimit(raw.generation, "generation"),
		verificationRound: runLimit(raw.verificationRound, "verificationRound"),
	});
}

function completion(value: unknown): StrictEvidenceCompletion {
	const raw = runObject(value, [
		"observationId",
		"checkId",
		"binding",
		"sequence",
		"executionId",
		"previousExecutionId",
		"verdict",
	]);
	if (raw.verdict !== "passed" && raw.verdict !== "failed") throw new Error("Invalid strict evidence verdict");
	return Object.freeze({
		observationId: runText(raw.observationId, "observationId"),
		checkId: runText(raw.checkId, "checkId"),
		binding: parseStrictEvidenceBinding(raw.binding),
		sequence: runLimit(raw.sequence, "sequence", Number.MAX_SAFE_INTEGER),
		executionId: runText(raw.executionId, "executionId"),
		previousExecutionId:
			raw.previousExecutionId === null ? null : runText(raw.previousExecutionId, "previousExecutionId"),
		verdict: raw.verdict,
	});
}

export function parseStrictEvidenceSnapshot(value: unknown): StrictEvidenceSnapshot {
	const raw = runObject(value, ["policy", "binding", "requiredCheckIds", "pendingExecutionIds", "results"]);
	if (raw.policy !== "omk.strict-evidence.v1") throw new Error("Unsupported strict evidence policy");
	const requiredCheckIds = runArray(raw.requiredCheckIds, (v) => runText(v, "checkId"), 1024);
	if (new Set(requiredCheckIds).size !== requiredCheckIds.length) throw new Error("Duplicate required check ID");
	// runArray deliberately forbids empty arrays; these two collections may be empty.
	const pendingExecutionIds =
		Array.isArray(raw.pendingExecutionIds) && raw.pendingExecutionIds.length === 0
			? Object.freeze([])
			: runArray(raw.pendingExecutionIds, (v) => runText(v, "pendingExecutionId"), 10000);
	const results =
		Array.isArray(raw.results) && raw.results.length === 0
			? Object.freeze([])
			: runArray(raw.results, completion, 10000);
	return Object.freeze({
		policy: raw.policy,
		binding: parseStrictEvidenceBinding(raw.binding),
		requiredCheckIds,
		pendingExecutionIds,
		results,
	});
}
