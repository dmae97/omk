/**
 * McNemar's exact test for paired nominal outcomes (Goal 009 Req 1 / Lane E).
 *
 * Used to compare two classifiers (e.g. v2 vs v3, or v3 vs a future v4) on the
 * SAME gold-set rows: for every row, each classifier is either right or wrong,
 * and only the discordant pairs (rows where the two classifiers disagree on
 * correctness) carry information about which is actually better.
 *
 *   b = rows where classifier A is correct and classifier B is wrong
 *   c = rows where classifier A is wrong and classifier B is correct
 *
 * Concordant rows (both right or both wrong) do not enter the test.
 *
 * Pure, deterministic, dependency-free: the exported functions do no I/O,
 * touch no global state, and never read prompt text. A guarded CLI entrypoint
 * at the bottom reads `<b> <c>` from argv (or a `{ "b": number, "c": number }`
 * JSON object from stdin) and prints a JSON McNemarResult; importing this
 * module for tests or from another script never triggers the CLI path.
 *
 * CLI usage:
 *   node --experimental-strip-types mcnemar.ts <b> <c>
 *   echo '{"b":11,"c":4}' | node --experimental-strip-types mcnemar.ts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Paired discordant-pair counts feeding the exact test. */
export interface McNemarInput {
	readonly b: number;
	readonly c: number;
}

/** Exact two-sided McNemar result plus the inputs it was computed from. */
export interface McNemarResult {
	readonly b: number;
	readonly c: number;
	readonly discordantTotal: number;
	readonly pValue: number;
	readonly significant: boolean;
}

/**
 * Numerically-stable binomial coefficient C(n, k) via a running-product
 * recurrence. Avoids the huge intermediate factorials a naive
 * n! / (k! * (n-k)!) implementation would overflow for n in the low hundreds;
 * accumulates as a floating-point running product instead, which stays
 * representable (though it loses some precision) for any n this module is
 * realistically called with (gold-set-sized discordant-pair counts).
 */
export function binomialCoefficient(n: number, k: number): number {
	if (!Number.isInteger(n) || !Number.isInteger(k) || n < 0) return 0;
	if (k < 0 || k > n) return 0;
	const kEffective = Math.min(k, n - k);
	let result = 1;
	for (let i = 0; i < kEffective; i++) {
		result = (result * (n - i)) / (i + 1);
	}
	return result;
}

/**
 * Exact two-sided McNemar p-value from discordant pair counts (b, c). Uses the
 * exact binomial tail rather than the chi-square approximation, which stays
 * valid at the small discordant-pair counts typical of a governed gold-set
 * benchmark (the chi-square approximation is unreliable below roughly
 * b + c < 20).
 */
export function mcnemarExactTwoSided(b: number, c: number): number {
	if (!Number.isInteger(b) || !Number.isInteger(c) || b < 0 || c < 0) {
		throw new RangeError(`mcnemarExactTwoSided requires non-negative integers, got b=${b} c=${c}`);
	}
	const n = b + c;
	if (n === 0) return 1;
	const lo = Math.min(b, c);
	let tail = 0;
	for (let i = 0; i <= lo; i++) tail += binomialCoefficient(n, i);
	return Math.min(1, 2 * tail * 0.5 ** n);
}

/** Run the exact test and package the result (default two-sided alpha = 0.05). */
export function runMcNemar(input: McNemarInput, alpha = 0.05): McNemarResult {
	const pValue = mcnemarExactTwoSided(input.b, input.c);
	return {
		b: input.b,
		c: input.c,
		discordantTotal: input.b + input.c,
		pValue,
		significant: pValue < alpha,
	};
}

// ---------------------------------------------------------------------------
// Guarded CLI entrypoint. Never runs on import (e.g. from tests or other
// scripts); only runs when this file is executed directly.
// ---------------------------------------------------------------------------

function parseCliInput(argv: readonly string[]): McNemarInput {
	if (argv.length >= 2) {
		const b = Number(argv[0]);
		const c = Number(argv[1]);
		if (Number.isInteger(b) && Number.isInteger(c)) return { b, c };
		throw new RangeError(`mcnemar: expected two integer args <b> <c>, got: ${argv.join(" ")}`);
	}
	const stdin = readFileSync(0, "utf8").trim();
	if (!stdin) {
		throw new RangeError('mcnemar: provide <b> <c> as args or a JSON object on stdin, e.g. {"b":11,"c":4}');
	}
	const parsed = JSON.parse(stdin) as Partial<McNemarInput>;
	if (typeof parsed.b !== "number" || typeof parsed.c !== "number") {
		throw new RangeError(`mcnemar: stdin JSON must be { "b": number, "c": number }, got: ${stdin}`);
	}
	return { b: parsed.b, c: parsed.c };
}

function isMainModule(): boolean {
	const entry = process.argv[1];
	if (!entry) return false;
	try {
		return fileURLToPath(import.meta.url) === entry;
	} catch {
		return false;
	}
}

if (isMainModule()) {
	const result = runMcNemar(parseCliInput(process.argv.slice(2)));
	console.log(JSON.stringify(result));
}
