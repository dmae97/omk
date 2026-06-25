import { describe, expect, it } from "vitest";
import { type RouteResult, routeDomain } from "../src/core/domain-router.ts";
import {
	DOMAIN_ROUTING_CORPUS,
	type DomainRoutingCategory,
	type DomainRoutingCorpusEntry,
} from "./fixtures/domain-routing-corpus.ts";

interface Verdict {
	readonly entry: DomainRoutingCorpusEntry;
	readonly result: RouteResult;
	readonly domainOK: boolean;
	readonly confidenceOK: boolean;
	readonly falseConfident: boolean;
	readonly absentSignalsOK: boolean;
}

interface Bucket {
	correct: number;
	total: number;
	acc: number;
}

interface Metrics {
	readonly n: number;
	readonly domainAccuracyMicro: number;
	readonly domainAccuracyMacro: number;
	readonly perDomain: Readonly<Record<string, Bucket>>;
	readonly confidenceAgreement: number;
	readonly falseConfidenceRate: number;
	readonly ambiguityRate: number;
	readonly fallbackAccuracy: number;
	readonly overRoutingRate: number;
	readonly byCategory: Readonly<Record<DomainRoutingCategory, Bucket>>;
}

const emptyCategoryBuckets = (): Record<DomainRoutingCategory, Bucket> => ({
	"clear-match": { correct: 0, total: 0, acc: 0 },
	borderline: { correct: 0, total: 0, acc: 0 },
	adversarial: { correct: 0, total: 0, acc: 0 },
	fallback: { correct: 0, total: 0, acc: 0 },
});

const scoreEntry = (entry: DomainRoutingCorpusEntry): Verdict => {
	const result = routeDomain({ task: entry.task, paths: entry.paths, tags: entry.tags });
	const domainOK = result.primary.id === entry.expectedDomain;
	const confidenceOK = entry.expectedConfidence === undefined || result.confidence === entry.expectedConfidence;
	const falseConfident = result.confidence === "confident" && !domainOK;
	const leaderSignals = result.scores[0]?.matchedSignals.join("\n") ?? "";
	const absentSignalsOK = (entry.absentLeaderSignalPatterns ?? []).every((pattern) => !pattern.test(leaderSignals));
	return { entry, result, domainOK, confidenceOK, falseConfident, absentSignalsOK };
};

const bucketAccuracy = (bucket: Bucket): Bucket => ({
	...bucket,
	acc: bucket.total === 0 ? 0 : bucket.correct / bucket.total,
});

const aggregate = (verdicts: readonly Verdict[]): Metrics => {
	const perDomain: Record<string, Bucket> = {};
	const byCategory = emptyCategoryBuckets();
	let domainCorrect = 0;
	let confidenceMatched = 0;
	let confidenceTotal = 0;
	let falseConfident = 0;
	let ambiguous = 0;
	let fallbackCorrect = 0;
	let fallbackTotal = 0;
	let overRouted = 0;

	for (const verdict of verdicts) {
		const { entry, result } = verdict;
		perDomain[entry.expectedDomain] ??= { correct: 0, total: 0, acc: 0 };
		perDomain[entry.expectedDomain].total += 1;
		byCategory[entry.category].total += 1;

		if (verdict.domainOK) {
			domainCorrect += 1;
			perDomain[entry.expectedDomain].correct += 1;
			byCategory[entry.category].correct += 1;
		}

		if (entry.expectedConfidence !== undefined) {
			confidenceTotal += 1;
			if (verdict.confidenceOK) confidenceMatched += 1;
		}

		if (verdict.falseConfident) falseConfident += 1;
		if (result.ambiguous) ambiguous += 1;

		if (entry.expectedDomain === "general") {
			fallbackTotal += 1;
			if (verdict.domainOK) fallbackCorrect += 1;
			else overRouted += 1;
		}
	}

	const perDomainWithAccuracy = Object.fromEntries(
		Object.entries(perDomain).map(([domain, bucket]) => [domain, bucketAccuracy(bucket)]),
	);
	const byCategoryWithAccuracy = Object.fromEntries(
		Object.entries(byCategory).map(([category, bucket]) => [category, bucketAccuracy(bucket)]),
	) as Record<DomainRoutingCategory, Bucket>;
	const domainAccuracies = Object.values(perDomainWithAccuracy).map((bucket) => bucket.acc);

	return {
		n: verdicts.length,
		domainAccuracyMicro: verdicts.length === 0 ? 0 : domainCorrect / verdicts.length,
		domainAccuracyMacro:
			domainAccuracies.length === 0
				? 0
				: domainAccuracies.reduce((total, accuracy) => total + accuracy, 0) / domainAccuracies.length,
		perDomain: perDomainWithAccuracy,
		confidenceAgreement: confidenceTotal === 0 ? 1 : confidenceMatched / confidenceTotal,
		falseConfidenceRate: verdicts.length === 0 ? 0 : falseConfident / verdicts.length,
		ambiguityRate: verdicts.length === 0 ? 0 : ambiguous / verdicts.length,
		fallbackAccuracy: fallbackTotal === 0 ? 1 : fallbackCorrect / fallbackTotal,
		overRoutingRate: fallbackTotal === 0 ? 0 : overRouted / fallbackTotal,
		byCategory: byCategoryWithAccuracy,
	};
};

