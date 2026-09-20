/**
 * Algorithms E and G — conditional capability/calibration records and
 * drift-triggered demotion. Spec §8, §10.3.
 *
 * Records are per condition bucket: model revision + loaded skill content
 * fingerprints + toolchain version + task/effect/difficulty band + check
 * type/health + budget band + selection policy version. A bucket with too few
 * samples stays `insufficient-data`; a new provider revision, check
 * definition, or major library version demotes the bucket immediately,
 * without waiting for statistical detection.
 */
import { betaPosteriorMean, driftStatistic } from "./decision.ts";
import { canonical, ensure, finite, integer, lexical, member, text } from "./validation.ts";

export interface ConditionKey {
	readonly modelRevision: string;
	readonly skillHashes: readonly string[];
	readonly toolchain: string;
	readonly taskBand: string;
	readonly checkKind: string;
	readonly checkHealth: "healthy" | "degraded" | "unverified";
	readonly budgetBand: string;
	readonly policyVersion: string;
}
export type BucketState = "insufficient-data" | "active" | "demoted";
export interface CalibrationBucket {
	readonly key: ConditionKey;
	readonly keyHash: string;
	readonly priorAlpha: number;
	readonly priorBeta: number;
	successes: number;
	failures: number;
	drift: number;
	state: BucketState;
	readonly demotedReason?: string;
}
export interface CalibrationStore {
	readonly buckets: Readonly<Record<string, CalibrationBucket>>;
	readonly minSamples: number;
	readonly referenceMean: number;
	readonly slack: number;
	readonly threshold: number;
}

export function conditionKeyHash(key: ConditionKey): string {
	text(key.modelRevision, "modelRevision", 128);
	text(key.toolchain, "toolchain", 128);
	text(key.taskBand, "taskBand", 128);
	text(key.checkKind, "checkKind", 128);
	member(key.checkHealth, ["healthy", "degraded", "unverified"], "checkHealth");
	text(key.budgetBand, "budgetBand", 128);
	text(key.policyVersion, "policyVersion", 64);
	return canonical([
		key.modelRevision,
		[...key.skillHashes].sort(lexical),
		key.toolchain,
		key.taskBand,
		key.checkKind,
		key.checkHealth,
		key.budgetBand,
		key.policyVersion,
	]);
}

export function createCalibrationStore(options: {
	readonly minSamples: number;
	readonly priorAlpha: number;
	readonly priorBeta: number;
	readonly referenceMean: number;
	readonly slack: number;
	readonly threshold: number;
}): CalibrationStore {
	integer(options.minSamples, "minSamples", 100_000);
	finite(options.priorAlpha, "priorAlpha", 1e9);
	finite(options.priorBeta, "priorBeta", 1e9);
	ensure(options.priorAlpha > 0 && options.priorBeta > 0, "beta prior must be positive");
	finite(options.referenceMean, "referenceMean");
	finite(options.slack, "slack");
	finite(options.threshold, "threshold");
	return {
		buckets: {},
		minSamples: options.minSamples,
		referenceMean: options.referenceMean,
		slack: options.slack,
		threshold: options.threshold,
	};
}

function bucketFor(store: CalibrationStore, key: ConditionKey): CalibrationBucket {
	const keyHash = conditionKeyHash(key);
	return (
		store.buckets[keyHash] ?? {
			key,
			keyHash,
			priorAlpha: 1,
			priorBeta: 1,
			successes: 0,
			failures: 0,
			drift: 0,
			state: "insufficient-data",
		}
	);
}

/**
 * Record one independent task outcome. Never count 100 runs of one task as
 * 100 independent tasks; the caller supplies one pre-registered binary outcome
 * per task. Environment failures belong in delivery metrics, not here.
 */
export function recordOutcome(
	store: CalibrationStore,
	key: ConditionKey,
	outcome: "success" | "failure",
	loss: number,
): CalibrationStore {
	member(outcome, ["success", "failure"], "outcome");
	finite(loss, "loss");
	const bucket = bucketFor(store, key);
	if (bucket.state === "demoted") return store;
	const next: CalibrationBucket = {
		...bucket,
		successes: bucket.successes + (outcome === "success" ? 1 : 0),
		failures: bucket.failures + (outcome === "failure" ? 1 : 0),
		drift: driftStatistic(bucket.drift, loss, store.referenceMean, store.slack),
		state: bucket.successes + bucket.failures + 1 >= store.minSamples ? "active" : "insufficient-data",
	};
	const demoted = next.drift > store.threshold;
	return {
		...store,
		buckets: {
			...store.buckets,
			[next.keyHash]: demoted ? { ...next, state: "demoted", demotedReason: "drift-threshold" } : next,
		},
	};
}

/**
 * Demote every bucket whose condition changed underneath it: new model
 * revision, new check definition, or new major toolchain version. Explicit
 * condition changes never wait for statistical drift detection.
 */
export function demoteOnConditionChange(
	store: CalibrationStore,
	change: { modelRevision?: string; checkKind?: string; toolchain?: string; policyVersion?: string },
): CalibrationStore {
	const buckets: Record<string, CalibrationBucket> = {};
	for (const [hash, bucket] of Object.entries(store.buckets)) {
		const changed =
			(change.modelRevision !== undefined && bucket.key.modelRevision !== change.modelRevision) ||
			(change.checkKind !== undefined && bucket.key.checkKind !== change.checkKind) ||
			(change.toolchain !== undefined && bucket.key.toolchain !== change.toolchain) ||
			(change.policyVersion !== undefined && bucket.key.policyVersion !== change.policyVersion);
		buckets[hash] =
			changed && bucket.state !== "demoted"
				? { ...bucket, state: "demoted", demotedReason: "condition-change" }
				: bucket;
	}
	return { ...store, buckets };
}

/** Posterior mean success rate for one bucket, or `insufficient-data`. */
export function conditionalSuccessRate(
	store: CalibrationStore,
	key: ConditionKey,
): { state: BucketState; rate?: number; samples: number } {
	const bucket = store.buckets[conditionKeyHash(key)];
	if (!bucket) return { state: "insufficient-data", samples: 0 };
	const samples = bucket.successes + bucket.failures;
	if (bucket.state !== "active") return { state: bucket.state, samples };
	return {
		state: "active",
		samples,
		rate: betaPosteriorMean(bucket.priorAlpha, bucket.priorBeta, bucket.successes, bucket.failures),
	};
}
