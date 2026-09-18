import type { StrictEvidenceReport, StrictEvidenceSnapshot } from "./strict-evidence-types.ts";
import { parseStrictEvidenceSnapshot } from "./strict-evidence-validation.ts";
import type { ExecutionAttempt, JsonValue, Observation } from "./types.ts";

function canonical(value: JsonValue): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value !== null && typeof value === "object") {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonical((value as { readonly [key: string]: JsonValue })[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

/** Structural/integrity reduction only. The caller owns admission and snapshot completeness. */
export function evaluateStrictEvidence(
	value: StrictEvidenceSnapshot,
	observations: readonly Observation[],
	attempt: ExecutionAttempt,
): Omit<StrictEvidenceReport, "acceptance"> {
	const snapshot = parseStrictEvidenceSnapshot(value);
	const bindingKey = JSON.stringify(snapshot.binding);
	if (snapshot.binding.taskId !== attempt.taskId || snapshot.binding.candidateHash !== attempt.candidateHash) {
		throw new Error("Strict evidence binding does not match attempt");
	}
	const byId = new Map<string, Observation>();
	for (const observation of observations) {
		const old = byId.get(observation.observationId);
		if (old && canonical(old as unknown as JsonValue) !== canonical(observation as unknown as JsonValue)) {
			throw new Error("Conflicting observation identity");
		}
		byId.set(observation.observationId, observation);
	}
	const identities = new Map<string, string>();
	const unique = new Map<string, (typeof snapshot.results)[number]>();
	for (const result of snapshot.results) {
		const payload = JSON.stringify(result);
		for (const key of [
			`observation:${result.observationId}`,
			`execution:${result.executionId}`,
			`sequence:${result.sequence}`,
		]) {
			const old = identities.get(key);
			if (old !== undefined && old !== payload) throw new Error("Conflicting strict evidence identity or sequence");
			identities.set(key, payload);
		}
		const observation = byId.get(result.observationId);
		if (!observation) throw new Error("Strict completion references missing observation");
		const candidate = observation.facts.candidate;
		if (typeof candidate === "string" && candidate !== result.binding.candidateHash) {
			throw new Error("Strict evidence binding disagrees with observation candidate");
		}
		unique.set(result.observationId, result);
	}
	const selected: string[] = [];
	const missing: string[] = [];
	let failed = false;
	for (const checkId of [...snapshot.requiredCheckIds].sort()) {
		const history = [...unique.values()]
			.filter((r) => r.checkId === checkId && JSON.stringify(r.binding) === bindingKey)
			.sort((a, b) => a.sequence - b.sequence);
		for (const [index, result] of history.entries()) {
			if (result.previousExecutionId !== (index === 0 ? null : history[index - 1].executionId)) {
				throw new Error("Broken strict evidence attempt chain");
			}
		}
		const latest = history.at(-1);
		if (!latest) missing.push(checkId);
		else {
			selected.push(latest.observationId);
			failed ||= latest.verdict === "failed";
		}
	}
	return Object.freeze({
		policy: snapshot.policy,
		status:
			snapshot.pendingExecutionIds.length > 0
				? "pending"
				: failed
					? "violated"
					: missing.length > 0
						? "inconclusive"
						: "passed",
		observationIds: Object.freeze(selected.sort()),
		missingCheckIds: Object.freeze(missing),
	});
}