const verdicts = DOMAIN_ROUTING_CORPUS.map(scoreEntry);
const metrics = aggregate(verdicts);

const failureSummary = (verdict: Verdict): string =>
	[
		`actual=${verdict.result.primary.id}`,
		`confidence=${verdict.result.confidence}`,
		`ambiguous=${String(verdict.result.ambiguous)}`,
		`scores=${verdict.result.scores.map((score) => `${score.id}:${score.score}`).join(",")}`,
		`notes=${verdict.entry.notes}`,
	].join(" / ");

describe("domain routing benchmark", () => {
	it("clear-match accuracy is 100%", () => {
		const clearMatch = metrics.byCategory["clear-match"];
		expect(clearMatch.correct, `${clearMatch.correct}/${clearMatch.total} clear-match entries passed`).toBe(
			clearMatch.total,
		);
	});

	it("false-confident rate stays at or below 0.05", () => {
		expect(metrics.falseConfidenceRate).toBeLessThanOrEqual(0.05);
	});

	it("general fallback over-routing rate stays at or below 0.20", () => {
		expect(metrics.overRoutingRate).toBeLessThanOrEqual(0.2);
	});

	it("critical case: plain email composition remains general", () => {
		const verdict = verdicts.find((candidate) => candidate.entry.id === "ge-005");
		expect(verdict?.result.primary.id).toBe("general");
	});

	it("critical case: query performance uses genuine backend signals, not orm substring", () => {
		const verdict = verdicts.find((candidate) => candidate.entry.id === "be-003");
		expect(verdict?.result.primary.id).toBe("backend-api");
		expect(verdict?.absentSignalsOK, verdict ? failureSummary(verdict) : "missing verdict").toBe(true);
	});

	it("critical case: unit tests for data model route to QA", () => {
		const verdict = verdicts.find((candidate) => candidate.entry.id === "qa-003");
		expect(verdict?.result.primary.id).toBe("qa-testing");
	});

	it("critical case: vector search with embeddings routes to data-science", () => {
		const verdict = verdicts.find((candidate) => candidate.entry.id === "ds-003");
		expect(verdict?.result.primary.id).toBe("data-science");
	});

	for (const verdict of verdicts) {
		it(`${verdict.entry.id}: routes ${JSON.stringify(verdict.entry.task)} to ${verdict.entry.expectedDomain}`, () => {
			expect(verdict.result.primary.id, failureSummary(verdict)).toBe(verdict.entry.expectedDomain);
			if (verdict.entry.expectedConfidence !== undefined) {
				expect(verdict.result.confidence, failureSummary(verdict)).toBe(verdict.entry.expectedConfidence);
			}
			expect(verdict.absentSignalsOK, failureSummary(verdict)).toBe(true);
		});
	}

	it("prints benchmark metric summary", () => {
		const failures = verdicts
			.filter((verdict) => !verdict.domainOK || !verdict.confidenceOK || !verdict.absentSignalsOK)
			.map((verdict) => ({
				id: verdict.entry.id,
				task: verdict.entry.task,
				expected: verdict.entry.expectedDomain,
				actual: verdict.result.primary.id,
				confidence: verdict.result.confidence,
				category: verdict.entry.category,
				ambiguous: verdict.result.ambiguous,
			}));
		console.log(`DOMAIN-ROUTING-BENCHMARK ${JSON.stringify({ metrics, failures }, null, 2)}`);
		expect(metrics.n).toBe(DOMAIN_ROUTING_CORPUS.length);
	});
});
