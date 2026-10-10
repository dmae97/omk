/**
 * Deadline-bounded dependency DAG for environment checks.
 *
 * Kahn-style scheduling (validation O(V·E), dispatch O(V²) for the tens of checks a doctor runs):
 * a node starts once every dependency settled, at most `concurrency` nodes run at once, and each
 * run races its own deadline. With concurrency at least the graph width, wall time is bounded by
 * the deadlines along the longest dependency chain; a synchronous check cannot be preempted, so
 * checks that spawn must bound their own child (spawnSync `timeout`). A dependency that failed or was skipped
 * skips its dependents without running them, so one root cause reports once instead of cascading.
 * Reports come back in declaration order regardless of completion order, so output is stable.
 *
 * Every timer is cleared when its race settles and every controller is aborted on timeout, so a
 * finished run leaves no handle that keeps the process alive.
 */

export type CheckStatus = "pass" | "warn" | "fail" | "skip";

export interface CheckResult {
	readonly status: CheckStatus;
	readonly summary: string;
	readonly fix?: string;
	readonly data?: Readonly<Record<string, unknown>>;
}

export interface CheckNode<C> {
	readonly id: string;
	readonly title: string;
	readonly deps?: readonly string[];
	readonly deadlineMs: number;
	/** Status reported when the deadline elapses first. Defaults to "warn": slow is not broken. */
	readonly onTimeout?: "warn" | "fail";
	run(context: C, signal: AbortSignal): CheckResult | Promise<CheckResult>;
}

export interface CheckReport extends CheckResult {
	readonly id: string;
	readonly title: string;
	readonly durationMs: number;
}

export interface CheckDagOptions {
	readonly concurrency?: number;
	readonly now?: () => number;
}

/** Throws on duplicate ids, unknown dependencies or a cycle: those are programming errors. */
export function validateCheckDag<C>(nodes: readonly CheckNode<C>[]): void {
	const ids = new Set<string>();
	for (const node of nodes) {
		if (ids.has(node.id)) throw new Error(`duplicate check id: ${node.id}`);
		ids.add(node.id);
	}
	const indegree = new Map<string, number>();
	for (const node of nodes) {
		for (const dep of node.deps ?? []) {
			if (!ids.has(dep)) throw new Error(`check ${node.id} depends on unknown check ${dep}`);
		}
		indegree.set(node.id, node.deps?.length ?? 0);
	}
	const queue = nodes.filter((node) => (node.deps?.length ?? 0) === 0).map((node) => node.id);
	let visited = 0;
	while (queue.length > 0) {
		const id = queue.shift() as string;
		visited += 1;
		for (const node of nodes) {
			if (!node.deps?.includes(id)) continue;
			const left = (indegree.get(node.id) ?? 0) - 1;
			indegree.set(node.id, left);
			if (left === 0) queue.push(node.id);
		}
	}
	if (visited !== nodes.length) throw new Error("check graph contains a cycle");
}

async function runWithDeadline<C>(node: CheckNode<C>, context: C): Promise<CheckResult> {
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<CheckResult>((resolve) => {
		timer = setTimeout(() => {
			controller.abort(new Error(`deadline ${node.deadlineMs}ms`));
			resolve({ status: node.onTimeout ?? "warn", summary: `timed out after ${node.deadlineMs} ms` });
		}, node.deadlineMs);
		timer.unref?.();
	});
	try {
		const work = Promise.resolve().then(() => node.run(context, controller.signal));
		return await Promise.race([work, timeout]);
	} catch (error: unknown) {
		return { status: "fail", summary: error instanceof Error ? error.message : String(error) };
	} finally {
		clearTimeout(timer);
	}
}

export async function runCheckDag<C>(
	nodes: readonly CheckNode<C>[],
	context: C,
	options: CheckDagOptions = {},
): Promise<CheckReport[]> {
	validateCheckDag(nodes);
	const now = options.now ?? (() => performance.now());
	const limit = Math.max(1, options.concurrency ?? 4);
	const reports = new Map<string, CheckReport>();
	const started = new Set<string>();
	const running = new Set<Promise<void>>();

	const blockedBy = (node: CheckNode<C>): string | undefined =>
		(node.deps ?? []).find((dep) => {
			const status = reports.get(dep)?.status;
			return status === "fail" || status === "skip";
		});
	const ready = (): CheckNode<C>[] =>
		nodes.filter((node) => !started.has(node.id) && (node.deps ?? []).every((dep) => reports.has(dep)));

	while (reports.size < nodes.length) {
		let progressed = false;
		for (const node of ready()) {
			const blocker = blockedBy(node);
			if (blocker) {
				started.add(node.id);
				reports.set(node.id, {
					id: node.id,
					title: node.title,
					status: "skip",
					summary: `skipped (blocked by ${blocker})`,
					durationMs: 0,
				});
				progressed = true;
				continue;
			}
			if (running.size >= limit) break;
			started.add(node.id);
			progressed = true;
			const begin = now();
			const task = runWithDeadline(node, context).then((result) => {
				reports.set(node.id, { ...result, id: node.id, title: node.title, durationMs: now() - begin });
				running.delete(task);
			});
			running.add(task);
		}
		if (!progressed && running.size > 0) await Promise.race(running);
		else if (!progressed) throw new Error("check scheduler stalled");
	}
	return nodes.map((node) => reports.get(node.id) as CheckReport);
}
