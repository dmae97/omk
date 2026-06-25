import { createHash } from "node:crypto";

type NormalizedPrimitive = string | number | boolean | null;
export type NormalizedTraceValue =
	| NormalizedPrimitive
	| readonly NormalizedTraceValue[]
	| { readonly [key: string]: NormalizedTraceValue };

export interface GoldenTraceComparison {
	readonly pass: boolean;
	readonly summary: string;
}

const VOLATILE_FIELDS = new Set([
	"createdat",
	"datetime",
	"duration",
	"durationms",
	"elapsed",
	"elapsedms",
	"endedat",
	"latencyms",
	"nonce",
	"requestid",
	"sessionid",
	"startedat",
	"time",
	"timestamp",
	"traceid",
	"ts",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isVolatileField(key: string): boolean {
	return VOLATILE_FIELDS.has(key.toLowerCase());
}

function normalizeValue(value: unknown): NormalizedTraceValue | undefined {
	if (value === undefined || typeof value === "function" || typeof value === "symbol") return undefined;
	if (value === null || typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	if (typeof value === "bigint") return value.toString();
	if (value instanceof Date) return value.toISOString();
	if (Array.isArray(value)) return value.map((item) => normalizeValue(item) ?? null);
	if (isRecord(value)) {
		const normalized: Record<string, NormalizedTraceValue> = {};
		for (const key of Object.keys(value).sort()) {
			if (isVolatileField(key)) continue;
			const normalizedValue = normalizeValue(value[key]);
			if (normalizedValue !== undefined) normalized[key] = normalizedValue;
		}
		return normalized;
	}
	return String(value);
}

function canonicalJson(value: unknown): string {
	return JSON.stringify(normalizeValue(value) ?? null);
}

function isNormalizedArray(value: NormalizedTraceValue): value is readonly NormalizedTraceValue[] {
	return Array.isArray(value);
}

function isNormalizedObject(value: NormalizedTraceValue): value is Readonly<Record<string, NormalizedTraceValue>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeValue(value: NormalizedTraceValue | undefined): string {
	return value === undefined ? "<missing>" : canonicalJson(value);
}

function joinPath(path: string, segment: string): string {
	return /^[$_a-zA-Z][$_a-zA-Z0-9]*$/.test(segment) ? `${path}.${segment}` : `${path}[${JSON.stringify(segment)}]`;
}

function firstDifference(
	actual: NormalizedTraceValue | undefined,
	expected: NormalizedTraceValue | undefined,
	path: string,
): string | undefined {
	if (actual === undefined || expected === undefined) {
		return actual === expected
			? undefined
			: `${path}: expected ${describeValue(expected)} but got ${describeValue(actual)}`;
	}
	if (canonicalJson(actual) === canonicalJson(expected)) return undefined;

	if (isNormalizedArray(actual) && isNormalizedArray(expected)) {
		const limit = Math.min(actual.length, expected.length);
		for (let index = 0; index < limit; index++) {
			const child = firstDifference(actual[index], expected[index], `${path}[${index}]`);
			if (child) return child;
		}
		return `${path}: expected length ${expected.length} but got ${actual.length}`;
	}

	if (isNormalizedObject(actual) && isNormalizedObject(expected)) {
		const actualKeys = Object.keys(actual).sort();
		const expectedKeys = Object.keys(expected).sort();
		const keys = [...new Set([...actualKeys, ...expectedKeys])].sort();
		for (const key of keys) {
			const child = firstDifference(actual[key], expected[key], joinPath(path, key));
			if (child) return child;
		}
	}

	return `${path}: expected ${describeValue(expected)} but got ${describeValue(actual)}`;
}

export function normalizeTraceEvent(event: unknown): NormalizedTraceValue {
	return normalizeValue(event) ?? null;
}

export function normalizeTrace(trace: readonly unknown[]): readonly NormalizedTraceValue[] {
	return trace.map((event) => normalizeTraceEvent(event));
}

export function traceHash(trace: readonly unknown[]): string {
	return createHash("sha256")
		.update(canonicalJson(normalizeTrace(trace)))
		.digest("hex");
}

export function compareGoldenTrace(actual: readonly unknown[], expected: readonly unknown[]): GoldenTraceComparison {
	const normalizedActual = normalizeTrace(actual);
	const normalizedExpected = normalizeTrace(expected);
	const actualJson = canonicalJson(normalizedActual);
	const expectedJson = canonicalJson(normalizedExpected);
	if (actualJson === expectedJson) {
		return { pass: true, summary: `traces match (${traceHash(normalizedActual)})` };
	}
	const diff = firstDifference(normalizedActual, normalizedExpected, "$") ?? "trace mismatch";
	return {
		pass: false,
		summary: `${diff}; actual=${traceHash(normalizedActual)} expected=${traceHash(normalizedExpected)}`,
	};
}
