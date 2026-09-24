/** Attach rejection ownership in the same synchronous turn as task creation. */
export type OwnedTaskResult<T> =
	| { readonly sourceIndex: number; readonly status: "fulfilled"; readonly value: T }
	| { readonly sourceIndex: number; readonly status: "rejected"; readonly reason: unknown };

export function ownDagTask<T>(sourceIndex: number, task: Promise<T>): Promise<OwnedTaskResult<T>> {
	return task.then(
		(value) => ({ sourceIndex, status: "fulfilled" as const, value }),
		(reason: unknown) => ({ sourceIndex, status: "rejected" as const, reason }),
	);
}

export function startDagTask<T>(sourceIndex: number, execute: () => Promise<T>): Promise<OwnedTaskResult<T>> {
	try {
		return ownDagTask(sourceIndex, execute());
	} catch (reason) {
		return Promise.resolve({ sourceIndex, status: "rejected", reason });
	}
}

/** Join all started work before reporting failures, including failures during drain. */
export async function finishDagTasks<T>(
	running: Map<number, Promise<OwnedTaskResult<T>>>,
	settle: (value: T) => Promise<void>,
	errors: unknown[],
): Promise<void> {
	const drained = await Promise.all([...running.values()]);
	running.clear();
	for (const result of drained) {
		if (result.status === "rejected") {
			errors.push(result.reason);
			continue;
		}
		try {
			await settle(result.value);
		} catch (error) {
			errors.push(error);
		}
	}
	if (errors.length === 1) throw errors[0];
	if (errors.length > 1)
		throw new AggregateError(errors, "DAG batch failed in multiple execution or settlement paths");
}
