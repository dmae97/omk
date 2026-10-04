import type { AdaptOrchClient, AdaptOrchRunSummary } from "./adaptorch-client.ts";
import { hasExplicitReviewBlock } from "./review-run-guards.ts";

export interface ReviewPollOptions {
	readonly timeoutMs?: number;
	readonly initialDelayMs?: number;
	readonly maxDelayMs?: number;
	readonly signal?: AbortSignal;
}

export type ReviewPollResult = {
	readonly runId: string;
	readonly state: "terminal" | "blocked" | "observation_timeout" | "observation_aborted" | "observation_error";
	readonly summary?: AdaptOrchRunSummary;
	readonly canApply: false;
	readonly shouldSubmit: false;
};

export function reviewTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
	let timer: ReturnType<typeof setTimeout>;
	return Promise.race([
		promise,
		new Promise<undefined>((resolve) => {
			timer = setTimeout(() => resolve(undefined), timeoutMs);
		}),
	]).finally(() => clearTimeout(timer));
}

/** Bounded observation only. Never cancel, resubmit, or interpret SUCCEEDED as review success. */
export async function pollReviewRun(
	client: Pick<AdaptOrchClient, "getRun">,
	runId: string,
	options: ReviewPollOptions = {},
): Promise<ReviewPollResult> {
	if (typeof runId !== "string" || !runId.trim()) throw new Error("Review run ID is required");
	const timeout = options.timeoutMs ?? 60_000;
	const initial = options.initialDelayMs ?? 500;
	const maximum = options.maxDelayMs ?? 5_000;
	if (
		![timeout, initial, maximum].every((n) => Number.isFinite(n) && n >= 1) ||
		timeout > 300_000 ||
		initial > maximum
	) {
		throw new Error("Invalid bounded review poll settings");
	}
	const deadline = Date.now() + timeout;
	const base = { runId, canApply: false, shouldSubmit: false } as const;
	let summary: AdaptOrchRunSummary | undefined;
	let delay = initial;
	while (Date.now() < deadline) {
		if (options.signal?.aborted) return { ...base, state: "observation_aborted", summary };
		try {
			const result = await reviewTimeout(client.getRun(runId), Math.max(1, deadline - Date.now()));
			if (result === undefined) break;
			if (!result || result.run_id !== runId) throw new Error("Invalid run summary");
			summary = result;
			if (hasExplicitReviewBlock(summary)) return { ...base, state: "blocked", summary };
			if (typeof summary.status !== "string") throw new Error("Invalid run lifecycle status");
			if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(summary.status))
				return { ...base, state: "terminal", summary };
			if (!["QUEUED", "RUNNING", "CANCELLING"].includes(summary.status)) throw new Error("Unknown run status");
		} catch {
			return { ...base, state: "observation_error", summary };
		}
		const remaining = deadline - Date.now();
		if (remaining <= 0) break;
		await new Promise<void>((resolve) => setTimeout(resolve, Math.min(delay, remaining)));
		delay = Math.min(maximum, delay * 2);
	}
	return { ...base, state: "observation_timeout", summary };
}
