#!/usr/bin/env node
/**
 * Select a deterministic, difficulty-balanced Terminal-Bench 2.1 mini-suite.
 *
 * Select a fixed subset weighted toward shorter expert-time estimates.
 * Those estimates are not bounds on agent runtime. This script never runs tasks.
 *
 * Identical task metadata, seed, size, and collation produce identical selection.
 * Comparing scores additionally requires pinned model, revision, and budgets.
 *
 * Usage:
 *   node scripts/tb-mini-suite.mjs [--tasks <dir>] [--size 15] [--seed 1] [--json]
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_TASKS_DIR = join(ROOT, ".omk/runs/terminal-bench-2-1/terminal-bench-2-1/tasks");

/** Regression mix: deliberately oversamples easy tasks; not a population-weighted score. */
const DIFFICULTY_MIX = { easy: 0.15, medium: 0.55, hard: 0.3 };

/** @typedef {"easy" | "medium" | "hard"} DifficultyBand */
/** @typedef {Readonly<{name: string, difficulty: string, category: string, expertMinutes: number | null}>} Task */

/** @param {string[]} argv */
function parseArgs(argv) {
	const options = { tasksDir: DEFAULT_TASKS_DIR, size: 15, seed: 1, json: false };
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--json") options.json = true;
		else if (arg === "--tasks" || arg === "--size" || arg === "--seed") {
			const value = argv[++index];
			if (value === undefined || value.trim() === "" || value.startsWith("--")) {
				console.error(`${arg} requires a value`);
				process.exit(2);
			}
			if (arg === "--tasks") options.tasksDir = value;
			else if (arg === "--size") options.size = Number(value);
			else options.seed = Number(value);
		} else {
			console.error(`unknown argument: ${arg}`);
			process.exit(2);
		}
	}
	if (!Number.isSafeInteger(options.size) || options.size <= 0) {
		console.error("--size must be a positive safe integer");
		process.exit(2);
	}
	if (!Number.isInteger(options.seed) || options.seed < 0 || options.seed > 0xffff_ffff) {
		console.error("--seed must be an unsigned 32-bit integer (0..4294967295)");
		process.exit(2);
	}
	return options;
}

/** Limited flat TOML field extraction, not a general TOML parser.
 * @param {string} text @param {string} key
 */
