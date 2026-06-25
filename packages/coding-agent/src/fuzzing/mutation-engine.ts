/**
 * OMK Jailbreak v6 — Fuzzing Module (TypeScript Port)
 * ====================================================
 * packages/coding-agent/src/fuzzing/mutation-engine.ts
 *
 * Coverage-Guided Mutation + Seed Corpus management for
 * jailbreak payload transformation.
 *
 * Zero API calls — pure local computation.
 */

import { randomBytes } from "node:crypto";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface CoverageFeedback {
	newEdges: number;
	totalEdges: number;
	coverageRatio: number;
}

export interface Seed {
	id: string;
	data: string;
	score: number;
	coverage: CoverageFeedback;
	depth: number;
	parentId?: string;
}

export interface SeedCorpusManager {
	seeds: Seed[];
	add(seed: Seed): void;
	getNext(): Seed | undefined;
	getBest(): Seed | undefined;
}

export class SimpleSeedCorpusManager implements SeedCorpusManager {
	seeds: Seed[] = [];
	private index = 0;

	add(seed: Seed): void {
		this.seeds.push(seed);
		this.seeds.sort((a, b) => b.score - a.score);
	}

	getNext(): Seed | undefined {
		if (this.seeds.length === 0) return undefined;
		const seed = this.seeds[this.index % this.seeds.length];
		this.index++;
		return seed;
	}

