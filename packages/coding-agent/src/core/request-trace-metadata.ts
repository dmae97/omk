/**
 * Metadata-only helpers for RequestTrace (spec 101). Prompt and tool text are
 * reduced to HMAC-SHA256 fingerprints keyed by a per-project salt; the raw
 * bytes never leave this module. An unsalted hash of a near-constant prompt
 * prefix could be matched against guesses, so the salt is required.
 */
import { createHmac, randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { join } from "node:path";

export const REQUEST_PURPOSES = ["main", "retry", "compaction", "suggestion", "unknown"] as const;
export type RequestPurpose = (typeof REQUEST_PURPOSES)[number];

export interface DispatchFingerprints {
	readonly prefix: string;
	readonly tools: string;
}

export type BoundaryChangeReason =
	| "first"
	| "unchanged"
	| "prefix_changed"
	| "tools_changed"
	| "prefix_and_tools_changed"
	| "unavailable"
	// Spec 102: the prefix before the boundary matched the turn plan; only the tail changed.
	| "suffix_changed"
	| "bypass_surrogate"
	| "flag_off";

const SALT_BYTES = 32;

/** Read or create `<cwd>/.omk/trace-salt` (mode 0600). Refuses a salt readable by group or others. */
export function loadProjectTraceSalt(cwd: string): Buffer {
	const dir = join(cwd, ".omk");
	const path = join(dir, "trace-salt");
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	try {
		const fd = openSync(
			path,
			constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
			0o600,
		);
		try {
			const salt = randomBytes(SALT_BYTES);
			writeSync(fd, salt);
			return salt;
		} finally {
			closeSync(fd);
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
	const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		if ((fstatSync(fd).mode & 0o077) !== 0) throw new Error("trace.salt_permissions");
		const salt = readFileSync(fd);
		if (salt.length !== SALT_BYTES) throw new Error("trace.salt_invalid");
		return salt;
	} finally {
		closeSync(fd);
	}
}

function hmac(salt: Buffer, value: string): string {
	return createHmac("sha256", salt).update(value, "utf8").digest("hex");
}

interface FingerprintContext {
	readonly systemPrompt?: string;
	readonly tools?: readonly { readonly name: string; readonly description?: string; readonly parameters?: unknown }[];
}

/** Stable-prefix (system prompt) and tool-schema fingerprints. Read-only: the context is not modified. */
export function dispatchFingerprints(salt: Buffer, context: FingerprintContext): DispatchFingerprints {
	const tools = (context.tools ?? []).map((tool) => [tool.name, tool.description ?? "", tool.parameters ?? null]);
	return { prefix: hmac(salt, context.systemPrompt ?? ""), tools: hmac(salt, JSON.stringify(tools)) };
}

export function boundaryChangeReason(
	previous: DispatchFingerprints | undefined,
	current: DispatchFingerprints | undefined,
	prefixCause?: "suffix_changed" | "bypass_surrogate" | "flag_off",
): BoundaryChangeReason {
	if (current === undefined) return "unavailable";
	if (previous === undefined) return "first";
	// Spec 102: the session cause explains a prompt change; a tool change still dominates.
	if (prefixCause && previous.tools === current.tools) return prefixCause;
	const prefix = previous.prefix !== current.prefix;
	const tools = previous.tools !== current.tools;
	if (prefix && tools) return "prefix_and_tools_changed";
	if (prefix) return "prefix_changed";
	if (tools) return "tools_changed";
	return "unchanged";
}
