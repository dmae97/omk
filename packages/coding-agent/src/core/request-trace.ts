/** Opt-in, private logical-dispatch receipts. Hash chaining detects corruption, NOT malicious same-user forgery. */
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fsyncSync, openSync, realpathSync, writeSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

function boundedId(value: string): string {
	if (typeof value !== "string" || value.length === 0 || value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value))
		throw new TypeError("trace.invalid_identity");
	return value;
}
function safeUsage(value: unknown): Record<string, number> | undefined {
	if (value === null || typeof value !== "object") return undefined;
	const usage = value as Record<string, unknown>;
	const result: Record<string, number> = {};
	for (const name of ["input", "output", "cacheRead", "cacheWrite"]) {
		const n = usage[name];
		if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) return undefined;
		result[name] = n;
	}
	if (usage.cost !== null && typeof usage.cost === "object") {
		const total = (usage.cost as Record<string, unknown>).total;
		if (typeof total === "number" && Number.isFinite(total) && total >= 0) result.estimatedUsd = total;
	}
	return result;
}
export class RequestTrace {
	private readonly fd: number;
	private previous = "0".repeat(64);
	private sequence = 0;
	private readonly active = new Set<string>();
	private closedScope = false;
	private closedFile = false;
	private failed = false;
	constructor(path: string, privateLimit = 40_000) {
		if (!isAbsolute(path) || realpathSync(dirname(path)) !== resolve(dirname(path)))
			throw new TypeError("trace.requires_absolute_nonsymlink_path");
		if (!Number.isSafeInteger(privateLimit) || privateLimit < 4 || privateLimit > 100_000)
			throw new RangeError("trace.invalid_limit");
		this.limit = privateLimit;
		this.fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
		try {
			this.append({ kind: "trace_open", schema: "omk.logical-request-trace.v1", physicalAttemptsObserved: false });
		} catch (error) {
			closeSync(this.fd);
			this.closedFile = true;
			throw error;
		}
	}
	private readonly limit: number;
	private append(payload: Record<string, unknown>): void {
		if (this.closedFile || this.failed || this.sequence >= this.limit) throw new Error("trace.unavailable");
		const body = JSON.stringify({ sequence: this.sequence, previous: this.previous, ...payload });
		const hash = createHash("sha256").update(body).digest("hex");
		const bytes = Buffer.from(JSON.stringify({ body, hash }) + "\n");
		if (bytes.length > 8192) throw new Error("trace.record_limit");
		let offset = 0;
		try {
			while (offset < bytes.length) {
				const written = writeSync(this.fd, bytes, offset, bytes.length - offset);
				if (written <= 0) throw new Error("trace.zero_write");
				offset += written;
			}
			fsyncSync(this.fd);
		} catch {
			this.failed = true;
			throw new Error("trace.persistence_failed");
		}
		this.previous = hash;
		this.sequence++;
	}
	begin(provider: string, model: string): string {
		if (this.closedScope) throw new Error("trace.scope_closed");
		const id = randomUUID();
		this.append({ kind: "logical_dispatch", id, provider: boundedId(provider), model: boundedId(model) });
		this.active.add(id);
		return id;
	}
	terminal(id: string, message: unknown, rejectedBeforeStream = false): void {
		if (!this.active.has(id)) return;
		try {
			let usage: Record<string, number> | undefined,
				stopReason = "unknown";
			if (message !== null && typeof message === "object") {
				const m = message as Record<string, unknown>;
				if (["stop", "length", "toolUse", "error", "aborted"].includes(String(m.stopReason)))
					stopReason = String(m.stopReason);
				usage = safeUsage(m.usage);
			}
			const usageComplete = usage !== undefined && ["stop", "length", "toolUse"].includes(stopReason);
			this.append({
				kind: rejectedBeforeStream ? "dispatch_rejected" : "logical_terminal",
				id,
				stopReason,
				usageComplete,
				...(usage ? { usage } : {}),
			});
		} catch {
			this.failed = true;
		}
		this.active.delete(id);
		if (this.closedScope && this.active.size === 0) this.finishFile();
	}
	closeScope(): void {
		if (this.closedScope) return;
		this.closedScope = true;
		try {
			this.append({ kind: "scope_closed", activeRequests: this.active.size });
		} catch {
			this.failed = true;
		}
		if (this.active.size === 0) this.finishFile();
	}
	private finishFile(): void {
		if (this.closedFile) return;
		try {
			if (!this.failed) this.append({ kind: "trace_closed", activeRequests: 0 });
		} catch {
			this.failed = true;
		} finally {
			try {
				closeSync(this.fd);
			} catch {
				this.failed = true;
			} finally {
				this.closedFile = true;
			}
		}
	}
}
export function requestTraceFromEnv(signal: AbortSignal): RequestTrace | undefined {
	const path = process.env.OMK_EVAL_TRACE;
	if (path === undefined) return undefined;
	signal.throwIfAborted();
	const trace = new RequestTrace(path);
	signal.addEventListener("abort", () => trace.closeScope(), { once: true });
	return trace;
}
