import { createHash, randomUUID } from "node:crypto";
import {
	closeSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

export type HarnessControlEventStatus = "started" | "completed" | "failed" | "blocked" | "rolled_back" | "in_doubt";

export type HarnessControlEventKind =
	| "compaction.summary.generated"
	| "extension.migration.plan"
	| "extension.migration.apply"
	| "interactive.model_thinking.commit"
	| "interactive.theme.apply"
	| "keybinding.conflict"
	| "spec.compile"
	| "spec.verify"
	| (string & {});

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface HarnessControlArtifactManifestEntry {
	path: string;
	exists: boolean;
	allowed: boolean;
	sizeBytes?: number;
	sha256?: string;
	error?: string;
}

export interface HarnessControlEvent {
	schemaVersion: "omk.harness-control.event.v2";
	eventId: string;
	runId: string;
	sessionId: string;
	operationId: string;
	causationId: string | null;
	correlationId: string;
	sequence: number;
	timestamp: string;
	kind: HarnessControlEventKind;
	status: HarnessControlEventStatus;
	cwd: string;
	beforeStateHash: string;
	afterStateHash: string;
	data: JsonObject;
	dataHash: string;
	artifacts: HarnessControlArtifactManifestEntry[];
	previousEventHash: string;
	eventHash: string;
}

export interface HarnessControlEventWriteResult {
	ok: boolean;
	path?: string;
	event?: HarnessControlEvent;
	error?: string;
}

export interface HarnessControlEventOptions {
	cwd?: string;
	logPath?: string;
	now?: Date;
	id?: string;
	eventId?: string;
	runId?: string;
	sessionId?: string;
	operationId?: string;
	causationId?: string | null;
	correlationId?: string;
	beforeState?: unknown;
	afterState?: unknown;
	artifactRefs?: string[];
	allowedArtifactRoots?: string[];
	lockTimeoutMs?: number;
	maxLedgerBytes?: number;
}

export interface HarnessControlLedgerVerificationResult {
	ok: boolean;
	events: HarnessControlEvent[];
	errors: string[];
}

interface PreviousEventState {
	sequence: number;
	eventHash: string;
}

const MAX_EVENT_DEPTH = 6;
const MAX_EVENT_OBJECT_KEYS = 80;
const MAX_EVENT_ARRAY_ITEMS = 80;
const MAX_EVENT_STRING_LENGTH = 2000;
const REDACTED = "[redacted]";
const GENESIS_EVENT_HASH = "0".repeat(64);
const DEFAULT_RUN_ID = "default-run";
const DEFAULT_SESSION_ID = "sessionless";
const LOCK_STALE_MS = 30000;

function isSensitiveKey(key: string): boolean {
	return /(?:secret|token|api[_-]?key|authorization|password|credential|private[_-]?key)/i.test(key);
}

function redactSensitiveValue(value: string): string {
	let redacted = value;
	redacted = redacted.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`);
	redacted = redacted.replace(/sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}/g, REDACTED);
	redacted = redacted.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED);
	redacted = redacted.replace(/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/g, REDACTED);
	redacted = redacted.replace(/\b[A-Fa-f0-9]{64,}\b/g, REDACTED);
	return redacted;
}

function truncateString(value: string): string {
	const redacted = redactSensitiveValue(value);
	if (redacted.length <= MAX_EVENT_STRING_LENGTH) return redacted;
	return `${redacted.slice(0, MAX_EVENT_STRING_LENGTH)}…[truncated]`;
}

function sanitizeValue(value: unknown, depth: number, seen: WeakSet<object>): JsonValue {
	if (value === null) return null;
	if (typeof value === "string") return truncateString(value);
	if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
	if (typeof value === "boolean") return value;
	if (typeof value === "bigint") return value.toString();
	if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") return String(value);
	if (depth >= MAX_EVENT_DEPTH) return "[max-depth]";

	if (Array.isArray(value)) {
		return value.slice(0, MAX_EVENT_ARRAY_ITEMS).map((entry) => sanitizeValue(entry, depth + 1, seen));
	}

	if (value instanceof Date) return value.toISOString();
	if (value instanceof Error) {
		return {
			name: value.name,
			message: truncateString(value.message),
		};
	}

	if (typeof value === "object") {
		if (seen.has(value)) return "[circular]";
		seen.add(value);
		const result: JsonObject = {};
		for (const [key, entry] of Object.entries(value).slice(0, MAX_EVENT_OBJECT_KEYS)) {
			result[key] = isSensitiveKey(key) ? REDACTED : sanitizeValue(entry, depth + 1, seen);
		}
		seen.delete(value);
		return result;
	}

	return String(value);
}

export function sanitizeHarnessControlEventData(data: unknown): JsonObject {
	const sanitized = sanitizeValue(data ?? {}, 0, new WeakSet<object>());
	return typeof sanitized === "object" && sanitized !== null && !Array.isArray(sanitized)
		? sanitized
		: { value: sanitized };
}

export function canonicalJson(value: JsonValue): string {
	if (value === null) return "null";
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
	}
	return `{${Object.keys(value)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] ?? null)}`)
		.join(",")}}`;
}

