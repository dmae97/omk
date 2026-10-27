/**
 * Spec 110 redaction. Masking is the only lossy step of the ATIF export.
 * Env values whose NAME matches SECRET_NAME are replaced by `[REDACTED:<NAME>]`,
 * then common key shapes by `[REDACTED:PATTERN]`. Values are never logged.
 */

export const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|AUTH|COOKIE/i;
/** Shorter values (flags like "1", "true") would shred unrelated text. */
export const MIN_SECRET_LENGTH = 8;
/**
 * Key shapes: prefix + at least 16 of [A-Za-z0-9_-] (so `sk-learn` stays); Bearer at any
 * length. MIN_SECRET_LENGTH applies to env values only. The rescan uses the same list.
 */
export const KEY_PATTERNS = [
	/\bsk-[A-Za-z0-9_-]{16,}/g,
	/\bxai-[A-Za-z0-9_-]{16,}/g,
	/\bgh[pousr]_[A-Za-z0-9_-]{16,}/g,
	/\bgithub_pat_[A-Za-z0-9_-]{16,}/g,
	/\bBearer\s+[A-Za-z0-9._~+/=-]+/g,
];

/** Extra secret env names from the agent environment: comma/space separated list. */
export function parseNameList(text) {
	return (text ?? "")
		.split(/[\s,]+/)
		.map((n) => n.trim())
		.filter(Boolean);
}

/**
 * @param {Record<string, string | undefined>} env exporter (host) environment; values come from here
 * @param {string[]} extraNames names treated as secret even if SECRET_NAME does not match
 *   (`--mask-env-names` / `OMK_ATIF_MASK_ENV_NAMES`)
 */
export function collectSecrets(env, extraNames = []) {
	const forced = new Set([...extraNames, ...parseNameList(env.OMK_ATIF_MASK_ENV_NAMES)]);
	const out = [];
	for (const [name, value] of Object.entries(env)) {
		if (typeof value !== "string" || value.length < MIN_SECRET_LENGTH) continue;
		if (!SECRET_NAME.test(name) && !forced.has(name)) continue;
		out.push({ name, value });
	}
	// Longest first so a secret that contains another is masked whole.
	return out.sort((a, b) => b.value.length - a.value.length);
}

/** @param {string} text @param {{name:string,value:string}[]} secrets */
export function maskString(text, secrets) {
	let out = text;
	for (const { name, value } of secrets) {
		if (out.includes(value)) out = out.split(value).join(`[REDACTED:${name}]`);
	}
	for (const pattern of KEY_PATTERNS) out = out.replace(pattern, "[REDACTED:PATTERN]");
	return out;
}

/** Deep copy with every string (keys included) masked. */
export function maskDeep(value, secrets) {
	if (typeof value === "string") return maskString(value, secrets);
	if (Array.isArray(value)) return value.map((v) => maskDeep(v, secrets));
	if (value && typeof value === "object") {
		const out = {};
		for (const [k, v] of Object.entries(value)) out[maskString(k, secrets)] = maskDeep(v, secrets);
		return out;
	}
	return value;
}

/** Count leaks in serialized output. Returns names only, never values. */
export function rescan(text, secrets) {
	const hits = [];
	for (const { name, value } of secrets) if (text.includes(value)) hits.push(name);
	for (const pattern of KEY_PATTERNS) {
		pattern.lastIndex = 0;
		if (new RegExp(pattern.source).test(text)) hits.push(`PATTERN:${pattern.source}`);
	}
	return hits;
}
