/**
 * Equivalence harness for the behavior-neutral agent-session split
 * (specs/agent-session-split/spec.md §5). Records, per scenario, every provider
 * request (context + options), every session event in order with its payload, and
 * the trace the session leaves behind. The record is compared byte for byte
 * against a golden generated from unchanged code.
 *
 * Scenarios run in a fixed environment (see `enterFixedEnvironment`): a fixed-length
 * working directory, package directory and process.cwd(), a fixed clock, and seeded randomness. So
 * char offsets (`systemPromptCacheBoundary`), byte sizes and token estimates are
 * compared raw. Normalization replaces only path- and time-derived values.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { FauxResponseStep } from "omk-ai";
import { vi } from "vitest";
import type { Harness } from "./harness.ts";

export const GOLDEN_DIR = join(import.meta.dirname, "fixtures", "session-equivalence");
/** Checkout root of this package; it only appears in normalized output as `<REPO>`. */
const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..", "..");
const PACKAGE_DIR = realpathSync(resolve(import.meta.dirname, "..", ".."));

/**
 * Fixed-length paths, identical on every checkout and machine. The harness temp dir is
 * `${TMPDIR}/pi-suite-${Date.now()}-${random}`: with TMPDIR, the clock and Math.random
 * fixed, that path (and so every prompt offset that follows it) is fixed too.
 */
export const FIXED_ROOT = "/tmp/omk-session-equivalence";
export const FIXED_TMP = `${FIXED_ROOT}/tmp`;
export const FIXED_PACKAGE_DIR = `${FIXED_ROOT}/pkg`;
export const FIXED_NOW = 1_800_000_000_000;

export interface EquivalenceRecord {
	requests: unknown[];
	events: unknown[];
	trace: unknown;
}

/** Seeded PRNG (mulberry32), so faux ids and stream chunk sizes repeat exactly. */
function seededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Enter the fixed environment for one scenario. Restored by `vi.restoreAllMocks`,
 * `vi.useRealTimers` and the returned `leave`.
 */
export function enterFixedEnvironment(): () => void {
	const saved = { TMPDIR: process.env.TMPDIR, OMK_PACKAGE_DIR: process.env.OMK_PACKAGE_DIR };
	mkdirSync(FIXED_TMP, { recursive: true });
	rmSync(FIXED_PACKAGE_DIR, { force: true });
	symlinkSync(PACKAGE_DIR, FIXED_PACKAGE_DIR);
	process.env.TMPDIR = FIXED_TMP;
	process.env.OMK_PACKAGE_DIR = FIXED_PACKAGE_DIR;
	// In-memory session headers default their cwd to process.cwd(), the checkout folder.
	vi.spyOn(process, "cwd").mockReturnValue(FIXED_PACKAGE_DIR);
	vi.useFakeTimers({ toFake: ["Date", "performance"] });
	vi.setSystemTime(FIXED_NOW);
	vi.spyOn(Math, "random").mockImplementation(seededRandom(0x5eed));
	// Session ids (uuidv7) draw from Web Crypto: seed it too.
	const bytes = seededRandom(0xb17e5);
	vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(
		<T extends ArrayBufferView | null>(array: T): T => {
			if (array) {
				const view = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
				for (let i = 0; i < view.length; i++) view[i] = Math.floor(bytes() * 256);
			}
			return array;
		},
	);
	return () => {
		vi.useRealTimers();
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	};
}

/** Wraps each queued step so the request it answers is recorded before it is served. */
export function recordingSteps(requests: unknown[], steps: FauxResponseStep[]): FauxResponseStep[] {
	return steps.map((step) => async (context, options, state, model) => {
		requests.push({ model: model.id, context, options: pickOptions(options) });
		return typeof step === "function" ? step(context, options, state, model) : step;
	});
}

function pickOptions(options: unknown): unknown {
	if (!options || typeof options !== "object") return options;
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(options)) {
		if (typeof value === "function" || key === "signal") continue;
		out[key] = value;
	}
	return out;
}

