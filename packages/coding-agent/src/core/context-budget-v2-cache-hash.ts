import { createHash } from "node:crypto";

export function sha256Canonical(value: unknown): string {
	return sha256Hex(JSON.stringify(sortCanonical(value)));
}

export function sha256Hex(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

function sortCanonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortCanonical);
	if (!value || typeof value !== "object") return value;
	const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
	return Object.fromEntries(entries.map(([key, item]) => [key, sortCanonical(item)]));
}