function readField(text, key) {
	const match = text.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, "mu"));
	if (!match) return undefined;
	return match[1].trim().replace(/^["']|["']$/gu, "");
}

/** @param {string} tasksDir @returns {Task[]} */
function loadTasks(tasksDir) {
	if (!existsSync(tasksDir) || !statSync(tasksDir).isDirectory()) {
		console.error(`Tasks directory not found or not a directory: ${tasksDir}`);
		console.error("Clone harbor-framework/terminal-bench-2-1 first, or pass --tasks.");
		process.exit(1);
	}
	const tasks = [];
	for (const name of readdirSync(tasksDir).sort()) {
		const taskDir = join(tasksDir, name);
		if (!statSync(taskDir).isDirectory()) continue;
		const tomlPath = join(taskDir, "task.toml");
		if (!existsSync(tomlPath)) continue;
		const text = readFileSync(tomlPath, "utf8");
		const rawEstimate = readField(text, "expert_time_estimate_min");
		const parsedEstimate = rawEstimate === undefined || rawEstimate.trim() === "" ? null : Number(rawEstimate);
		tasks.push({
			name,
			difficulty: readField(text, "difficulty") ?? "unknown",
			category: readField(text, "category") ?? "unknown",
			expertMinutes:
				parsedEstimate !== null && Number.isFinite(parsedEstimate) && parsedEstimate >= 0 ? parsedEstimate : null,
		});
	}
	if (tasks.length === 0) {
		console.error("No tasks with task.toml found in the tasks directory");
		process.exit(1);
	}
	return tasks;
}

/** Deterministic 32-bit tie-breaker.
 * @param {string} value @param {number} seed
 */
function hash(value, seed) {
	let h = (2166136261 ^ seed) >>> 0;
	for (let index = 0; index < value.length; index++) {
		h = Math.imul(h ^ value.charCodeAt(index), 16777619) >>> 0;
	}
	return h;
}

/** @param {ReadonlyArray<Task>} tasks @param {number} size @param {number} seed */
function selectMiniSuite(tasks, size, seed) {
	/** @type {Map<string, Task[]>} */
	const byDifficulty = new Map();
	for (const task of tasks) {
		const bucket = byDifficulty.get(task.difficulty) ?? [];
		bucket.push(task);
		byDifficulty.set(task.difficulty, bucket);
	}

	/** @type {Array<[DifficultyBand, number]>} */
	const quotas = [];
	let assigned = 0;
	/** @type {DifficultyBand[]} */
	const bands = ["easy", "medium", "hard"];
	for (const band of bands) {
		const quota = Math.max(1, Math.floor(size * DIFFICULTY_MIX[band]));
		quotas.push([band, quota]);
		assigned += quota;
	}
	if (assigned > size) {
		// A 1–2 task suite cannot represent all three bands. Keep the highest-weight bands, not the first names.
		const rankedBands = bands.slice().sort((a, b) => DIFFICULTY_MIX[b] - DIFFICULTY_MIX[a]);
		for (const quota of quotas) quota[1] = rankedBands.indexOf(quota[0]) < size ? 1 : 0;
	} else if (assigned < size) {
		// Preserve the established allocation for normal-size suites.
		quotas[1][1] += size - assigned;
	}

	/** @param {Task} a @param {Task} b */
	const compareCandidates = (a, b) => {
		const aMinutes = a.expertMinutes ?? Number.POSITIVE_INFINITY;
		const bMinutes = b.expertMinutes ?? Number.POSITIVE_INFINITY;
		if (aMinutes !== bMinutes) return aMinutes - bMinutes;
		const ha = hash(a.name, seed);
		const hb = hash(b.name, seed);
		return ha === hb ? a.name.localeCompare(b.name) : ha - hb;
	};
	const picked = [];
	for (const [band, quota] of quotas) {
		const candidates = (byDifficulty.get(band) ?? []).slice().sort(compareCandidates);
		picked.push(...candidates.slice(0, quota));
	}
	if (picked.length < size) {
		const pickedNames = new Set(picked.map((task) => task.name));
		const remaining = tasks.filter((task) => !pickedNames.has(task.name)).sort(compareCandidates);
		picked.push(...remaining.slice(0, size - picked.length));
	}
	return picked.sort((a, b) => a.name.localeCompare(b.name)).slice(0, size);
}

const options = parseArgs(process.argv.slice(2));
const tasks = loadTasks(options.tasksDir);
if (options.size > tasks.length) {
	console.error(`--size ${options.size} exceeds the available population of ${tasks.length} tasks`);
	process.exit(2);
}
const selected = selectMiniSuite(tasks, options.size, options.seed);
const knownExpertMinutes = selected.reduce((sum, task) => sum + (task.expertMinutes ?? 0), 0);
if (!Number.isFinite(knownExpertMinutes)) {
	console.error("Known expert-time total is nonfinite; refusing selection");
	process.exit(1);
}
const unknownExpertEstimates = selected.filter((task) => task.expertMinutes === null).length;
const totalExpertMinutes = unknownExpertEstimates > 0 ? null : knownExpertMinutes;

if (options.json) {
	console.log(
		JSON.stringify(
			{
				selectionVersion: 2,
				tasksDir: options.tasksDir,
				seed: options.seed,
				size: options.size,
				availableTasks: tasks.length,
				totalExpertMinutes,
				knownExpertMinutes,
				unknownExpertEstimates,
				tasks: selected,
			},
			null,
			2,
		),
	);
} else {
	/** @type {Map<string, number>} */
	const histogram = new Map();
	for (const task of selected) histogram.set(task.difficulty, (histogram.get(task.difficulty) ?? 0) + 1);
	console.log(`Terminal-Bench 2.1 mini-suite — seed ${options.seed}, ${selected.length}/${tasks.length} tasks`);
	console.log(
		`mix: ${[...histogram]
			.sort()
			.map(([band, count]) => `${count} ${band}`)
			.join(
				" / ",
			)} · known expert time ${knownExpertMinutes.toFixed(0)}min · ${unknownExpertEstimates} unknown estimates\n`,
	);
	for (const task of selected) {
		console.log(
			`  ${task.name.padEnd(38)} ${task.difficulty.padEnd(7)} ${(task.expertMinutes === null ? "?" : String(task.expertMinutes)).padStart(5)}min  ${task.category}`,
		);
	}
	console.log(
		"\nSelection only. Pin these task names and the dataset revision in a separate Harbor job before running.",
	);
}
