/**
 * Confidence calibration helpers for reasoning-router governance.
 *
 * Pure, deterministic, dependency-free exports. Callers pass bounded classifier
 * verdict fields only (predicted/expected class, confidence, confidenceBand);
 * this module never reads prompts and never performs I/O.
 */

export type CalibrationConfidenceBand = "low" | "medium" | "high";

export interface CalibrationSample<ClassName extends string = string> {
	readonly predicted: ClassName;
	readonly expected: ClassName;
	readonly confidence: number;
	readonly confidenceBand: CalibrationConfidenceBand;
}

export interface CalibrationBinMetrics {
	readonly binIndex: number;
	readonly lowerBound: number;
	readonly upperBound: number;
	readonly count: number;
	readonly accuracy: number;
	readonly meanConfidence: number;
	readonly calibrationGap: number;
}

export interface ConfidenceBandErrorRate {
	readonly band: CalibrationConfidenceBand;
	readonly count: number;
	readonly correct: number;
	readonly incorrect: number;
	readonly accuracy: number;
	readonly errorRate: number;
	readonly meanConfidence: number;
}


export interface GapCardSample<ClassName extends string = string> {
	readonly predicted: ClassName;
	readonly expected: ClassName;
	readonly confidenceBand: CalibrationConfidenceBand;
	readonly featureTags: readonly string[];
}

export interface GapCard<ClassName extends string = string> {
	readonly expected: ClassName;
	readonly predicted: ClassName;
	readonly featureTag: string;
	readonly confidenceBand: CalibrationConfidenceBand;
	readonly count: number;
}

export interface CalibrationMetrics {
	readonly sampleCount: number;
	readonly expectedCalibrationError: number;
	readonly maximumCalibrationError: number;
	readonly brierScore: number;
	readonly bins: readonly CalibrationBinMetrics[];
	readonly bandErrorRates: readonly ConfidenceBandErrorRate[];
}

const CONFIDENCE_BANDS: readonly CalibrationConfidenceBand[] = ["low", "medium", "high"];

interface MutableBucket {
	count: number;
	correct: number;
	confidenceSum: number;
}

function assertValidSample(sample: CalibrationSample): void {
	if (!Number.isFinite(sample.confidence) || sample.confidence < 0 || sample.confidence > 1) {
		throw new RangeError(`calibration: confidence must be in [0, 1], got ${sample.confidence}`);
	}
}

function makeBucket(): MutableBucket {
	return { count: 0, correct: 0, confidenceSum: 0 };
}

function bucketAccuracy(bucket: MutableBucket): number {
	return bucket.count === 0 ? 0 : bucket.correct / bucket.count;
}

function bucketMeanConfidence(bucket: MutableBucket): number {
	return bucket.count === 0 ? 0 : bucket.confidenceSum / bucket.count;
}

function binIndexForConfidence(confidence: number, binCount: number): number {
	return Math.min(binCount - 1, Math.floor(confidence * binCount));
}

export function computeCalibrationMetrics(
	samples: readonly CalibrationSample[],
	binCount = 10,
): CalibrationMetrics {
	if (!Number.isInteger(binCount) || binCount <= 0) {
		throw new RangeError(`calibration: binCount must be a positive integer, got ${binCount}`);
	}

	const bins: MutableBucket[] = Array.from({ length: binCount }, makeBucket);
	const bands: Record<CalibrationConfidenceBand, MutableBucket> = {
		low: makeBucket(),
		medium: makeBucket(),
		high: makeBucket(),
	};
	let brierSum = 0;

	for (const sample of samples) {
		assertValidSample(sample);
		const correctness = sample.predicted === sample.expected ? 1 : 0;
		const confidenceError = sample.confidence - correctness;
		brierSum += confidenceError * confidenceError;

		const bin = bins[binIndexForConfidence(sample.confidence, binCount)];
		bin.count += 1;
		bin.correct += correctness;
		bin.confidenceSum += sample.confidence;

		const band = bands[sample.confidenceBand];
		band.count += 1;
		band.correct += correctness;
		band.confidenceSum += sample.confidence;
	}

	const binMetrics = bins.map((bucket, binIndex) => {
		const accuracy = bucketAccuracy(bucket);
		const meanConfidence = bucketMeanConfidence(bucket);
		return {
			binIndex,
			lowerBound: binIndex / binCount,
			upperBound: (binIndex + 1) / binCount,
			count: bucket.count,
			accuracy,
			meanConfidence,
			calibrationGap: bucket.count === 0 ? 0 : Math.abs(accuracy - meanConfidence),
		};
	});

	const sampleCount = samples.length;
	const expectedCalibrationError = binMetrics.reduce(
		(sum, bin) => sum + (sampleCount === 0 ? 0 : (bin.count / sampleCount) * bin.calibrationGap),
		0,
	);
	const maximumCalibrationError = binMetrics.reduce((max, bin) => Math.max(max, bin.calibrationGap), 0);
	const bandErrorRates = CONFIDENCE_BANDS.map((band) => {
		const bucket = bands[band];
		const accuracy = bucketAccuracy(bucket);
		return {
			band,
			count: bucket.count,
			correct: bucket.correct,
			incorrect: bucket.count - bucket.correct,
			accuracy,
			errorRate: bucket.count === 0 ? 0 : 1 - accuracy,
			meanConfidence: bucketMeanConfidence(bucket),
		};
	});

	return {
		sampleCount,
		expectedCalibrationError,
		maximumCalibrationError,
		brierScore: sampleCount === 0 ? 0 : brierSum / sampleCount,
		bins: binMetrics,
		bandErrorRates,
	};
}


interface MutableGapCard<ClassName extends string> {
	expected: ClassName;
	predicted: ClassName;
	featureTag: string;
	confidenceBand: CalibrationConfidenceBand;
	count: number;
}

const UNTAGGED_GAP_CARD_FEATURE = "(untagged)";

function gapCardKey(
	expected: string,
	predicted: string,
	featureTag: string,
	confidenceBand: CalibrationConfidenceBand,
): string {
	return `${expected}\u0000${predicted}\u0000${featureTag}\u0000${confidenceBand}`;
}

export function buildGapCards<ClassName extends string>(
	samples: readonly GapCardSample<ClassName>[],
): readonly GapCard<ClassName>[] {
	const cards = new Map<string, MutableGapCard<ClassName>>();
	for (const sample of samples) {
		if (sample.predicted === sample.expected) continue;
		const featureTags = sample.featureTags.length === 0 ? [UNTAGGED_GAP_CARD_FEATURE] : sample.featureTags;
		for (const featureTag of featureTags) {
			const key = gapCardKey(sample.expected, sample.predicted, featureTag, sample.confidenceBand);
			const existing = cards.get(key);
			if (existing === undefined) {
				cards.set(key, {
					expected: sample.expected,
					predicted: sample.predicted,
					featureTag,
					confidenceBand: sample.confidenceBand,
					count: 1,
				});
			} else {
				existing.count += 1;
			}
		}
	}
	return [...cards.values()]
		.sort(
			(a, b) =>
				b.count - a.count ||
				a.expected.localeCompare(b.expected) ||
				a.predicted.localeCompare(b.predicted) ||
				a.featureTag.localeCompare(b.featureTag) ||
				a.confidenceBand.localeCompare(b.confidenceBand),
		)
		.map((card) => ({
			expected: card.expected,
			predicted: card.predicted,
			featureTag: card.featureTag,
			confidenceBand: card.confidenceBand,
			count: card.count,
		}));
}
