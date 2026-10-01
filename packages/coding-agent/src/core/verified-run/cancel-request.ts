import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fsyncDirectorySync } from "../durable-file-directory.ts";
import { writeExclusiveFileDurablySync } from "../durable-file-io.ts";
import { canonicalJson } from "../run-journal.ts";
import { inspectSessionOwnerLeaseSync } from "../session-owner-lease.ts";
import { journalPath } from "./journal.ts";
import { requireRunJournal } from "./recovery-command.ts";
import { readRegularFile, VerifiedRunError } from "./storage.ts";

/**
 * Remote cancellation is a durable request file in the run directory. The process that owns the
 * run polls for it, removes it, and aborts its own operation, so cancellation always travels
 * through the owner's normal abort path and never signals a process by pid.
 */
export const CANCEL_REQUEST_FILE = "cancel-request.json";
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface RunCancelRequest {
	readonly requestId: string;
	readonly requestedAt: string;
}

export interface RunCancelOutcome {
	readonly runId: string;
	/**
	 * `not_running`: no live owner when asked, nothing written. `observed`: the owner consumed the
	 * request and released the run. `not_observed`: the owner released the run first and the request
	 * was withdrawn. `pending`: the run is still owned after the wait; the request stays in place.
	 */
	readonly outcome: "not_running" | "observed" | "not_observed" | "pending";
	readonly requestId: string | null;
}

const requestPath = (runPath: string): string => join(runPath, CANCEL_REQUEST_FILE);
const isMissing = (error: unknown): boolean => error instanceof Error && "code" in error && error.code === "ENOENT";

export function readRunCancelRequest(runPath: string): RunCancelRequest | null {
	let bytes: Buffer;
	try {
		bytes = readRegularFile(requestPath(runPath), 4096);
	} catch (error) {
		if (isMissing(error)) return null;
		throw error;
	}
	let value: unknown;
	try {
		value = JSON.parse(bytes.toString("utf8"));
	} catch {
		throw new VerifiedRunError("integrity");
	}
	if (
		typeof value !== "object" ||
		value === null ||
		!("requestId" in value) ||
		!("requestedAt" in value) ||
		typeof value.requestId !== "string" ||
		!REQUEST_ID.test(value.requestId) ||
		typeof value.requestedAt !== "string"
	)
		throw new VerifiedRunError("integrity");
	return Object.freeze({ requestId: value.requestId, requestedAt: value.requestedAt });
}

/** Write a request, or return the one already pending: repeated cancels share one request id. */
export function requestRunCancel(runPath: string): RunCancelRequest {
	for (let attempt = 0; attempt < 2; attempt++) {
		const request = { requestId: randomUUID(), requestedAt: new Date().toISOString() };
		try {
			writeExclusiveFileDurablySync(requestPath(runPath), Buffer.from(canonicalJson(request)));
			return Object.freeze(request);
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
		}
		const pending = readRunCancelRequest(runPath);
		if (pending) return pending;
		// The owner consumed the previous request between our create and read; write a fresh one.
	}
	throw new VerifiedRunError("cancel_request_conflict");
}

function removeRequest(runPath: string): boolean {
	try {
		unlinkSync(requestPath(runPath));
	} catch (error) {
		if (isMissing(error)) return false;
		throw error;
	}
	fsyncDirectorySync(runPath);
	return true;
}

/** Remove the request only when it is still the caller's own. */
export function withdrawRunCancelRequest(runPath: string, requestId: string): boolean {
	if (readRunCancelRequest(runPath)?.requestId !== requestId) return false;
	return removeRequest(runPath);
}

/**
 * Drop a request that no live operation can own: one left in a run without a journal, or with no
 * live owner. A request pending for a live owner is left for that owner.
 */
export function discardStaleRunCancelRequest(runPath: string): void {
	const journal = journalPath(runPath);
	if (existsSync(journal) && inspectSessionOwnerLeaseSync(journal).status !== "absent") return;
	removeRequest(runPath);
}

/** Owner side: poll for a request, consume it, and cancel once. Returns the stop function. */
export function watchRunCancelRequest(runPath: string, onCancel: () => void, intervalMs = 250): () => void {
	let stopped = false;
	const timer = setInterval(() => {
		if (stopped) return;
		let present = false;
		try {
			present = lstatSync(requestPath(runPath)).isFile();
		} catch {
			present = false;
		}
		if (!present) return;
		stopped = true;
		clearInterval(timer);
		try {
			removeRequest(runPath);
		} catch {
			// Consumption is best effort: a leftover request is discarded when the next operation starts.
		}
		onCancel();
	}, intervalMs);
	timer.unref();
	return () => {
		stopped = true;
		clearInterval(timer);
	};
}

/** Ask the live owner of a run to cancel, then wait for it to release the run. */
export async function cancelVerifiedRun(
	runPath: string,
	options: { readonly waitMs: number; readonly pollMs?: number },
): Promise<RunCancelOutcome> {
	const runId = requireRunJournal(runPath).state.runId;
	const lease = journalPath(runPath);
	if (inspectSessionOwnerLeaseSync(lease).status === "absent")
		return Object.freeze({ runId, outcome: "not_running", requestId: null });
	const { requestId } = requestRunCancel(runPath);
	const deadline = Date.now() + options.waitMs;
	while (inspectSessionOwnerLeaseSync(lease).status !== "absent") {
		if (Date.now() >= deadline) return Object.freeze({ runId, outcome: "pending", requestId });
		await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 100));
	}
	const outcome = withdrawRunCancelRequest(runPath, requestId) ? "not_observed" : "observed";
	return Object.freeze({ runId, outcome, requestId });
}
