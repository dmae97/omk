import { AdaptOrchClient } from "./adaptorch-client.ts";
import { type EvaluateCorrectnessWallResult, evaluateCorrectnessWall } from "./evaluate-correctness-wall.ts";
import type { ReviewEvidenceInput } from "./review-evidence.ts";
import { pollReviewRun, reviewTimeout } from "./review-poll.ts";
import {
	type AuthorizedReviewTestExecutor,
	createReviewRevalidationPlan,
	type ReviewRevalidationResult,
	runReviewRevalidation,
} from "./review-revalidation.ts";

export interface ReviewAssessment {
	readonly state: "rejected" | "observation_pending" | "revalidation_required" | "evidence_ready";
	readonly runId: string;
	readonly wall?: EvaluateCorrectnessWallResult;
	readonly revalidation?: ReviewRevalidationResult;
	readonly canApply: false;
	readonly shouldSubmit: false;
}

/** Composition used by ReviewWorkflow.assess; raw remote opinions can never grant apply/submit authority. */
export async function assessReviewRun(input: {
	readonly input: ReviewEvidenceInput;
	readonly runId: string;
	readonly client: AdaptOrchClient;
	readonly executor?: AuthorizedReviewTestExecutor;
	readonly observationTimeoutMs?: number;
}): Promise<ReviewAssessment> {
	const params = { ...input, input: structuredClone(input.input) };
	const base = { runId: params.runId, canApply: false, shouldSubmit: false } as const;
	const plan = createReviewRevalidationPlan(params.input);
	const observation = await pollReviewRun(params.client, params.runId, {
		timeoutMs: params.observationTimeoutMs ?? 15_000,
	});
	if (observation.state !== "terminal" && observation.state !== "blocked")
		return { ...base, state: "observation_pending" };
	const snapshotClient = new AdaptOrchClient({
		callTool: async (name, args) => {
			if (args.run_id !== params.runId) throw new Error("Mismatched review observation");
			if (name === "adaptorch_get_run") return observation.summary;
			if (name === "adaptorch_get_artifacts") return params.client.getArtifacts(params.runId);
			if (name === "adaptorch_get_traces") return params.client.getTraces(params.runId);
			throw new Error("Unexpected review observation tool");
		},
	});
	let wall: EvaluateCorrectnessWallResult | undefined;
	try {
		wall = await reviewTimeout(
			evaluateCorrectnessWall({
				kind: "code-review",
				packetId: params.input.packetId,
				diffText: params.input.diff,
				runIds: [params.runId],
				dispatchRecordId: `${params.input.packetId}:review`,
				client: snapshotClient,
				previewOnly: false,
			}),
			params.observationTimeoutMs ?? 15_000,
		);
	} catch {
		/* Missing adjudication evidence remains unverified. */
	}
	if (observation.state === "blocked" || wall?.verdictCard.verdict === "BLOCKED")
		return { ...base, state: "rejected", wall };
	const revalidation = await runReviewRevalidation(plan, params.executor);
	return {
		...base,
		state: revalidation.state === "evidence_ready" ? "evidence_ready" : "revalidation_required",
		wall,
		revalidation,
	};
}
