import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { type ReviewEvidenceManifest, reviewSha256 } from "./review-evidence.ts";

export interface ReviewAttempt {
	readonly requestSha256: string;
	readonly state: "submitting" | "submitted" | "submission_unknown";
	readonly runId?: string;
}

/** Journal stores bindings and counters, not source evidence, provider keys, or raw output. */
export interface ReviewRecord {
	readonly version: 1;
	readonly revision: number;
	readonly packetId: string;
	readonly specRevision: string;
	readonly specSha256: string;
	readonly diffSha256: string;
	readonly candidateCount: number;
	readonly initialManifest: readonly ReviewEvidenceManifest[];
	readonly retryCount: 0 | 1;
	readonly blockedRunIds?: readonly string[];
	readonly attempts: readonly ReviewAttempt[];
}

/** Must be durable and atomic across instances/processes, including reservation before dispatch. */
export interface ReviewStore {
	read(key: string): Promise<ReviewRecord | undefined>;
	compareAndSwap(key: string, expectedRevision: number | null, next: ReviewRecord): Promise<boolean>;
}

export function reviewStoreKey(packetId: string, specRevision: string): string {
	return reviewSha256(JSON.stringify([packetId, specRevision]));
}

/** Fail closed on malformed journals. Never reset a damaged counter or silently resubmit. */
export function validateReviewRecord(record: ReviewRecord): void {
	if (
		record.version !== 1 ||
		!Number.isSafeInteger(record.revision) ||
		record.revision < 0 ||
		(record.retryCount !== 0 && record.retryCount !== 1) ||
		!Array.isArray(record.attempts) ||
		record.attempts.length !== record.retryCount + 1 ||
		!Array.isArray(record.initialManifest) ||
		!Number.isInteger(record.candidateCount) ||
		record.candidateCount < 2 ||
		record.candidateCount > 4
	) {
		throw new Error("Invalid review journal; manual reconciliation required");
	}
	for (const value of [record.packetId, record.specRevision, record.specSha256, record.diffSha256]) {
		if (typeof value !== "string" || !value) throw new Error("Invalid review journal binding");
	}
	for (const attempt of record.attempts) {
		if (
			!attempt ||
			!["submitting", "submitted", "submission_unknown"].includes(attempt.state) ||
			typeof attempt.requestSha256 !== "string" ||
			!/^[a-f0-9]{64}$/.test(attempt.requestSha256) ||
			(attempt.state === "submitted" && (typeof attempt.runId !== "string" || !attempt.runId.trim()))
		) {
			throw new Error("Invalid review journal attempt");
		}
	}
	if (
		record.blockedRunIds !== undefined &&
		(!Array.isArray(record.blockedRunIds) ||
			record.blockedRunIds.length > 2 ||
			record.blockedRunIds.some((id: string) => !record.attempts.some((attempt) => attempt.runId === id)))
	) {
		throw new Error("Invalid review journal refusal");
	}
	for (const entry of record.initialManifest) {
		if (
			!entry ||
			typeof entry.id !== "string" ||
			!["spec", "diff", "test"].includes(entry.kind) ||
			!/^[a-f0-9]{64}$/.test(entry.includedSha256) ||
			!Number.isSafeInteger(entry.includedBytes) ||
			entry.includedBytes < 0
		) {
			throw new Error("Invalid review journal manifest");
		}
	}
}

/**
 * Explicit caller-selected directory. Exclusive lock + fsynced file + atomic rename.
 * A busy/stale lock blocks writes; no unsafe automatic lock stealing after a crash.
 */
export class FileReviewStore implements ReviewStore {
	private readonly directory: string;

	constructor(directory: string) {
		if (!directory.trim()) throw new Error("A review journal directory is required");
		this.directory = directory;
	}

	private path(key: string): string {
		if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid review journal key");
		return join(this.directory, `${key}.json`);
	}

	async read(key: string): Promise<ReviewRecord | undefined> {
		let raw: string;
		try {
			raw = await readFile(this.path(key), "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
			throw error;
		}
		const parsed = JSON.parse(raw) as ReviewRecord;
		validateReviewRecord(parsed);
		return parsed;
	}

	async compareAndSwap(key: string, expectedRevision: number | null, next: ReviewRecord): Promise<boolean> {
		validateReviewRecord(next);
		if (next.revision !== (expectedRevision === null ? 0 : expectedRevision + 1))
			throw new Error("Invalid journal revision");
		const path = this.path(key);
		await mkdir(this.directory, { recursive: true, mode: 0o700 });
		const lock = await open(`${path}.lock`, "wx", 0o600);
		const temp = `${path}.${randomUUID()}.tmp`;
		try {
			const current = await this.read(key);
			if ((current?.revision ?? null) !== expectedRevision) return false;
			const file = await open(temp, "wx", 0o600);
			try {
				await file.writeFile(JSON.stringify(next));
				await file.sync();
			} finally {
				await file.close();
			}
			await rename(temp, path);
			const directory = await open(this.directory, "r");
			try {
				await directory.sync();
			} finally {
				await directory.close();
			}
			return true;
		} finally {
			await unlink(temp).catch((error: NodeJS.ErrnoException) => {
				if (error.code !== "ENOENT") throw error;
			});
			await lock.close();
			await unlink(`${path}.lock`);
		}
	}
}
