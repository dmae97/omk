import { discardStaleRunCancelRequest, watchRunCancelRequest } from "../core/verified-run/cancel-request.ts";

/**
 * Own CLI cancellation listeners for the complete awaited run operation. A durable
 * `omk run cancel` request for the run aborts the operation the same way SIGINT does.
 */
export async function withRunSignal<T>(runPath: string, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
	const controller = new AbortController();
	const cancel = (): void => controller.abort();
	process.once("SIGINT", cancel);
	process.once("SIGTERM", cancel);
	let unwatch: (() => void) | undefined;
	try {
		discardStaleRunCancelRequest(runPath);
		unwatch = watchRunCancelRequest(runPath, cancel);
		return await run(controller.signal);
	} finally {
		unwatch?.();
		process.off("SIGINT", cancel);
		process.off("SIGTERM", cancel);
	}
}
