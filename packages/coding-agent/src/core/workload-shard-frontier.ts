import type { ExecuteWorkloadShardPlanInput } from "./workload-shard-execution-types.ts";
import type { WorkloadShardProjection } from "./workload-shard-plan.ts";
import { runOneShard, shardById } from "./workload-shard-runner.ts";

/** Every launched task is joined, including exceptional storage/callback exits. */
export async function runShardFrontier(
	input: ExecuteWorkloadShardPlanInput,
	projections: Map<string, WorkloadShardProjection>,
	width: number,
	now: () => Date,
): Promise<void> {
	const controller = new AbortController();
	const abort = () => controller.abort(input.signal?.reason);
	input.signal?.addEventListener("abort", abort, { once: true });
	if (input.signal?.aborted) abort();
	const scoped = { ...input, signal: controller.signal };
	const remaining = new Set(
		input.plan.shards.map((shard) => shard.shardId).filter((id) => projections.get(id)?.state !== "passed"),
	);
	const running = new Set<Promise<void>>();
	const failures: unknown[] = [];
	try {
		while (remaining.size > 0 && !controller.signal.aborted) {
			const ready = [...remaining].filter(
				(id) =>
					projections.get(id)?.state === "pending" &&
					shardById(input.plan, id).dependencyIds.every((dep) => projections.get(dep)?.state === "passed"),
			);
			for (const id of ready.slice(0, Math.max(0, width - running.size))) {
				remaining.delete(id);
				const task = runOneShard(scoped, projections, id, now)
					.catch((error: unknown) => {
						failures.push(error);
						controller.abort();
					})
					.finally(() => {
						running.delete(task);
					});
				running.add(task);
			}
			if (running.size === 0) break;
			await Promise.race(running);
		}
	} catch (error) {
		failures.push(error);
		controller.abort();
	} finally {
		await Promise.all(running);
		input.signal?.removeEventListener("abort", abort);
	}
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, "Shard execution and cleanup failed");
}