	getBest(): Seed | undefined {
		return this.seeds[0];
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// Bit-level Mutators (AFL++ style)
// ═══════════════════════════════════════════════════════════════════════════

export interface Mutator {
	mutate(data: Uint8Array, coverageFeedback?: CoverageFeedback): Generator<Uint8Array>;
}

export class BitFlipMutator implements Mutator {
	private strategies = [
		{ name: "bitflip_1", step: 1, mode: "single" as const },
		{ name: "bitflip_2", step: 2, mode: "adjacent" as const },
		{ name: "bitflip_4", step: 4, mode: "adjacent" as const },
		{ name: "arith_8", step: 8, mode: "arithmetic" as const },
		{ name: "arith_16", step: 16, mode: "arithmetic" as const },
		{ name: "arith_32", step: 32, mode: "arithmetic" as const },
	];

	*mutate(data: Uint8Array, _coverageFeedback?: CoverageFeedback): Generator<Uint8Array> {
		for (const strategy of this.strategies) {
			const step = strategy.step;
			if (data.length * 8 < step) continue;
			for (let i = 0; i <= data.length * 8 - step; i += step) {
				yield this.apply(data, i, strategy);
			}
		}
	}

	private apply(data: Uint8Array, bitIdx: number, strategy: { step: number; mode: string }): Uint8Array {
		const step = strategy.step;
		const mode = strategy.mode;
		const arr = new Uint8Array(data);

		if (mode === "single") {
			const byteIdx = Math.floor(bitIdx / 8);
			const bitInByte = bitIdx % 8;
			if (byteIdx < arr.length) {
				arr[byteIdx] ^= 1 << bitInByte;
			}
		} else if (mode === "adjacent") {
			for (let b = 0; b < step; b++) {
				const idx = bitIdx + b;
				const byteIdx = Math.floor(idx / 8);
				const bitInByte = idx % 8;
				if (byteIdx < arr.length) {
					arr[byteIdx] ^= 1 << bitInByte;
				}
			}
		} else if (mode === "arithmetic") {
			const byteIdx = Math.floor(bitIdx / 8);
			if (step === 8 && byteIdx < arr.length) {
				arr[byteIdx] = (arr[byteIdx] + 1) & 0xff;
			} else if (step === 16 && byteIdx + 1 < arr.length) {
				let val = (arr[byteIdx] << 8) | arr[byteIdx + 1];
				val = (val + 1) & 0xffff;
				arr[byteIdx] = (val >> 8) & 0xff;
				arr[byteIdx + 1] = val & 0xff;
			} else if (step === 32 && byteIdx + 3 < arr.length) {
				let val = (arr[byteIdx] << 24) | (arr[byteIdx + 1] << 16) | (arr[byteIdx + 2] << 8) | arr[byteIdx + 3];
				val = (val + 1) & 0xffffffff;
				arr[byteIdx] = (val >>> 24) & 0xff;
				arr[byteIdx + 1] = (val >>> 16) & 0xff;
				arr[byteIdx + 2] = (val >>> 8) & 0xff;
				arr[byteIdx + 3] = val & 0xff;
			}
		}
		return arr;
	}
}

export class ByteFlipMutator implements Mutator {
	*mutate(data: Uint8Array, _coverageFeedback?: CoverageFeedback): Generator<Uint8Array> {
		const arr = new Uint8Array(data);
		for (let i = 0; i < arr.length; i++) {
			arr[i] ^= 0xff;
			yield new Uint8Array(arr);
			arr[i] ^= 0xff;
		}
	}
}

export class ArithmeticMutator implements Mutator {
	private arithOps = [1, -1, 10, -10];

	*mutate(data: Uint8Array, _coverageFeedback?: CoverageFeedback): Generator<Uint8Array> {
		const arr = new Uint8Array(data);
		for (let i = 0; i < arr.length; i++) {
			for (const op of this.arithOps) {
				const original = arr[i];
				arr[i] = (arr[i] + op) & 0xff;
				yield new Uint8Array(arr);
				arr[i] = original;
			}
		}
	}
}

export class InterestingValueMutator implements Mutator {
	private interesting8 = [0, 1, 16, 32, 64, 100, 127, 128, 255];
	private interesting16 = [0, 1, 255, 256, 512, 1000, 1024, 4096, 65535];
	private interesting32 = [0, 1, 65535, 65536, 1000000, 2147483647, 4294967295];

	*mutate(data: Uint8Array, _coverageFeedback?: CoverageFeedback): Generator<Uint8Array> {
		const arr = new Uint8Array(data);
		for (let i = 0; i < arr.length; i++) {
			for (const v of this.interesting8) {
				arr[i] = v & 0xff;
				yield new Uint8Array(arr);
			}
		}
		for (let i = 0; i + 1 < arr.length; i++) {
			for (const v of this.interesting16) {
				arr[i] = (v >> 8) & 0xff;
				arr[i + 1] = v & 0xff;
				yield new Uint8Array(arr);
			}
		}
		for (let i = 0; i + 3 < arr.length; i++) {
			for (const v of this.interesting32) {
				arr[i] = (v >>> 24) & 0xff;
				arr[i + 1] = (v >>> 16) & 0xff;
				arr[i + 2] = (v >>> 8) & 0xff;
				arr[i + 3] = v & 0xff;
				yield new Uint8Array(arr);
			}
		}
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// Dictionary-based Mutators
// ═══════════════════════════════════════════════════════════════════════════

export interface JailbreakDictionaryEntry {
	term: string;
	weight: number;
	category: string;
}

export class JailbreakDictionary {
	entries: JailbreakDictionaryEntry[] = [
		{ term: "ignore previous instructions", weight: 1.0, category: "direct" },
		{ term: "DAN mode", weight: 0.9, category: "persona" },
		{ term: "developer mode", weight: 0.85, category: "persona" },
		{ term: "jailbreak", weight: 0.8, category: "meta" },
		{ term: "hypothetical", weight: 0.7, category: "framing" },
		{ term: "educational purpose", weight: 0.6, category: "framing" },
		{ term: "research context", weight: 0.6, category: "framing" },
		{ term: "translate to", weight: 0.5, category: "encoding" },
		{ term: "base64 decode", weight: 0.5, category: "encoding" },
		{ term: "hex decode", weight: 0.5, category: "encoding" },
	];

	getRandomEntry(): JailbreakDictionaryEntry | undefined {
		if (this.entries.length === 0) return undefined;
		const totalWeight = this.entries.reduce((sum, e) => sum + e.weight, 0);
		let r = Math.random() * totalWeight;
		for (const entry of this.entries) {
			r -= entry.weight;
			if (r <= 0) return entry;
		}
		return this.entries[this.entries.length - 1];
	}

	getByCategory(category: string): JailbreakDictionaryEntry[] {
		return this.entries.filter((e) => e.category === category);
	}
}

export class DictionaryInsertMutator implements Mutator {
	private dictionary: JailbreakDictionary;

	constructor(dictionary?: JailbreakDictionary) {
		this.dictionary = dictionary || new JailbreakDictionary();
	}

	*mutate(data: Uint8Array, _coverageFeedback?: CoverageFeedback): Generator<Uint8Array> {
		const text = new TextDecoder().decode(data);
		const entry = this.dictionary.getRandomEntry();
		if (!entry) return;

		// Insert at random position
		const pos = Math.floor(Math.random() * (text.length + 1));
		const mutated = text.slice(0, pos) + entry.term + text.slice(pos);
		yield new TextEncoder().encode(mutated);
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// Fuzzing Mutation Engine
// ═══════════════════════════════════════════════════════════════════════════

export interface MutationResult {
	mutated: Uint8Array;
	mutatorName: string;
	parentId: string;
}

export class FuzzingMutationEngine {
	mutators: Mutator[];
	corpus: SeedCorpusManager;
	dictionary: JailbreakDictionary;
	maxMutationsPerSeed: number;

	constructor(options?: {
		mutators?: Mutator[];
		corpus?: SeedCorpusManager;
		dictionary?: JailbreakDictionary;
		maxMutationsPerSeed?: number;
	}) {
		this.mutators = options?.mutators || [
			new BitFlipMutator(),
			new ByteFlipMutator(),
			new ArithmeticMutator(),
			new InterestingValueMutator(),
			new DictionaryInsertMutator(),
		];
		this.corpus = options?.corpus || new SimpleSeedCorpusManager();
		this.dictionary = options?.dictionary || new JailbreakDictionary();
		this.maxMutationsPerSeed = options?.maxMutationsPerSeed || 50;
	}

	*generateMutations(seed: Seed): Generator<MutationResult> {
		const data = new TextEncoder().encode(seed.data);
		let count = 0;
		for (const mutator of this.mutators) {
			for (const mutated of mutator.mutate(data)) {
				if (count >= this.maxMutationsPerSeed) return;
				const name = mutator.constructor.name;
				yield {
					mutated,
					mutatorName: name,
					parentId: seed.id,
				};
				count++;
			}
		}
	}

	addSeed(data: string, score = 0, coverage?: CoverageFeedback): Seed {
		const seed: Seed = {
			id: randomBytes(8).toString("hex"),
			data,
			score,
			coverage: coverage || { newEdges: 0, totalEdges: 1, coverageRatio: 0 },
			depth: 0,
		};
		this.corpus.add(seed);
		return seed;
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// Convenience exports
// ═══════════════════════════════════════════════════════════════════════════

export function createDefaultMutationEngine(): FuzzingMutationEngine {
	return new FuzzingMutationEngine();
}
