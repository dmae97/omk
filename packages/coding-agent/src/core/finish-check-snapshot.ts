/**
 * Optional pre-check snapshot handshake for benchmark harnesses.
 *
 * With `OMK_FINISH_CHECK_SNAPSHOT_DIR` set, the finish check writes
 * `pre-check-<n>.request` there right before the verification turn and waits for
 * the harness to create `pre-check-<n>.done` (for example after `docker commit`).
 * The wait is capped, and an unset variable keeps the default behavior.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_SNAPSHOT_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 250;

export interface SnapshotHandshakeConfig {
	readonly dir: string;
	readonly timeoutMs: number;
}

export function resolveSnapshotHandshake(env: NodeJS.ProcessEnv): SnapshotHandshakeConfig | undefined {
	const dir = env.OMK_FINISH_CHECK_SNAPSHOT_DIR?.trim();
	if (!dir) return undefined;
	const seconds = Number(env.OMK_FINISH_CHECK_SNAPSHOT_TIMEOUT_SEC);
	const timeoutMs = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : DEFAULT_SNAPSHOT_TIMEOUT_MS;
	return { dir, timeoutMs };
}

export interface SnapshotHandshakeResult {
	readonly status: "done" | "timeout" | "error";
	readonly waitedMs: number;
	readonly detail?: string;
}

export interface SnapshotHandshakeDeps {
	readonly now: () => number;
	readonly sleep?: (ms: number) => Promise<void>;
}

/** Writes the request marker and waits for the harness to acknowledge it. Never throws. */
export async function requestPreCheckSnapshot(
	config: SnapshotHandshakeConfig,
	sequence: number,
	deps: SnapshotHandshakeDeps,
): Promise<SnapshotHandshakeResult> {
	const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	const startedAt = deps.now();
	const requestPath = join(config.dir, `pre-check-${sequence}.request`);
	const donePath = join(config.dir, `pre-check-${sequence}.done`);
	try {
		mkdirSync(config.dir, { recursive: true });
		// `deps.now` may be monotonic (spec 036); the request carries a wall-clock epoch for the harness.
		writeFileSync(requestPath, `${JSON.stringify({ sequence, pid: process.pid, requestedAt: Date.now() })}\n`);
	} catch (error) {
		return { status: "error", waitedMs: deps.now() - startedAt, detail: String(error) };
	}
	let result: SnapshotHandshakeResult | undefined;
	while (result === undefined) {
		if (existsSync(donePath)) {
			result = { status: "done", waitedMs: deps.now() - startedAt };
		} else if (deps.now() - startedAt >= config.timeoutMs) {
			result = { status: "timeout", waitedMs: deps.now() - startedAt, detail: `no ${donePath}` };
		} else {
			await sleep(POLL_INTERVAL_MS);
		}
	}
	// Leave the outcome next to the markers so the harness can tell a skipped snapshot from a taken one.
	try {
		writeFileSync(join(config.dir, `pre-check-${sequence}.result`), `${JSON.stringify(result)}\n`);
	} catch {
		// The snapshot directory is advisory; a failed log write must not stop the run.
	}
	return result;
}
