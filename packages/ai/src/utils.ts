import { $env } from "@oh-my-pi/pi-utils";
import type { CacheRetention } from "./types";

export { isRecord } from "@oh-my-pi/pi-utils";

export function toNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

export function toPositiveNumber(value: unknown, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return fallback;
	}
	return value;
}

export function toBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

export function normalizeToolCallId(id: string): string {
	const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, "_");
	return sanitized.length > 64 ? sanitized.slice(0, 64) : sanitized;
}

export function normalizeResponsesToolCallId(id: string): { callId: string; itemId: string } {
	const [callId, itemId] = id.split("|");
	if (callId && itemId) {
		const normalizedCallId = truncateResponseItemId(callId, getIdPrefix(callId, "call"));
		const normalizedItemId = normalizeResponsesItemId(itemId);
		return { callId: normalizedCallId, itemId: normalizedItemId };
	}
	const hash = Bun.hash.xxHash64(id).toString(36);
	const normalizedCallId = id.startsWith("call_") ? truncateResponseItemId(id, "call") : `call_${hash}`;
	return { callId: normalizedCallId, itemId: `fc_${hash}` };
}

function getIdPrefix(id: string, fallback: string): string {
	const prefix = id.match(/^([a-zA-Z][a-zA-Z0-9]*)_/)?.[1];
	return prefix || fallback;
}

function normalizeResponsesItemId(itemId: string): string {
	const prefix = getIdPrefix(itemId, "fc");
	if (prefix !== "fc" && prefix !== "fcr") {
		return `fc_${Bun.hash.xxHash64(itemId).toString(36)}`;
	}
	return truncateResponseItemId(itemId, prefix);
}

/**
 * Truncate an OpenAI Responses API item ID to 64 characters.
 * IDs exceeding the limit are replaced with a hash-based ID using the given prefix.
 */
export function truncateResponseItemId(id: string, prefix: string): string {
	if (id.length <= 64) return id;
	return `${prefix}_${Bun.hash.xxHash64(id).toString(36)}`;
}

/**
 * Resolve cache retention preference.
 * Defaults to "short" and uses PI_CACHE_RETENTION for backward compatibility.
 */
export function resolveCacheRetention(cacheRetention?: CacheRetention): CacheRetention {
	if (cacheRetention) return cacheRetention;
	if ($env.PI_CACHE_RETENTION === "long") return "long";
	return "short";
}

export function isAnthropicOAuthToken(key: string): boolean {
	return key.includes("sk-ant-oat");
}
