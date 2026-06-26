/**
 * Evidence capture + secret redaction.
 *
 * Browser results (DOM text, page content, downloaded files) are UNTRUSTED web
 * content and may contain secrets (autofilled passwords, API keys, tokens) that
 * must never reach the model or logs. `redactSecrets` deep-walks a value and
 * replaces values whose path/name smells like a credential.
 *
 * Pure-ish: `hashFile` reads the filesystem, but redaction is pure.
 */

import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { Evidence } from "./types.ts";

/** Key fragments that mark a value as secret. */
const SECRET_FRAGMENTS = [
	"password",
	"passwd",
	"pwd",
	"secret",
	"token",
	"apikey",
	"api_key",
	"api-key",
	"accesstoken",
	"access_token",
	"refreshtoken",
	"refresh_token",
	"accesstokensecret",
	"privatekey",
	"private_key",
	"clientsecret",
	"client_secret",
	"authorization",
	"cardnumber",
	"card_number",
	"cvv",
	"cvc",
	"ssn",
];

const REDACTED = "[REDACTED]";

const AUTHORIZATION_BEARER_PATTERN = /\b(Authorization\s*:\s*Bearer\s+)([^\s"',;<>]+)/gi;
const QUOTED_SECRET_KV_PATTERN =
	/((?:^|[?&\s,{])["']?(?:access[_-]?token|api[_-]?key|password|token|cvv|cvc)["']?\s*[:=]\s*["'])([^"']+)(["'])/gi;
const UNQUOTED_SECRET_KV_PATTERN =
	/((?:^|[?&\s,{])["']?(?:access[_-]?token|api[_-]?key|password|token|cvv|cvc)["']?\s*[:=]\s*)([^&\s"',;<>}]+)/gi;
const CARD_LIKE_PATTERN = /\b(?:\d[ -]*?){13,19}\b/g;
const SECRET_WORD_PATTERN = /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|API|AUTH|BEARER|STRIPE)/;

function looksSecret(key: string): boolean {
	const lower = key.toLowerCase();
	return SECRET_FRAGMENTS.some((frag) => lower.includes(frag));
}

/** Looks like an API key / token: long, high entropy-ish alphanumeric (+_-). */
function looksLikeToken(value: string): boolean {
	if (value.length < 16) return false;
	// contains no spaces, mostly [A-Za-z0-9_-], at least one digit or mixed case
	if (/\s/.test(value)) return false;
	if (!/^[A-Za-z0-9_.\-:/]+$/.test(value)) return false;
	const hasDigit = /\d/.test(value);
	const hasUpper = /[A-Z]/.test(value);
	const hasLower = /[a-z]/.test(value);
	if (!hasDigit && !hasLower && hasUpper && SECRET_WORD_PATTERN.test(value)) return true;
	return hasDigit && (hasUpper || hasLower);
}

/**
 * Deep-clone a value with secret fields replaced by `[REDACTED]`.
 * Handles plain objects, arrays, and nested combinations. Non-credential
 * strings are passed through unchanged.
 *
 * @example
 * redactSecrets({ user: "a", password: "hunter2" })
 * // { user: "a", password: "[REDACTED]" }
 */
export interface RedactionResult<T> {
	readonly value: T;
	readonly redactionCount: number;
}

export interface RedactedEvidence extends Evidence {
	readonly redactionCount?: number;
}

export interface EvidenceRecord {
	readonly evidence: RedactedEvidence;
	readonly redactionCount: number;
	readonly capturedAt: string;
}

export function redactSecrets<T>(value: T): T {
	return redactSecretsWithCount(value).value;
}

export function redactSecretsWithCount<T>(value: T): RedactionResult<T> {
	const result = walk(value, "");
	return { value: result.value as T, redactionCount: result.redactionCount };
}

function walk(value: unknown, key: string): RedactionResult<unknown> {
	if (Array.isArray(value)) {
		let redactionCount = 0;
		const out = value.map((item) => {
			const result = walk(item, key);
			redactionCount += result.redactionCount;
			return result.value;
		});
		return { value: out, redactionCount };
	}
	if (value && typeof value === "object") {
		const obj = value as Record<string, unknown>;
		const out: Record<string, unknown> = {};
		let redactionCount = 0;
		for (const [k, v] of Object.entries(obj)) {
			if (looksSecret(k)) {
				out[k] = REDACTED;
				redactionCount += 1;
				continue;
			}
			const result = walk(v, k);
			out[k] = result.value;
			redactionCount += result.redactionCount;
		}
		return { value: out, redactionCount };
	}
	if (typeof value === "string") {
		if (looksSecret(key) || looksLikeToken(value)) return { value: REDACTED, redactionCount: 1 };
		return redactEmbeddedSecrets(value);
	}
	return { value, redactionCount: 0 };
}

function redactEmbeddedSecrets(value: string): RedactionResult<string> {
	let redactionCount = 0;
	let redacted = value.replace(AUTHORIZATION_BEARER_PATTERN, (_match: string, prefix: string, secret: string) => {
		if (secret === REDACTED) return `${prefix}${secret}`;
		redactionCount += 1;
		return `${prefix}${REDACTED}`;
	});
	redacted = redacted.replace(
		QUOTED_SECRET_KV_PATTERN,
		(_match: string, prefix: string, secret: string, suffix: string) => {
			if (secret === REDACTED) return `${prefix}${secret}${suffix}`;
			redactionCount += 1;
			return `${prefix}${REDACTED}${suffix}`;
		},
	);
	redacted = redacted.replace(UNQUOTED_SECRET_KV_PATTERN, (_match: string, prefix: string, secret: string) => {
		if (secret === REDACTED) return `${prefix}${secret}`;
		redactionCount += 1;
		return `${prefix}${REDACTED}`;
	});
	redacted = redacted.replace(CARD_LIKE_PATTERN, (match) => {
		const digits = match.replace(/[ -]/g, "");
		if (!isLikelyPaymentCard(digits)) return match;
		redactionCount += 1;
		return REDACTED;
	});
	return { value: redacted, redactionCount };
}

function isLikelyPaymentCard(digits: string): boolean {
	if (!/^\d{13,19}$/.test(digits)) return false;
	let sum = 0;
	let shouldDouble = false;
	for (let i = digits.length - 1; i >= 0; i -= 1) {
		let digit = Number(digits[i]);
		if (shouldDouble) {
			digit *= 2;
			if (digit > 9) digit -= 9;
		}
		sum += digit;
		shouldDouble = !shouldDouble;
	}
	return sum % 10 === 0;
}

/** Compute sha256 of a file on disk (for download evidence integrity). */
export async function hashFile(path: string): Promise<string> {
	const data = await readFile(path);
	return createHash("sha256").update(data).digest("hex");
}

/** Compute sha256 only after proving the file's real path stays inside root. */
export async function hashFileWithinRoot(filePath: string, root: string): Promise<string> {
	const rootRealPath = await realpath(resolve(root));
	const requestedPath = isAbsolute(filePath) ? filePath : resolve(root, filePath);
	const fileRealPath = await realpath(requestedPath);
	if (!isPathWithinRoot(fileRealPath, rootRealPath)) {
		throw new Error(`Refusing to hash file outside root: ${filePath}`);
	}
	return hashFile(fileRealPath);
}

function isPathWithinRoot(filePath: string, root: string): boolean {
	const relativePath = relative(root, filePath);
	return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

/** Build a DOM-text evidence record. */
export function domTextEvidence(value: string, source?: string): RedactedEvidence {
	const result = redactSecretsWithCount(value);
	if (result.redactionCount === 0) return { type: "dom_text", value: result.value, source };
	return { type: "dom_text", value: result.value, source, redactionCount: result.redactionCount };
}

export function createEvidenceRecord(evidence: Evidence, capturedAt = new Date().toISOString()): EvidenceRecord {
	const result = redactSecretsWithCount(evidence);
	return {
		evidence: withRedactionCount(result.value, result.redactionCount),
		redactionCount: result.redactionCount,
		capturedAt,
	};
}

function withRedactionCount(evidence: Evidence, redactionCount: number): RedactedEvidence {
	if (redactionCount === 0) return evidence;
	return { ...evidence, redactionCount };
}

/** Build a screenshot evidence record with optional integrity hash. */
export function screenshotEvidence(path: string, sha256?: string): Evidence {
	return { type: "screenshot", path, sha256 };
}
