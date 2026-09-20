/**
 * Input-validation primitives for the metacognition kernel.
 *
 * Ported from docs/OMK_skill_knowledge_control_2026-09-19.zip
 * (src/validation.ts). Deterministic, allocation-bounded, no I/O.
 */
export function ensure(condition: unknown, message: string): asserts condition {
	if (!condition) throw new TypeError(message);
}
export function integer(value: number, label: string, max = Number.MAX_SAFE_INTEGER): void {
	ensure(Number.isSafeInteger(value) && value >= 0 && value <= max, `${label}: expected integer in [0, ${max}]`);
}
export function finite(value: number, label: string, max = Number.MAX_VALUE): void {
	ensure(
		typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max,
		`${label}: expected finite number in [0, ${max}]`,
	);
}
export function probability(value: number, label: string): void {
	ensure(
		typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1,
		`${label}: expected probability in [0, 1]`,
	);
}
export function text(value: string, label: string, max = 4096): void {
	ensure(typeof value === "string" && value.trim().length > 0 && value.length <= max, `${label}: invalid string`);
}
export function unique(values: readonly string[], label: string, max = 500): void {
	ensure(Array.isArray(values) && values.length <= max, `${label}: invalid array`);
	for (const value of values) text(value, label, 500);
	ensure(new Set(values).size === values.length, `${label}: duplicate identifier`);
}
export function member<T extends string>(value: T, values: readonly T[] | readonly string[], label: string): void {
	ensure(values.includes(value), `${label}: invalid enum`);
}
export function lexical(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
export function canonical(value: unknown): string {
	if (value === undefined) return '"__undefined__"';
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value !== null && typeof value === "object") {
		return `{${Object.entries(value)
			.sort(([a], [b]) => lexical(a, b))
			.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}
export function arrayBound(value: unknown, label: string, max: number): void {
	ensure(Array.isArray(value) && value.length <= max, `${label}: invalid array`);
}
/** Probability vector: finite, [0,1], sums to 1. Mirrors check_examples.py. */
export function probabilityVector(values: readonly number[], label: string): void {
	ensure(values.length > 0, `${label}: empty probability vector`);
	for (const v of values) probability(v, label);
	ensure(Math.abs(values.reduce((a, b) => a + b, 0) - 1) <= 1e-9, `${label}: probabilities must sum to one`);
}
