import { type Adoption, type ProcurementReview, procureCandidate } from "./package-procurement.ts";
import {
	P0_PI_PACKAGE_PORT_CANDIDATES,
	P1_PI_PACKAGE_PORT_CANDIDATES,
	type PiPackageCandidateReviewInput,
	type PiPackageLane,
	type PiPackagePortCandidate,
} from "./pi-package-intake-candidates.ts";

export type {
	PiPackageCandidateReviewInput,
	PiPackageLane,
	PiPackagePortCandidate,
	PiPackagePortMode,
} from "./pi-package-intake-candidates.ts";
export { P0_PI_PACKAGE_PORT_CANDIDATES, P1_PI_PACKAGE_PORT_CANDIDATES } from "./pi-package-intake-candidates.ts";

/**
 * Combined default candidate set (P0 + P1). P1 was drawn from a full crawl of
 * pi.dev/packages (4653 unique packages) and is intentionally more conservative
 * (reference/measurement-gated/report-only only, never native) since no source-level
 * review has been run on any P1 candidate yet.
 */
export const ALL_PI_PACKAGE_PORT_CANDIDATES: readonly PiPackagePortCandidate[] = [
	...P0_PI_PACKAGE_PORT_CANDIDATES,
	...P1_PI_PACKAGE_PORT_CANDIDATES,
];

export interface PiPackageIntakeInput {
	readonly candidates?: readonly PiPackagePortCandidate[];
	readonly reviews?: readonly PiPackageCandidateReviewInput[];
	readonly now?: Date;
}

export interface PiPackageLaneSummary {
	readonly lane: PiPackageLane;
	readonly label: string;
	readonly total: number;
	readonly accepted: number;
	readonly deferred: number;
	readonly reject: number;
	readonly hardForkBlocked: number;
}

export interface PiPackageIntakeSummary {
	readonly total: number;
	readonly acceptedNative: number;
	readonly acceptedReference: number;
	readonly acceptedMeasurement: number;
	readonly deferred: number;
	readonly reject: number;
	readonly hardForkBlocked: number;
	readonly topLanes: readonly PiPackageLaneSummary[];
}

export interface PiPackageIntakeResult {
	readonly definition: PiPackagePortCandidate;
	readonly review: ProcurementReview;
	readonly hardForkBlocked: boolean;
	readonly hardForkReasons: readonly string[];
	readonly directPermanentPiAdoption: boolean;
}

export interface PiPackageIntakeReport {
	readonly results: readonly PiPackageIntakeResult[];
	readonly summary: PiPackageIntakeSummary;
}

const HARD_FORK_FINDING_KINDS = new Set([
	"legacy-home-path",
	"legacy-state-dir",
	"legacy-project-path",
	"legacy-package-path",
	"legacy-cli-invocation",
	"legacy-import",
]);

const DIRECT_PI_ADOPTION_BLOCKED = new Set<Adoption>(["permanent-package"]);

interface MutablePiPackageLaneSummary {
	lane: PiPackageLane;
	label: string;
	total: number;
	accepted: number;
	deferred: number;
	reject: number;
	hardForkBlocked: number;
}

export function evaluatePiPackageIntake(input: PiPackageIntakeInput = {}): PiPackageIntakeReport {
	const candidates = input.candidates ?? ALL_PI_PACKAGE_PORT_CANDIDATES;
	const reviewInputs = new Map((input.reviews ?? []).map((review) => [review.candidateId, review]));
	const results = candidates.map((definition) =>
		evaluatePiPackageCandidate(definition, reviewInputs.get(definition.id), input.now),
	);
	return { results, summary: summarizePiPackageIntake(results) };
}

