/**
 * Golden-diff: compares two keyed label snapshots (Goal 009 Req 1 / Lane E).
 *
 * Typical use: diff a frozen "golden" verdict snapshot (e.g. a prior run's
 * per-row predicted class or thinking level, keyed by gold-set id) against a
 * current run, to see exactly which rows regressed, improved, appeared, or
 * disappeared between two classifier versions or two points in time.
 *
 * Pure, deterministic, dependency-free: callers pass small labeled values (a
 * class name, a thinking level, "correct"/"incorrect", ...) keyed by id; this
 * module never reads or prints prompt text itself, so it is safe for the
 * privacy-governed benchmark reporting this repo requires (see
 * `packages/coding-agent/test/fixtures/reasoning-router-gold-set.ts`
 * `summarizeGoldSetSplit`).
 *
 * A guarded CLI entrypoint reads two JSON files, each shaped as
 * `Record<id, value>`, and prints a JSON GoldenDiffSummary. Importing this
 * module for tests or from another script never triggers the CLI path.
 *
 * CLI usage:
 *   node --experimental-strip-types golden-diff.ts <baseline.json> <current.json>
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** One labeled row: an id paired with a small comparable value (never prompt text). */
export interface GoldenDiffRecord {
	readonly id: string;
	readonly value: string;
}

export type GoldenDiffChangeKind = "added" | "removed" | "changed";

/** A single per-id difference between the baseline and current snapshot. */
export interface GoldenDiffChange {
	readonly id: string;
	readonly kind: GoldenDiffChangeKind;
	readonly baselineValue?: string;
	readonly currentValue?: string;
}

/** Full diff result: totals plus the sorted list of per-id changes. */
export interface GoldenDiffSummary {
	readonly totalBaseline: number;
	readonly totalCurrent: number;
	readonly unchangedCount: number;
	readonly addedCount: number;
	readonly removedCount: number;
	readonly changedCount: number;
	readonly changes: readonly GoldenDiffChange[];
}

function toRecordMap(records: readonly GoldenDiffRecord[], label: string): ReadonlyMap<string, string> {
	const map = new Map<string, string>();
	for (const record of records) {
		if (map.has(record.id)) {
			throw new Error(`golden-diff: duplicate id "${record.id}" in ${label} record set`);
		}
		map.set(record.id, record.value);
	}
	return map;
}

/**
 * Diff two labeled snapshots by id. Output `changes` is always sorted by id
 * ascending regardless of input order, so repeated diffs of the same two
 * snapshots are byte-for-byte stable (safe to compare or snapshot-test).
 */
export function diffGoldenRecords(
	baseline: readonly GoldenDiffRecord[],
	current: readonly GoldenDiffRecord[],
): GoldenDiffSummary {
	const baselineMap = toRecordMap(baseline, "baseline");
	const currentMap = toRecordMap(current, "current");
	const ids = new Set<string>([...baselineMap.keys(), ...currentMap.keys()]);
	const changes: GoldenDiffChange[] = [];
	let unchangedCount = 0;

	for (const id of ids) {
		const hasBaseline = baselineMap.has(id);
		const hasCurrent = currentMap.has(id);
		if (hasBaseline && hasCurrent) {
			const baselineValue = baselineMap.get(id) as string;
			const currentValue = currentMap.get(id) as string;
			if (baselineValue === currentValue) {
				unchangedCount += 1;
			} else {
				changes.push({ id, kind: "changed", baselineValue, currentValue });
			}
		} else if (hasBaseline) {
			changes.push({ id, kind: "removed", baselineValue: baselineMap.get(id) });
		} else {
			changes.push({ id, kind: "added", currentValue: currentMap.get(id) });
		}
	}

	changes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

	return {
		totalBaseline: baselineMap.size,
		totalCurrent: currentMap.size,
		unchangedCount,
		addedCount: changes.filter((change) => change.kind === "added").length,
		removedCount: changes.filter((change) => change.kind === "removed").length,
		changedCount: changes.filter((change) => change.kind === "changed").length,
		changes,
	};
}

/** Convenience: build a GoldenDiffRecord[] from a plain `Record<id, value>` map (e.g. parsed from a JSON snapshot file). */
export function recordsFromMap(map: Readonly<Record<string, string>>): readonly GoldenDiffRecord[] {
	return Object.entries(map).map(([id, value]) => ({ id, value }));
}

// ---------------------------------------------------------------------------
// Guarded CLI entrypoint. Never runs on import (e.g. from tests or other
// scripts); only runs when this file is executed directly.
// ---------------------------------------------------------------------------

function readSnapshot(path: string): readonly GoldenDiffRecord[] {
	const raw = readFileSync(path, "utf8");
	const parsed = JSON.parse(raw) as Record<string, string>;
	return recordsFromMap(parsed);
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
	const [baselinePath, currentPath] = process.argv.slice(2);
	if (!baselinePath || !currentPath) {
		throw new RangeError("golden-diff: usage: golden-diff.ts <baseline.json> <current.json>");
	}
	const summary = diffGoldenRecords(readSnapshot(baselinePath), readSnapshot(currentPath));
	console.log(JSON.stringify(summary));
}
