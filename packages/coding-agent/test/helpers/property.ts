/**
 * Tiny, dependency-free property-based testing engine.
 *
 * Provides deterministic (seeded) input generation plus delta-debugging
 * shrinking so a failing run reports a *minimal* counterexample together with
 * its seed for reproduction. This is intentionally small and self-contained:
 * the project pins exact dependencies and gates lockfile changes, so the
 * `/model` contract uses this in-house engine instead of adding fast-check.
 */

export interface Rng {
	/** Uniform float in [0, 1). */
	nextFloat(): number;
	/** Uniform integer in [0, maxExclusive). */
	nextInt(maxExclusive: number): number;
	/** Pick one element from a non-empty array. */
	pick<T>(items: readonly T[]): T;
}

/** Deterministic mulberry32 PRNG: identical seeds yield identical streams. */
export function makeRng(seed: number): Rng {
	let a = seed >>> 0;
	const nextFloat = (): number => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const nextInt = (maxExclusive: number): number => {
		if (maxExclusive <= 0) return 0;
		return Math.floor(nextFloat() * maxExclusive);
	};
	const pick = <T>(items: readonly T[]): T => {
		const value = items[nextInt(items.length)];
		if (value === undefined && items.length === 0) {
			throw new Error("Rng.pick called with an empty array");
		}
		return value as T;
	};
	return { nextFloat, nextInt, pick };
}

export interface ShrinkOutcome<T> {
	readonly value: T;
	readonly error: Error;
}

function toError(value: unknown): Error {
	return value instanceof Error ? value : new Error(String(value));
}

/**
 * Greedy delta-debugging: repeatedly replace the current failing value with the
 * first shrink candidate that still fails, until no candidate fails. Returns the
 * minimal failing value found and the error it produced.
 */
export function shrinkFailure<T>(
	initialValue: T,
	initialError: Error,
	predicate: (value: T) => void,
	shrink: (value: T) => Iterable<T>,
	maxSteps = 2000,
): ShrinkOutcome<T> {
	let current = initialValue;
	let currentError = initialError;
	for (let step = 0; step < maxSteps; step++) {
		let progressed = false;
		for (const candidate of shrink(current)) {
			let candidateError: Error | undefined;
			try {
				predicate(candidate);
			} catch (error) {
				candidateError = toError(error);
			}
			if (candidateError) {
				current = candidate;
				currentError = candidateError;
				progressed = true;
				break;
			}
		}
		if (!progressed) break;
	}
	return { value: current, error: currentError };
}

export interface PropertyOptions<T> {
	readonly seeds: readonly number[];
	/** Generated cases per seed. */
	readonly numRuns: number;
	readonly generate: (rng: Rng) => T;
	/** Throws (e.g. via expect) when the property is violated. */
	readonly predicate: (value: T) => void;
	readonly shrink: (value: T) => Iterable<T>;
	readonly format?: (value: T) => string;
	readonly maxShrinkSteps?: number;
}

/**
 * Run a property across every seed x run. On the first failure, shrink to a
 * minimal counterexample and throw an error that names the seed, run index, the
 * minimal counterexample, and the underlying cause.
 */
export function checkProperty<T>(options: PropertyOptions<T>): void {
	for (const seed of options.seeds) {
		const rng = makeRng(seed);
		for (let run = 0; run < options.numRuns; run++) {
			const value = options.generate(rng);
			let error: Error | undefined;
			try {
				options.predicate(value);
			} catch (caught) {
				error = toError(caught);
			}
			if (!error) continue;

			const shrunk = shrinkFailure(value, error, options.predicate, options.shrink, options.maxShrinkSteps);
			const formatted = options.format ? options.format(shrunk.value) : JSON.stringify(shrunk.value);
			throw new Error(
				`Property failed (seed=${seed}, run=${run}).\n` +
					`Minimal counterexample: ${formatted}\n` +
					`Cause: ${shrunk.error.message}`,
			);
		}
	}
}

/**
 * Shrink a list by yielding every one-element-shorter variant (left to right).
 * Composed with {@link shrinkFailure} this converges to a minimal failing
 * subsequence.
 */
export function* listShrink<T>(list: readonly T[]): Generator<T[]> {
	for (let i = 0; i < list.length; i++) {
		yield [...list.slice(0, i), ...list.slice(i + 1)];
	}
}
