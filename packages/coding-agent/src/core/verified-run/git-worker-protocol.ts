import { renameSync } from "node:fs";
import { dirname } from "node:path";
import { fsyncDirectorySync } from "../durable-file-io.ts";
import type { CandidateFile, CandidateManifest } from "./candidate.ts";
import { preflightGitCandidate } from "./git-candidate-preflight.ts";
import type { SealCandidateInput } from "./git-plumbing.ts";
import { digestObject, publishObject, readJson, VerifiedRunError } from "./storage.ts";

export interface GitWorkerRequest {
	readonly input: SealCandidateInput;
	readonly timeoutMs: number;
	/** Linux CLOCK_MONOTONIC deadline, shared across the host and its PID namespace. */
	readonly deadlineNs: string;
}
export interface GitWorkerNotice {
	readonly kind: "prepared" | "committed" | "ref-rejected";
	readonly candidateOid: string;
}

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new VerifiedRunError("git_worker_protocol");
	return value as Record<string, unknown>;
}
function text(value: unknown, pattern: RegExp): string {
	if (typeof value !== "string" || !pattern.test(value)) throw new VerifiedRunError("git_worker_protocol");
	return value;
}
const DIGEST = /^[a-f0-9]{64}$/;
const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export function writeGitControl(path: string, value: unknown): void {
	const temporary = `${path}.tmp`;
	publishObject(temporary, value);
	renameSync(temporary, path);
	fsyncDirectorySync(dirname(path));
}

export function serializeGitRequest(request: GitWorkerRequest): unknown {
	return {
		version: 1,
		...request.input,
		contents: [...request.input.contents].map(([digest, bytes]) => ({ digest, bytes: bytes.toString("base64") })),
		timeoutMs: request.timeoutMs,
		deadlineNs: request.deadlineNs,
	};
}

export function readGitRequest(path: string): GitWorkerRequest {
	const raw = object(readJson(path, 128 * 1024 * 1024));
	if (
		raw.version !== 1 ||
		typeof raw.timeoutMs !== "number" ||
		!Number.isSafeInteger(raw.timeoutMs) ||
		raw.timeoutMs <= 0 ||
		raw.timeoutMs > 60_000
	)
		throw new VerifiedRunError("git_worker_protocol");
	const manifest = object(raw.manifest);
	if (
		manifest.version !== 1 ||
		!Array.isArray(manifest.files) ||
		!Array.isArray(manifest.directories) ||
		!Array.isArray(raw.contents)
	)
		throw new VerifiedRunError("git_worker_protocol");
	const directories = manifest.directories.map((entry: unknown) => text(entry, /^.{1,4096}$/u));
	const files: CandidateFile[] = manifest.files.map((entry: unknown) => {
		const file = object(entry);
		if (typeof file.mode !== "number" || typeof file.size !== "number")
			throw new VerifiedRunError("git_worker_protocol");
		return {
			path: text(file.path, /^.{1,4096}$/u),
			mode: file.mode,
			size: file.size,
			digest: text(file.digest, DIGEST),
		};
	});
	const contents = new Map<string, Buffer>();
	for (const entry of raw.contents) {
		const blob = object(entry);
		const digest = text(blob.digest, DIGEST);
		if (typeof blob.bytes !== "string" || contents.has(digest)) throw new VerifiedRunError("git_worker_protocol");
		contents.set(digest, Buffer.from(blob.bytes, "base64"));
	}
	const candidate: CandidateManifest = { version: 1, directories, files };
	preflightGitCandidate(candidate, contents);
	const candidateDigest = text(raw.candidateDigest, DIGEST);
	if (digestObject(candidate) !== candidateDigest) throw new VerifiedRunError("integrity");
	const parentOid = text(raw.parentOid, OID);
	const zeroOid = text(raw.zeroOid, /^(?:0{40}|0{64})$/);
	if (parentOid.length !== zeroOid.length) throw new VerifiedRunError("git_worker_protocol");
	return {
		timeoutMs: raw.timeoutMs,
		deadlineNs: text(raw.deadlineNs, /^\d{1,24}$/),
		input: {
			manifest: candidate,
			contents,
			candidateDigest,
			parentOid,
			zeroOid,
			runId: text(raw.runId, /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),
			receiptDigest: text(raw.receiptDigest, DIGEST),
		},
	};
}

export function readGitStartGate(path: string): GitWorkerNotice & { readonly authorizationDeadline: number } {
	const raw = object(readJson(path, 4096));
	if (
		raw.kind !== "prepared" ||
		typeof raw.authorizationDeadline !== "number" ||
		!Number.isSafeInteger(raw.authorizationDeadline) ||
		Date.now() >= raw.authorizationDeadline
	)
		throw new VerifiedRunError("authority");
	return {
		kind: "prepared",
		candidateOid: text(raw.candidateOid, OID),
		authorizationDeadline: raw.authorizationDeadline,
	};
}

export function readGitNotice(path: string): GitWorkerNotice {
	const raw = object(readJson(path, 4096));
	if (raw.kind !== "prepared" && raw.kind !== "committed" && raw.kind !== "ref-rejected")
		throw new VerifiedRunError("git_worker_protocol");
	return { kind: raw.kind, candidateOid: text(raw.candidateOid, OID) };
}
