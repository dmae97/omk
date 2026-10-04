import {
	assertReviewIdentifier,
	buildReviewRequest,
	type ReviewEvidenceInput,
	type ReviewSpecItem,
	reviewSha256,
} from "./review-evidence.ts";
import { reviewTimeout } from "./review-poll.ts";

export interface ReviewRevalidationPlan {
	readonly packetId: string;
	readonly specRevision: string;
	readonly specSha256: string;
	readonly diffSha256: string;
	readonly items: readonly {
		readonly spec: ReviewSpecItem;
		readonly instruction: string;
		readonly minimumBoundaryCases: 2;
	}[];
	readonly canApply: false;
	readonly shouldSubmit: false;
}

export interface PreparedBoundaryTest {
	readonly id: string;
	readonly specItemId: string;
	readonly boundary: string;
	readonly testSource: string;
	readonly command: string;
}

export interface ExecutedBoundaryTest {
	readonly testId: string;
	readonly testSourceSha256: string;
	readonly command: string;
	readonly output: string;
	readonly exitCode: number;
	readonly outcome: "passed" | "failed" | "skipped";
	readonly assertionCount: number;
	readonly executedAt: string;
}

/** Application-owned coding/test tools; no hosted shell, auto-installed tools, or inferred authorization. */
export interface AuthorizedReviewTestExecutor {
	readonly authorization: {
		readonly packetId: string;
		readonly specRevision: string;
		readonly specSha256: string;
		readonly diffSha256: string;
		readonly writeAndExecuteAllowed: true;
	};
	prepare(plan: ReviewRevalidationPlan): Promise<readonly PreparedBoundaryTest[]>;
	execute(test: PreparedBoundaryTest): Promise<ExecutedBoundaryTest>;
}

export interface ReviewRevalidationResult {
	readonly state: "blocked" | "execution_unknown" | "tests_failed" | "evidence_ready";
	readonly reason: string;
	readonly plan: ReviewRevalidationPlan;
	readonly prepared: readonly PreparedBoundaryTest[];
	readonly executions: readonly ExecutedBoundaryTest[];
	/** Evidence-ready still needs adjudication; it is never permission to apply/submit. */
	readonly canApply: false;
	readonly shouldSubmit: false;
}

/** Plan only: no claim that tests were written or executed. */
export function createReviewRevalidationPlan(input: ReviewEvidenceInput): ReviewRevalidationPlan {
	const request = buildReviewRequest(input);
	return {
		packetId: request.packetId,
		specRevision: request.specRevision,
		specSha256: request.specSha256,
		diffSha256: request.diffSha256,
		items: input.specification.map((spec) => ({
			spec: { ...spec },
			minimumBoundaryCases: 2,
			instruction:
				"Write at least two distinct boundary-case tests for this exact requirement, including an invalid/edge case and a valid boundary. Use the project's authorized coding/test tools. Record source, exact command, actual output, and exit code. Do not claim hidden-test coverage.",
		})),
		canApply: false,
		shouldSubmit: false,
	};
}

function validatePrepared(plan: ReviewRevalidationPlan, tests: readonly PreparedBoundaryTest[]): void {
	if (!Array.isArray(tests) || tests.length > plan.items.length * 4) throw new Error("Invalid boundary test count");
	const ids = new Set<string>();
	for (const test of tests) {
		if (
			!test ||
			typeof test.id !== "string" ||
			!test.id.trim() ||
			ids.has(test.id) ||
			!plan.items.some((item) => item.spec.id === test.specItemId) ||
			[test.boundary, test.testSource, test.command].some((s) => typeof s !== "string" || !s.trim()) ||
			Buffer.byteLength(JSON.stringify(test), "utf8") > 65_536
		)
			throw new Error("Invalid prepared boundary test");
		ids.add(test.id);
	}
	for (const item of plan.items) {
		const cases = tests.filter((test) => test.specItemId === item.spec.id);
		if (
			cases.length < 2 ||
			cases.length > 4 ||
			new Set(cases.map((test) => test.boundary.trim())).size !== cases.length ||
			new Set(cases.map((test) => reviewSha256(test.testSource))).size !== cases.length
		) {
			throw new Error("Each specification item needs 2..4 distinct boundary tests");
		}
	}
}

