import { createHash } from "node:crypto";
import path from "node:path";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface ReplayLedgerEventInput {
	sequence: number;
	type: string;
	reducerVersion: number;
	payload: JsonValue;
	beforeStateHash: string;
	afterStateHash: string;
	prevEventHash: string | null;
}

export interface ReplayLedgerEvent extends ReplayLedgerEventInput {
	eventHash: string;
}

export interface ReplayLedgerVerificationResult {
	ok: boolean;
	error?: string;
}

export interface ArtifactReference {
	path: string;
	repoRoot: string;
	sha256: string;
}

export interface ResolvedArtifactReference {
	realPath: string;
	isFile: boolean;
	sha256: string;
}

export type ArtifactReferenceResolver = (path: string) => ResolvedArtifactReference | undefined;

export function stableStringify(value: JsonValue): string {
	if (value === null) {
		return "null";
	}
	if (typeof value === "string") {
		return JSON.stringify(value);
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new Error("Cannot stableStringify non-finite number");
		}
		return JSON.stringify(value);
	}
	if (typeof value === "boolean") {
		return value ? "true" : "false";
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(",")}]`;
	}
	if (!isPlainObject(value)) {
		throw new Error("Cannot stableStringify unsupported object");
	}

	const record = value as { readonly [key: string]: JsonValue | undefined };
	const parts: string[] = [];
	for (const key of Object.keys(record).sort()) {
		const entryValue = record[key];
		if (entryValue === undefined) {
			throw new Error(`Cannot stableStringify undefined value at key ${key}`);
		}
		parts.push(`${JSON.stringify(key)}:${stableStringify(entryValue)}`);
	}
	return `{${parts.join(",")}}`;
}

export function sha256Hex(input: string): string {
	return createHash("sha256").update(input).digest("hex");
}

export function computeEventHash(event: ReplayLedgerEventInput): string {
	return sha256Hex(stableStringify(eventToJson(event)));
}

export function verifyReplayLedger(events: readonly ReplayLedgerEvent[]): ReplayLedgerVerificationResult {
	let previous: ReplayLedgerEvent | undefined;
	for (let index = 0; index < events.length; index += 1) {
		const current = events[index];
		if (current.sequence !== index + 1) {
			return { ok: false, error: `sequence mismatch at index ${index}: expected ${index + 1}` };
		}

		const expectedHash = computeEventHash(stripEventHash(current));
		if (current.eventHash !== expectedHash) {
			return { ok: false, error: `eventHash mismatch at sequence ${current.sequence}` };
		}

		const expectedPrevHash = previous?.eventHash ?? null;
		if (current.prevEventHash !== expectedPrevHash) {
			return { ok: false, error: `prevEventHash mismatch at sequence ${current.sequence}` };
		}

		if (previous !== undefined && current.beforeStateHash !== previous.afterStateHash) {
			return { ok: false, error: `beforeStateHash mismatch at sequence ${current.sequence}` };
		}

		previous = current;
	}
	return { ok: true };
}

export function verifyArtifactReference(
	ref: ArtifactReference,
	resolver: ArtifactReferenceResolver,
): ReplayLedgerVerificationResult {
	const resolved = resolver(ref.path);
	if (resolved === undefined) {
		return { ok: false, error: `artifact not found: ${ref.path}` };
	}
	if (!resolved.isFile) {
		return { ok: false, error: `artifact is not a file: ${ref.path}` };
	}
	if (!pathIsInside(ref.repoRoot, resolved.realPath)) {
		return { ok: false, error: `artifact resolved outside repo root: ${resolved.realPath}` };
	}
	if (resolved.sha256 !== ref.sha256) {
		return { ok: false, error: `artifact sha256 mismatch for ${ref.path}` };
	}
	return { ok: true };
}

function isPlainObject(value: object): boolean {
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function stripEventHash(event: ReplayLedgerEvent): ReplayLedgerEventInput {
	return {
		sequence: event.sequence,
		type: event.type,
		reducerVersion: event.reducerVersion,
		payload: event.payload,
		beforeStateHash: event.beforeStateHash,
		afterStateHash: event.afterStateHash,
		prevEventHash: event.prevEventHash,
	};
}

function eventToJson(event: ReplayLedgerEventInput): { readonly [key: string]: JsonValue } {
	return {
		sequence: event.sequence,
		type: event.type,
		reducerVersion: event.reducerVersion,
		payload: event.payload,
		beforeStateHash: event.beforeStateHash,
		afterStateHash: event.afterStateHash,
		prevEventHash: event.prevEventHash,
	};
}

function normalizePath(value: string): string {
	return path.resolve(value).replace(/\\/g, "/").replace(/\/$/, "");
}

function pathIsInside(root: string, candidate: string): boolean {
	const normalizedRoot = normalizePath(root);
	const normalizedCandidate = normalizePath(candidate);
	return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`);
}
