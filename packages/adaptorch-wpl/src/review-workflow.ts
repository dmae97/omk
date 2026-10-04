import type { AdaptOrchClient } from "./adaptorch-client.ts";
import { assessReviewRun, type ReviewAssessment } from "./review-assessment.ts";
import { type BuiltReviewRequest, buildReviewRequest, type ReviewEvidenceInput } from "./review-evidence.ts";
import { pollReviewRun, type ReviewPollOptions, type ReviewPollResult, reviewTimeout } from "./review-poll.ts";
import type { AuthorizedReviewTestExecutor } from "./review-revalidation.ts";
import { hasExplicitReviewBlock, persistReviewBlock, updateReviewAttempt } from "./review-run-guards.ts";
import { type ReviewRecord, type ReviewStore, reviewStoreKey, validateReviewRecord } from "./review-store.ts";

export interface ReviewSubmissionResult {
	readonly state: "submitted" | "submission_unknown" | "journal_busy" | "revalidation_required" | "rejected";
	readonly runId?: string;
	readonly reason?: string;
	readonly canApply: false;
	readonly shouldSubmit: false;
}

/** No server missing-input prose parser exists. Only the caller's explicit input audit can request this retry. */
export interface MissingReviewInput {
	readonly code: "MISSING_REVIEW_INPUT";
	readonly source: "caller_input_audit";
	readonly runId: string;
	readonly missingEvidenceIds: readonly string[];
}

export interface ReviewWorkflowOptions {
	readonly client: AdaptOrchClient;
	readonly store: ReviewStore;
	readonly submitTimeoutMs?: number;
}

const BLOCKED = { canApply: false, shouldSubmit: false } as const;

/** Explicit review entry point, separate from the CLI's read-only advisory bridge. */
export class ReviewWorkflow {
	private readonly client: ReviewWorkflowOptions["client"];
	private readonly store: ReviewStore;
	private readonly submitTimeoutMs: number;

	constructor(options: ReviewWorkflowOptions) {
		if (
			!options.store ||
			typeof options.store.read !== "function" ||
			typeof options.store.compareAndSwap !== "function"
		) {
			throw new Error("A durable atomic review store is required before submitting");
		}
		if (!options.client || typeof options.client.run !== "function" || typeof options.client.getRun !== "function") {
			throw new Error("An authorized review client is required");
		}
		this.client = options.client;
		this.store = options.store;
		this.submitTimeoutMs = options.submitTimeoutMs ?? 10_000;
		if (!Number.isFinite(this.submitTimeoutMs) || this.submitTimeoutMs < 1 || this.submitTimeoutMs > 30_000) {
			throw new Error("Invalid bounded review submit timeout");
		}
	}

	private result(record: ReviewRecord): ReviewSubmissionResult {
		const last = record.attempts[record.attempts.length - 1];
		if (record.blockedRunIds?.length)
			return { ...BLOCKED, state: "rejected", runId: last.runId, reason: "REVIEW_BLOCKED" };
		return last.state === "submitted"
			? { ...BLOCKED, state: "submitted", runId: last.runId }
			: { ...BLOCKED, state: "submission_unknown", reason: "Reconcile the existing submission; do not resubmit" };
	}

	private assertBinding(record: ReviewRecord, request: BuiltReviewRequest): void {
		validateReviewRecord(record);
		if (
			record.packetId !== request.packetId ||
			record.specRevision !== request.specRevision ||
			record.specSha256 !== request.specSha256 ||
			record.diffSha256 !== request.diffSha256 ||
			record.candidateCount !== request.candidateCount
		)
			throw new Error("Review packet/spec/diff/candidate binding changed");
	}

	async submit(input: ReviewEvidenceInput): Promise<ReviewSubmissionResult> {
		const request = buildReviewRequest(input);
		const key = reviewStoreKey(request.packetId, request.specRevision);
		const current = await this.store.read(key);
		if (current) {
			this.assertBinding(current, request);
			if (!current.attempts.some((a) => a.requestSha256 === request.requestSha256)) {
				return {
					...BLOCKED,
					state: "revalidation_required",
					reason: "Changed evidence requires a bounded missing-input retry",
				};
			}
			return this.result(current);
		}
		const record: ReviewRecord = {
			version: 1,
			revision: 0,
			packetId: request.packetId,
			specRevision: request.specRevision,
			specSha256: request.specSha256,
			diffSha256: request.diffSha256,
			candidateCount: request.candidateCount,
			initialManifest: request.manifest,
			retryCount: 0,
			attempts: [{ requestSha256: request.requestSha256, state: "submitting" }],
		};
		if (!(await this.store.compareAndSwap(key, null, record))) return { ...BLOCKED, state: "journal_busy" };
		return this.dispatch(key, request, 0);
	}