/** Explicitly wired authorized executor only. This module never invokes a shell or provider. */
export async function runReviewRevalidation(
	inputPlan: ReviewRevalidationPlan,
	executor?: AuthorizedReviewTestExecutor,
	timeoutMs = 120_000,
): Promise<ReviewRevalidationResult> {
	const plan = structuredClone(inputPlan);
	const executions: ExecutedBoundaryTest[] = [];
	let prepared: readonly PreparedBoundaryTest[] = [];
	const result = (state: ReviewRevalidationResult["state"], reason: string): ReviewRevalidationResult => ({
		state,
		reason,
		plan,
		prepared,
		executions,
		canApply: false,
		shouldSubmit: false,
	});
	if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000)
		throw new Error("Invalid revalidation timeout");
	try {
		assertReviewIdentifier(plan.packetId);
		assertReviewIdentifier(plan.specRevision);
		if (
			!Array.isArray(plan.items) ||
			plan.items.length < 1 ||
			plan.items.length > 32 ||
			new Set(plan.items.map((item) => item.spec.id)).size !== plan.items.length ||
			plan.items.some(
				(item) => typeof item.spec.text !== "string" || !item.spec.text.trim() || item.minimumBoundaryCases !== 2,
			) ||
			reviewSha256(JSON.stringify(plan.items.map((item) => item.spec))) !== plan.specSha256 ||
			!/^[a-f0-9]{64}$/.test(plan.diffSha256)
		)
			throw new Error("Invalid plan");
	} catch {
		return result("blocked", "Invalid or changed revalidation plan");
	}
	if (!executor)
		return result("blocked", "Authorized coding/test executor is not wired; boundary tests remain a plan");
	const auth = executor.authorization;
	if (
		!auth ||
		auth.writeAndExecuteAllowed !== true ||
		auth.packetId !== plan.packetId ||
		auth.specRevision !== plan.specRevision ||
		auth.specSha256 !== plan.specSha256 ||
		auth.diffSha256 !== plan.diffSha256
	) {
		return result("blocked", "Coding/test authorization does not match the packet, specification, and diff");
	}
	const deadline = Date.now() + timeoutMs;
	let executing = false;
	try {
		const generated = await reviewTimeout(executor.prepare(structuredClone(plan)), timeoutMs);
		if (!generated)
			return result("execution_unknown", "Test preparation observation timed out; reconcile before retrying");
		prepared = structuredClone(generated);
		validatePrepared(plan, prepared);
		for (const test of prepared) {
			if (Date.now() >= deadline)
				return result("execution_unknown", "Test observation budget expired; no automatic retry");
			executing = true;
			const evidence = await reviewTimeout(executor.execute({ ...test }), Math.max(1, deadline - Date.now()));
			if (!evidence)
				return result("execution_unknown", "Test execution observation timed out; reconcile before retrying");
			if (
				evidence.testId !== test.id ||
				evidence.testSourceSha256 !== reviewSha256(test.testSource) ||
				evidence.command !== test.command ||
				typeof evidence.output !== "string" ||
				!Number.isSafeInteger(evidence.exitCode) ||
				!Number.isSafeInteger(evidence.assertionCount) ||
				evidence.assertionCount < 0 ||
				!["passed", "failed", "skipped"].includes(evidence.outcome) ||
				!Number.isFinite(Date.parse(evidence.executedAt))
			) {
				return result("blocked", "Executor did not return bound actual execution evidence");
			}
			executions.push({ ...evidence });
			executing = false;
		}
	} catch {
		return result(
			executing ? "execution_unknown" : "blocked",
			"Coding/test workflow failed; no automatic execution retry",
		);
	}
	if (executions.some((test) => test.exitCode !== 0 || test.outcome !== "passed" || test.assertionCount < 1))
		return result("tests_failed", "At least one boundary test failed, was skipped, or executed no assertions");
	return result(
		"evidence_ready",
		"Recorded boundary tests completed successfully; independent adjudication remains required",
	);
}
