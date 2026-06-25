/**
 * Stable schema fingerprint for MCP tool inputSchema drift detection.
 *
 * Aside ships updates; a tool named the same way may later accept broader
 * arguments. Fingerprinting lets OMK detect that the schema changed and refuse
 * to auto-promote a previously-approved tool without re-review.
 *
 * Deterministic canonicalization: arrays preserve order, object keys are sorted
 * recursively, cycles throw, and non-JSON schema values throw. The digest is a
 * versioned SHA-256 string so future canonicalization changes can use a new
 * prefix without conflating approvals.
 *
 * Pure module.
 */

import { createHash } from "node:crypto";

const SCHEMA_FINGERPRINT_PREFIX = "aside-schema-v1:";

function assertJsonObject(value: object): void {
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError("non-json schema value: object prototype is not plain JSON");
	}
}

/** Deterministic canonicalization of a JSON value. */
function canonicalize(value: unknown, ancestors: Set<object>): string {
	if (value === null) return "null";
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new TypeError("non-json schema value: non-finite number");
		return `n:${value}`;
	}
	if (typeof value === "boolean") return value ? "true" : "false";
	if (
		typeof value === "undefined" ||
		typeof value === "function" ||
		typeof value === "symbol" ||
		typeof value === "bigint"
	) {
		throw new TypeError(`non-json schema value: ${typeof value}`);
	}
	if (typeof value === "object") {
		if (ancestors.has(value)) throw new TypeError("schema contains a cycle");
		ancestors.add(value);
		try {
			if (Array.isArray(value)) {
				return `[${value.map((item) => canonicalize(item, ancestors)).join(",")}]`;
			}
			assertJsonObject(value);
			const obj = value as Record<string, unknown>;
			const keys = Object.keys(obj).sort();
			const body = keys.map((key) => `${JSON.stringify(key)}:${canonicalize(obj[key], ancestors)}`).join(",");
			return `{${body}}`;
		} finally {
			ancestors.delete(value);
		}
	}
	throw new TypeError("non-json schema value: unsupported value");
}

/**
 * Return a versioned SHA-256 fingerprint for a tool inputSchema.
 * Two equal fingerprints mean structurally identical schemas under v1
 * canonicalization.
 *
 * @example
 * schemaFingerprint({ type: "object", properties: { url: { type: "string" } } })
 */
export function schemaFingerprint(schema: Readonly<Record<string, unknown>>): string {
	const digest = createHash("sha256").update(canonicalize(schema, new Set<object>()), "utf8").digest("hex");
	return `${SCHEMA_FINGERPRINT_PREFIX}${digest}`;
}

/** Compare a live fingerprint to an approved one. */
export function schemaDrift(live: string, approved: string | undefined): boolean {
	if (!approved) return true; // nothing approved yet → drift by definition
	return live !== approved;
}