export function evaluatePiPackageCandidate(
	definition: PiPackagePortCandidate,
	reviewInput?: PiPackageCandidateReviewInput,
	now?: Date,
): PiPackageIntakeResult {
	const review = procureCandidate({
		candidate: definition.candidate,
		declaredLicense: reviewInput?.declaredLicense ?? "MIT",
		packageJsonScripts: reviewInput?.packageJsonScripts,
		reviewedScriptAllowlist: reviewInput?.reviewedScriptAllowlist,
		sources: reviewInput?.sources,
		transitiveLicenses: reviewInput?.transitiveLicenses,
		now,
	});
	const hardForkReasons = hardForkBlockReasons(review);
	return {
		definition,
		review,
		hardForkBlocked: hardForkReasons.length > 0,
		hardForkReasons,
		directPermanentPiAdoption: isDirectPermanentPiAdoption(definition, review),
	};
}

export function summarizePiPackageIntake(results: readonly PiPackageIntakeResult[]): PiPackageIntakeSummary {
	const laneSummaries = new Map<PiPackageLane, MutablePiPackageLaneSummary>();
	let acceptedNative = 0;
	let acceptedReference = 0;
	let acceptedMeasurement = 0;
	let deferred = 0;
	let reject = 0;
	let hardForkBlocked = 0;

	for (const result of results) {
		const lane = laneSummaries.get(result.definition.lane) ?? laneSummaryFor(result);
		laneSummaries.set(result.definition.lane, lane);
		lane.total += 1;

		if (result.hardForkBlocked) {
			hardForkBlocked += 1;
			lane.hardForkBlocked += 1;
			continue;
		}

		if (result.review.adoption === "native") {
			acceptedNative += 1;
			lane.accepted += 1;
		} else if (result.review.adoption === "reference-only") {
			acceptedReference += 1;
			lane.accepted += 1;
		} else if (result.review.adoption === "measurement-gated") {
			acceptedMeasurement += 1;
			lane.accepted += 1;
		} else if (result.review.adoption === "deferred") {
			deferred += 1;
			lane.deferred += 1;
		} else if (result.review.adoption === "reject") {
			reject += 1;
			lane.reject += 1;
		}
	}

	return {
		total: results.length,
		acceptedNative,
		acceptedReference,
		acceptedMeasurement,
		deferred,
		reject,
		hardForkBlocked,
		topLanes: [...laneSummaries.values()].sort(compareLaneSummaries).map((lane) => ({ ...lane })),
	};
}

function hardForkBlockReasons(review: ProcurementReview): string[] {
	const reasons = review.compatibilityFindings
		.filter((finding) => finding.severity === "block" && HARD_FORK_FINDING_KINDS.has(finding.kind))
		.map((finding) => `${finding.kind}:${finding.path ?? "source"}:${finding.line}`);
	if (review.lifecycleVerdict === "reject") {
		reasons.push(...review.declaredLifecycleScripts.map((script) => `lifecycle-script:${script}`));
	}
	return [...new Set(reasons)];
}

function isDirectPermanentPiAdoption(definition: PiPackagePortCandidate, review: ProcurementReview): boolean {
	return definition.candidate.intendedUse === "permanent-adopt" || DIRECT_PI_ADOPTION_BLOCKED.has(review.adoption);
}

function laneSummaryFor(result: PiPackageIntakeResult): MutablePiPackageLaneSummary {
	return {
		lane: result.definition.lane,
		label: result.definition.laneLabel,
		total: 0,
		accepted: 0,
		deferred: 0,
		reject: 0,
		hardForkBlocked: 0,
	};
}

function compareLaneSummaries(a: PiPackageLaneSummary, b: PiPackageLaneSummary): number {
	const acceptedDelta = b.accepted - a.accepted;
	if (acceptedDelta !== 0) return acceptedDelta;
	const totalDelta = b.total - a.total;
	if (totalDelta !== 0) return totalDelta;
	return laneRank(a.lane) - laneRank(b.lane);
}

function laneRank(lane: PiPackageLane): number {
	return ALL_PI_PACKAGE_PORT_CANDIDATES.findIndex((candidate) => candidate.lane === lane);
}
