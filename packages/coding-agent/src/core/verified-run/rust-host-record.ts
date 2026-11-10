import { lstatSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type NamespaceIdentity, parseNamespaceIdentity } from "./namespace-identity.ts";
import { type NativePhaseDeadline, parseNativePhaseDeadline } from "./native-phase-deadline.ts";
import { VerifiedRunError } from "./storage.ts";

/**
 * Rust owns one durable record per native request: accepted, ready (namespace
 * identity), committed, detached (parent lost), then finished or error. The
 * request ID is the Node execution ID without dashes, so the authority journal
 * and the host record share one key and the host refuses a second start for it.
 */
export const nativeExecutionDir = (stateRoot: string): string => join(stateRoot, "native-exec");
export const nativeRequestId = (executionId: string): string => executionId.replaceAll("-", "").toLowerCase();

type Terminal =
	| {
			readonly kind: "finished";
			readonly exitCode: number | null;
			readonly failure: string | null;
			readonly durationMs: number;
			readonly output: { readonly stdout: Buffer; readonly stderr: Buffer } | null;
	  }
	| { readonly kind: "error"; readonly code: string };

export interface RustExecutionRecord {
	readonly requestId: string;
	readonly host: { readonly pid: number; readonly ticks: string; readonly bootId: string | null };
	readonly startedAtMs: number | null;
	readonly bindingDigest: string | null;
	readonly phaseDeadline: NativePhaseDeadline | null;
	/** True only when read through the native fsync-published prefix marker. */
	readonly durable: boolean;
	readonly identity: NamespaceIdentity | null;
	readonly committed: boolean;
	readonly detached: boolean;
	readonly terminal: Terminal | null;
}

const CODE = /^[a-z_]{1,64}$/;
const HEX = /^(?:[a-f0-9]{2})*$/;

type Line = Readonly<Record<string, unknown>>;

function parseLine(text: string): Line {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new VerifiedRunError("integrity");
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new VerifiedRunError("integrity");
	return value as Line;
}
function stringField(line: Line, key: string): string {
	const value = line[key];
	if (typeof value !== "string") throw new VerifiedRunError("integrity");
	return value;
}
function countField(line: Line, key: string): number {
	const value = line[key];
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new VerifiedRunError("integrity");
	return value;
}
const exactKeys = (line: Line, expected: readonly string[]): boolean =>
	Object.keys(line).length === expected.length && expected.every((key) => key in line);

function hexBytes(text: string, limit: number): Buffer {
	if (!HEX.test(text) || text.length / 2 > limit) throw new VerifiedRunError("integrity");
	return Buffer.from(text, "hex");
}