/** Keys whose values are clock readings. */
const TIME_KEY =
	/^(timestamp|ts|time|now|durationMs|elapsedMs)$|(Timestamp|Time|At|AtMs|EpochMs|DurationMs|ElapsedMs)$/;
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
const DATE = /\b\d{4}-\d{2}-\d{2}\b/g;

/** Path- and time-derived text only. Lengths are fixed by the fixed environment. */
function normalizeText(value: string): string {
	let out = value;
	for (const [path, label] of [
		[FIXED_PACKAGE_DIR, "<PKG>"],
		[FIXED_TMP, "<TMP>"],
		[REPO_ROOT, "<REPO>"],
		[homedir(), "<HOME>"],
		[process.execPath, "<NODE>"],
	] as const) {
		out = out.split(path).join(label);
	}
	return out.replace(ISO, "<ISO>").replace(DATE, "<DATE>");
}

/** Stable JSON (sorted keys). With `normalize` off the values are written raw. */
export function serializeRecord(record: EquivalenceRecord, normalize = true): string {
	const seen = new WeakSet<object>();
	const walk = (value: unknown, key: string): unknown => {
		if (typeof value === "string") return normalize ? normalizeText(value) : value;
		if (typeof value === "number") return normalize && TIME_KEY.test(key) ? "<T>" : value;
		if (typeof value === "function") return "<fn>";
		if (typeof value === "bigint") return String(value);
		if (value instanceof Error) return { error: value.name, message: walk(value.message, "message") };
		if (value instanceof Map) return walk(Object.fromEntries(value), key);
		if (value instanceof Set) return walk([...value], key);
		if (value && typeof value === "object") {
			if (seen.has(value)) return "<cycle>";
			seen.add(value);
			const result = Array.isArray(value)
				? value.map((item) => walk(item, key))
				: Object.fromEntries(
						Object.keys(value)
							.sort()
							.map((k) => [k, walk((value as Record<string, unknown>)[k], k)]),
					);
			seen.delete(value);
			return result;
		}
		return value;
	};
	return `${JSON.stringify(walk(record, ""), null, "\t")}\n`;
}

export function sessionRecord(harness: Harness, requests: unknown[]): EquivalenceRecord {
	return {
		requests,
		events: harness.events,
		trace: {
			runBudget: harness.session.getRunBudgetSnapshot(),
			lastTermination: harness.session.lastTermination,
			entries: harness.sessionManager.getEntries(),
		},
	};
}

export interface Comparison {
	equal: boolean;
	firstDiffByte?: number;
}

/** Byte-for-byte comparison; reports the first differing byte offset. */
export function compareBytes(expected: string, actual: string): Comparison {
	const a = Buffer.from(expected, "utf8");
	const b = Buffer.from(actual, "utf8");
	if (a.equals(b)) return { equal: true };
	const n = Math.min(a.length, b.length);
	let i = 0;
	while (i < n && a[i] === b[i]) i++;
	return { equal: false, firstDiffByte: i };
}

export function goldenPath(scenario: string): string {
	return join(GOLDEN_DIR, `${scenario}.json`);
}

/**
 * With UPDATE_SESSION_EQUIVALENCE=1 the golden is (re)written; only do that on unchanged code.
 * With SESSION_EQUIVALENCE_RAW_OUT=<dir> the unnormalized record is also written there, so
 * two checkouts can be diffed raw.
 */
export function readOrWriteGolden(scenario: string, record: EquivalenceRecord): { golden: string; actual: string } {
	const actual = serializeRecord(record);
	const rawDir = process.env.SESSION_EQUIVALENCE_RAW_OUT;
	if (rawDir) {
		mkdirSync(rawDir, { recursive: true });
		writeFileSync(join(rawDir, `${scenario}.raw.json`), serializeRecord(record, false));
	}
	const path = goldenPath(scenario);
	if (process.env.UPDATE_SESSION_EQUIVALENCE === "1") writeFileSync(path, actual);
	if (!existsSync(path)) throw new Error(`missing golden ${path}; generate it on unchanged code`);
	return { golden: readFileSync(path, "utf8"), actual };
}