export function hashCanonical(value: unknown): string {
	return createHash("sha256")
		.update(canonicalJson(sanitizeValue(value, 0, new WeakSet<object>())))
		.digest("hex");
}

function sha256Text(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function sha256File(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function isPathWithin(parent: string, child: string): boolean {
	const resolvedParent = resolve(parent);
	const resolvedChild = resolve(child);
	return resolvedChild === resolvedParent || resolvedChild.startsWith(`${resolvedParent}${sep}`);
}

function isSensitivePath(path: string): boolean {
	return /(?:^|[/\\])(?:\.env[^/\\]*|auth\.json|oauth\.json|.*(?:secret|token|credential|private[_-]?key).*)$/i.test(
		path,
	);
}

function defaultAllowedArtifactRoots(cwd: string, logPath: string): string[] {
	return [cwd, dirname(logPath)];
}

function createArtifactManifest(
	artifactRefs: string[] | undefined,
	cwd: string,
	logPath: string,
	allowedArtifactRoots: string[] | undefined,
): HarnessControlArtifactManifestEntry[] {
	if (!artifactRefs || artifactRefs.length === 0) return [];
	const roots = (allowedArtifactRoots ?? defaultAllowedArtifactRoots(cwd, logPath)).map((root) => resolve(root));
	return artifactRefs.map((artifactPath) => {
		const resolvedPath = resolve(cwd, artifactPath);
		const allowed = roots.some((root) => isPathWithin(root, resolvedPath)) && !isSensitivePath(resolvedPath);
		if (!allowed) return { path: artifactPath, exists: existsSync(resolvedPath), allowed: false };
		if (!existsSync(resolvedPath)) return { path: artifactPath, exists: false, allowed: true };
		try {
			const stats = statSync(resolvedPath);
			if (!stats.isFile()) return { path: artifactPath, exists: true, allowed: true, sizeBytes: stats.size };
			return {
				path: artifactPath,
				exists: true,
				allowed: true,
				sizeBytes: stats.size,
				sha256: sha256File(resolvedPath),
			};
		} catch (error) {
			return {
				path: artifactPath,
				exists: existsSync(resolvedPath),
				allowed: true,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	});
}

export function resolveHarnessControlEventLogPath(options: HarnessControlEventOptions = {}): string | undefined {
	if (process.env.OMK_HARNESS_CONTROL_EVENTS === "0") return undefined;
	if (options.logPath) return options.logPath;
	if (process.env.OMK_HARNESS_CONTROL_EVENT_LOG) return process.env.OMK_HARNESS_CONTROL_EVENT_LOG;
	const runId = options.runId ?? DEFAULT_RUN_ID;
	return join(options.cwd ?? process.cwd(), ".omk", "runs", runId, "harness-control", "events.jsonl");
}

function eventHashInput(eventWithoutHash: Omit<HarnessControlEvent, "eventHash">): string {
	return `${canonicalJson(eventWithoutHash as unknown as JsonObject)}${eventWithoutHash.previousEventHash}`;
}

function computeEventHash(eventWithoutHash: Omit<HarnessControlEvent, "eventHash">): string {
	return sha256Text(eventHashInput(eventWithoutHash));
}

function readPreviousEventState(logPath: string): PreviousEventState {
	if (!existsSync(logPath)) return { sequence: 0, eventHash: GENESIS_EVENT_HASH };
	const lines = readFileSync(logPath, "utf-8")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (lines.length === 0) return { sequence: 0, eventHash: GENESIS_EVENT_HASH };
	const parsed = JSON.parse(lines.at(-1)!) as Partial<HarnessControlEvent>;
	if (parsed.schemaVersion !== "omk.harness-control.event.v2") {
		return { sequence: 0, eventHash: GENESIS_EVENT_HASH };
	}
	if (typeof parsed.sequence !== "number" || typeof parsed.eventHash !== "string") {
		throw new Error("Previous harness event is missing sequence or eventHash");
	}
	return { sequence: parsed.sequence, eventHash: parsed.eventHash };
}

function acquireLock(lockPath: string, timeoutMs: number): number {
	const start = Date.now();
	while (true) {
		try {
			return openSync(lockPath, "wx", 0o600);
		} catch (error) {
			if (existsSync(lockPath)) {
				try {
					const stats = statSync(lockPath);
					if (Date.now() - stats.mtimeMs > LOCK_STALE_MS) rmSync(lockPath, { force: true });
				} catch {}
			}
			if (Date.now() - start >= timeoutMs) {
				throw error;
			}
		}
	}
}

function formatRotationTimestamp(date: Date): string {
	return date.toISOString().replace(/[:.]/g, "-");
}

function rotateLedgerIfNeeded(path: string, maxLedgerBytes: number | undefined, now: Date): string | undefined {
	if (!Number.isFinite(maxLedgerBytes) || (maxLedgerBytes ?? 0) <= 0 || !existsSync(path)) return undefined;
	const stats = statSync(path);
	if (stats.size < Math.floor(maxLedgerBytes ?? 0)) return undefined;
	const rotatedPath = `${path}.${formatRotationTimestamp(now)}.rotated`;
	renameSync(path, rotatedPath);
	return rotatedPath;
}

function appendJsonLineWithFsync(path: string, line: string): void {
	const fd = openSync(path, "a", 0o600);
	try {
		writeSync(fd, `${line}\n`, undefined, "utf-8");
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
	try {
		const dirFd = openSync(dirname(path), "r");
		try {
			fsyncSync(dirFd);
		} finally {
			closeSync(dirFd);
		}
	} catch {
		// Some platforms/filesystems do not support directory fsync; file fsync above is still mandatory.
	}
}

export function createHarnessControlEvent(
	kind: HarnessControlEventKind,
	status: HarnessControlEventStatus,
	data: unknown = {},
	options: HarnessControlEventOptions = {},
	previous: PreviousEventState = { sequence: 0, eventHash: GENESIS_EVENT_HASH },
): HarnessControlEvent {
	const eventId = options.eventId ?? options.id ?? randomUUID();
	const operationId = options.operationId ?? eventId;
	const logPath = resolveHarnessControlEventLogPath(options) ?? "";
	const cwd = options.cwd ?? process.cwd();
	const sanitizedData = sanitizeHarnessControlEventData(data);
	const eventWithoutHash: Omit<HarnessControlEvent, "eventHash"> = {
		schemaVersion: "omk.harness-control.event.v2",
		eventId,
		runId: options.runId ?? DEFAULT_RUN_ID,
		sessionId: options.sessionId ?? DEFAULT_SESSION_ID,
		operationId,
		causationId: options.causationId ?? null,
		correlationId: options.correlationId ?? operationId,
		sequence: previous.sequence + 1,
		timestamp: (options.now ?? new Date()).toISOString(),
		kind,
		status,
		cwd,
		beforeStateHash: hashCanonical(options.beforeState ?? null),
		afterStateHash: hashCanonical(options.afterState ?? null),
		data: sanitizedData,
		dataHash: hashCanonical(sanitizedData),
		artifacts: createArtifactManifest(options.artifactRefs, cwd, logPath, options.allowedArtifactRoots),
		previousEventHash: previous.eventHash,
	};
	return { ...eventWithoutHash, eventHash: computeEventHash(eventWithoutHash) };
}

export function recordHarnessControlEvent(
	kind: HarnessControlEventKind,
	status: HarnessControlEventStatus,
	data: unknown = {},
	options: HarnessControlEventOptions = {},
): HarnessControlEventWriteResult {
	const logPath = resolveHarnessControlEventLogPath(options);
	if (!logPath) return { ok: false, error: "harness control event logging disabled" };
	const lockPath = `${logPath}.lock`;
	let lockFd: number | undefined;
	try {
		mkdirSync(dirname(logPath), { recursive: true });
		lockFd = acquireLock(lockPath, options.lockTimeoutMs ?? 1000);
		rotateLedgerIfNeeded(logPath, options.maxLedgerBytes, options.now ?? new Date());
		const previous = readPreviousEventState(logPath);
		const event = createHarnessControlEvent(kind, status, data, options, previous);
		appendJsonLineWithFsync(logPath, JSON.stringify(event));
		return { ok: true, path: logPath, event };
	} catch (error) {
		return { ok: false, path: logPath, error: error instanceof Error ? error.message : String(error) };
	} finally {
		if (lockFd !== undefined) {
			try {
				closeSync(lockFd);
			} catch {}
			rmSync(lockPath, { force: true });
		}
	}
}

function validateEventHash(event: HarnessControlEvent): string | undefined {
	const { eventHash: _eventHash, ...eventWithoutHash } = event;
	const expectedEventHash = computeEventHash(eventWithoutHash);
	if (expectedEventHash !== event.eventHash) {
		return `event ${event.eventId} hash mismatch`;
	}
	if (hashCanonical(event.data) !== event.dataHash) {
		return `event ${event.eventId} dataHash mismatch`;
	}
	return undefined;
}

export function verifyHarnessControlLedger(logPath: string): HarnessControlLedgerVerificationResult {
	const errors: string[] = [];
	const events: HarnessControlEvent[] = [];
	if (!existsSync(logPath)) return { ok: true, events, errors };
	const lines = readFileSync(logPath, "utf-8")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	let previousSequence = 0;
	let previousEventHash = GENESIS_EVENT_HASH;
	for (let index = 0; index < lines.length; index++) {
		try {
			const event = JSON.parse(lines[index]!) as HarnessControlEvent;
			events.push(event);
			if (event.schemaVersion !== "omk.harness-control.event.v2") {
				errors.push(`line ${index + 1}: unsupported schemaVersion`);
				continue;
			}
			if (event.sequence !== previousSequence + 1) {
				errors.push(`line ${index + 1}: sequence gap`);
			}
			if (event.previousEventHash !== previousEventHash) {
				errors.push(`line ${index + 1}: previousEventHash mismatch`);
			}
			const hashError = validateEventHash(event);
			if (hashError) errors.push(`line ${index + 1}: ${hashError}`);
			previousSequence = event.sequence;
			previousEventHash = event.eventHash;
		} catch (error) {
			errors.push(`line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return { ok: errors.length === 0, events, errors };
}