/** Strict reducer over the record lines; a torn final line is an append still in flight. */
export function parseRustExecutionRecord(text: string, requestId: string, maxOutputBytes: number): RustExecutionRecord {
	const lines = text.split("\n");
	lines.pop();
	let record: { -readonly [K in keyof RustExecutionRecord]: RustExecutionRecord[K] } | undefined;
	for (const raw of lines) {
		const line = parseLine(raw);
		const kind = stringField(line, "kind");
		if (!record) {
			const bound = "hostBootId" in line;
			if (
				kind !== "accepted" ||
				!exactKeys(line, [
					"kind",
					"requestId",
					"hostPid",
					"hostTicks",
					...(bound ? ["hostBootId", "startedAtMs", "bindingDigest"] : []),
					...(bound && "phaseDeadline" in line ? ["phaseDeadline"] : []),
				])
			)
				throw new VerifiedRunError("integrity");
			const ticks = stringField(line, "hostTicks");
			const pid = countField(line, "hostPid");
			if (stringField(line, "requestId") !== requestId || !/^\d{1,32}$/.test(ticks) || pid === 0)
				throw new VerifiedRunError("integrity");
			const bootId = bound ? stringField(line, "hostBootId") : null;
			const startedAtMs = bound ? countField(line, "startedAtMs") : null;
			const bindingDigest = bound && line.bindingDigest !== null ? stringField(line, "bindingDigest") : null;
			if (
				(bootId !== null && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(bootId)) ||
				(startedAtMs !== null && startedAtMs > 8_640_000_000_000_000) ||
				(bindingDigest !== null && !/^[a-f0-9]{64}$/.test(bindingDigest))
			)
				throw new VerifiedRunError("integrity");
			record = {
				requestId,
				host: { pid, ticks, bootId },
				startedAtMs,
				bindingDigest,
				phaseDeadline: "phaseDeadline" in line ? parseNativePhaseDeadline(line.phaseDeadline) : null,
				durable: false,
				identity: null,
				committed: false,
				detached: false,
				terminal: null,
			};
			continue;
		}
		if (record.terminal) throw new VerifiedRunError("integrity");
		switch (kind) {
			case "ready":
				if (record.identity || !exactKeys(line, ["kind", "identity"])) throw new VerifiedRunError("integrity");
				record.identity = parseNamespaceIdentity(line.identity);
				break;
			case "committed":
				if (!record.identity || record.committed || !exactKeys(line, ["kind"]))
					throw new VerifiedRunError("integrity");
				record.committed = true;
				break;
			case "detached":
				if (!record.committed || record.detached || !exactKeys(line, ["kind"]))
					throw new VerifiedRunError("integrity");
				record.detached = true;
				break;
			case "error": {
				const code = stringField(line, "code");
				if (!CODE.test(code) || !exactKeys(line, ["kind", "code"])) throw new VerifiedRunError("integrity");
				record.terminal = { kind: "error", code };
				break;
			}
			case "finished": {
				const withOutput = "stdout" in line;
				if (
					!exactKeys(line, [
						"kind",
						"exitCode",
						"failure",
						"durationMs",
						...(withOutput ? ["stdout", "stderr"] : []),
					]) ||
					(record.detached && !withOutput) ||
					(withOutput && !record.committed)
				)
					throw new VerifiedRunError("integrity");
				const exitCode = line.exitCode;
				const failure = line.failure;
				if (exitCode !== null && (typeof exitCode !== "number" || !Number.isSafeInteger(exitCode)))
					throw new VerifiedRunError("integrity");
				if (failure !== null && (typeof failure !== "string" || !CODE.test(failure)))
					throw new VerifiedRunError("integrity");
				if (failure === null && (!record.committed || exitCode !== 0)) throw new VerifiedRunError("integrity");
				const output = withOutput
					? {
							stdout: hexBytes(stringField(line, "stdout"), maxOutputBytes),
							stderr: hexBytes(stringField(line, "stderr"), maxOutputBytes),
						}
					: null;
				if (output && output.stdout.length + output.stderr.length > maxOutputBytes)
					throw new VerifiedRunError("integrity");
				record.terminal = {
					kind: "finished",
					exitCode,
					failure,
					durationMs: countField(line, "durationMs"),
					output,
				};
				break;
			}
			default:
				throw new VerifiedRunError("integrity");
		}
	}
	if (!record) throw new VerifiedRunError("missing_record");
	return Object.freeze(record);
}

/** Owner-only regular file, bounded by the hex-encoded output budget. */
export function readRustExecutionRecord(
	dir: string,
	requestId: string,
	maxOutputBytes: number,
	retired = false,
): RustExecutionRecord | null {
	const path = join(dir, `${requestId}${retired ? ".gc" : ""}.jsonl`);
	let stat: ReturnType<typeof lstatSync>;
	try {
		stat = lstatSync(path);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
		throw error;
	}
	const directory = lstatSync(dir);
	if (
		!directory.isDirectory() ||
		(directory.mode & 0o077) !== 0 ||
		directory.uid !== process.getuid?.() ||
		!stat.isFile() ||
		(stat.mode & 0o077) !== 0 ||
		stat.uid !== process.getuid?.() ||
		stat.size > maxOutputBytes * 4 + 65_536
	)
		throw new VerifiedRunError("integrity");
	let committedSize: number | undefined;
	try {
		const headPath = join(dir, `${requestId}.head`);
		const head = lstatSync(headPath);
		if (!head.isFile() || head.uid !== process.getuid?.() || (head.mode & 0o077) !== 0 || head.size > 32)
			throw new VerifiedRunError("integrity");
		const text = readFileSync(headPath, "utf8");
		if (!/^[1-9]\d{0,9}\n$/.test(text)) throw new VerifiedRunError("integrity");
		committedSize = Number(text.trim());
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
	}
	const bytes = readFileSync(path);
	if (
		bytes.length > maxOutputBytes * 4 + 65_536 ||
		(committedSize !== undefined && (committedSize > bytes.length || bytes[committedSize - 1] !== 10))
	)
		throw new VerifiedRunError("integrity");
	const record = parseRustExecutionRecord(
		bytes.subarray(0, committedSize).toString("utf8"),
		requestId,
		maxOutputBytes,
	);
	return Object.freeze({ ...record, durable: committedSize !== undefined });
}

/** Idempotent cancel request a detached host polls; creating it twice is one request. */
export function requestRustCancel(dir: string, requestId: string): void {
	try {
		writeFileSync(join(dir, `${requestId}.cancel`), "", { flag: "wx", mode: 0o600 });
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
	}
}

export function discardRustExecutionRecord(dir: string, requestId: string): void {
	for (const name of [`${requestId}.jsonl`, `${requestId}.cancel`, `${requestId}.head`]) {
		try {
			unlinkSync(join(dir, name));
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
		}
	}
}