	/** One retry, reserved durably before I/O, only when the requested evidence actually changes on the wire. */
	async retryMissingInput(input: ReviewEvidenceInput, reason: MissingReviewInput): Promise<ReviewSubmissionResult> {
		const request = buildReviewRequest(input);
		const key = reviewStoreKey(request.packetId, request.specRevision);
		const current = await this.store.read(key);
		if (!current) throw new Error("An original review journal is required for retry");
		this.assertBinding(current, request);
		if (current.retryCount === 1 || current.blockedRunIds?.length) return this.result(current);
		const first = current.attempts[0];
		if (
			reason.code !== "MISSING_REVIEW_INPUT" ||
			reason.source !== "caller_input_audit" ||
			first.state !== "submitted" ||
			first.runId !== reason.runId ||
			!reason.missingEvidenceIds.length
		) {
			return { ...BLOCKED, state: "revalidation_required", reason: "Missing-input retry lacks a bound input audit" };
		}
		const changed = reason.missingEvidenceIds.every((id) => {
			const next = request.manifest.find((entry) => entry.id === id);
			const prior = current.initialManifest.find((entry) => entry.id === id);
			return (
				next &&
				next.includedBytes > 0 &&
				next.includedSha256 !== prior?.includedSha256 &&
				!current.initialManifest.some(
					(entry) => entry.kind === next.kind && entry.includedSha256 === next.includedSha256,
				)
			);
		});
		if (!changed)
			return { ...BLOCKED, state: "revalidation_required", reason: "No new requested evidence is included" };
		const summary = await reviewTimeout(this.client.getRun(reason.runId), this.submitTimeoutMs);
		if (summary?.run_id === reason.runId && hasExplicitReviewBlock(summary)) {
			await persistReviewBlock(this.store, key, reason.runId);
			return { ...BLOCKED, state: "rejected", runId: reason.runId, reason: "REVIEW_BLOCKED" };
		}
		if (
			!summary ||
			summary.run_id !== reason.runId ||
			!["SUCCEEDED", "FAILED", "CANCELLED"].includes(summary.status)
		) {
			return { ...BLOCKED, state: "revalidation_required", reason: "Original run is not known terminal" };
		}
		const next: ReviewRecord = {
			...current,
			revision: current.revision + 1,
			retryCount: 1,
			attempts: [...current.attempts, { requestSha256: request.requestSha256, state: "submitting" }],
		};
		if (!(await this.store.compareAndSwap(key, current.revision, next))) return { ...BLOCKED, state: "journal_busy" };
		return this.dispatch(key, request, 1);
	}

	private async dispatch(key: string, request: BuiltReviewRequest, index: number): Promise<ReviewSubmissionResult> {
		const pending = (async (): Promise<ReviewSubmissionResult> => {
			let admittedRunId: string | undefined;
			try {
				const result = await this.client.run({
					taskPayload: request.payload,
					synthesisMode: "robust",
					waitForTerminal: false,
				});
				if (!result || typeof result.run_id !== "string" || !result.run_id.trim())
					throw new Error("Missing run ID");
				admittedRunId = result.run_id;
				await updateReviewAttempt(
					this.store,
					key,
					request.requestSha256,
					index,
					result.run_id,
					hasExplicitReviewBlock(result),
				);
				if (hasExplicitReviewBlock(result))
					return { ...BLOCKED, state: "rejected", runId: result.run_id, reason: "REVIEW_BLOCKED" };
				return { ...BLOCKED, state: "submitted", runId: result.run_id };
			} catch {
				// A rejected/invalid/ambiguous submit may already have created a paid run.
				if (admittedRunId)
					return {
						...BLOCKED,
						state: "submission_unknown",
						runId: admittedRunId,
						reason: "Remote run accepted but journal update failed; reconcile this run ID",
					};
				await updateReviewAttempt(this.store, key, request.requestSha256, index).catch(() => undefined);
				return {
					...BLOCKED,
					state: "submission_unknown",
					reason: "Reconcile the existing submission; do not resubmit",
				};
			}
		})();
		return (
			(await reviewTimeout(pending, this.submitTimeoutMs)) ?? {
				...BLOCKED,
				state: "submission_unknown",
				reason: "Submission observation timed out; remote work may continue",
			}
		);
	}

	/** Terminal review -> classifier -> mandatory per-spec revalidation gate. No apply or submission path. */
	async assess(input: ReviewEvidenceInput, executor?: AuthorizedReviewTestExecutor): Promise<ReviewAssessment> {
		const selected = structuredClone(input);
		const request = buildReviewRequest(selected);
		const current = await this.store.read(reviewStoreKey(selected.packetId, selected.specRevision));
		if (!current) throw new Error("Review journal not found");
		this.assertBinding(current, request);
		const latest = current.attempts[current.attempts.length - 1];
		if (latest.requestSha256 !== request.requestSha256 || !latest.runId) {
			throw new Error("Assessment requires the latest submitted evidence and run ID");
		}
		if (current.blockedRunIds?.length) return { ...BLOCKED, state: "rejected", runId: latest.runId };
		const assessment = await assessReviewRun({ input: selected, runId: latest.runId, client: this.client, executor });
		if (assessment.state === "rejected")
			await persistReviewBlock(this.store, reviewStoreKey(selected.packetId, selected.specRevision), latest.runId);
		return assessment;
	}

	/** Remote reads only; refusals are journaled. Timeouts never cancel or spend on a new run. */
	async resume(
		packetId: string,
		specRevision: string,
		options?: ReviewPollOptions,
	): Promise<ReviewPollResult | ReviewSubmissionResult> {
		const current = await this.store.read(reviewStoreKey(packetId, specRevision));
		if (!current) throw new Error("Review journal not found");
		validateReviewRecord(current);
		const result = this.result(current);
		if (result.state !== "submitted" || !result.runId) return result;
		const observation = await pollReviewRun(this.client, result.runId, options);
		if (observation.state === "blocked")
			await persistReviewBlock(this.store, reviewStoreKey(packetId, specRevision), result.runId);
		return observation;
	}
}
