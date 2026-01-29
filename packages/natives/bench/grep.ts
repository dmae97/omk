import { spawn } from "node:child_process";
import * as path from "node:path";
import { grep, grepPool, terminate } from "../src/index.js";

const ITERATIONS = 50;
const CONCURRENCY = 8;

const packages = path.resolve(import.meta.dir, "../..");

interface BenchCase {
	name: string;
	path: string;
	pattern: string;
	glob?: string;
}

const cases: BenchCase[] = [
	{ name: "Medium (50 files)", path: path.resolve(packages, "tui/src"), pattern: "export", glob: "*.ts" },
	{ name: "Large (200+ files)", path: path.resolve(packages, "coding-agent/src"), pattern: "import", glob: "*.ts" },
];

// Warmup
await grep({ pattern: "test", path: path.resolve(packages, "tui/src") });
await grepPool({ pattern: "test", path: path.resolve(packages, "tui/src") });

console.log(`Benchmark: ${ITERATIONS} iterations per case\n`);

for (const c of cases) {
	// Main thread sequential
	const mainTimes: number[] = [];
	let mainMatches = 0;
	for (let i = 0; i < ITERATIONS; i++) {
		const start = performance.now();
		const result = await grep({ pattern: c.pattern, path: c.path, glob: c.glob });
		mainTimes.push(performance.now() - start);
		mainMatches = result.totalMatches;
	}

	// Main thread concurrent (8x parallel)
	const mainConcurrentTimes: number[] = [];
	for (let i = 0; i < ITERATIONS; i++) {
		const start = performance.now();
		await Promise.all(
			Array.from({ length: CONCURRENCY }, () => grep({ pattern: c.pattern, path: c.path, glob: c.glob })),
		);
		mainConcurrentTimes.push(performance.now() - start);
	}

	// Worker pool sequential
	const poolTimes: number[] = [];
	let poolMatches = 0;
	for (let i = 0; i < ITERATIONS; i++) {
		const start = performance.now();
		const result = await grepPool({ pattern: c.pattern, path: c.path, glob: c.glob });
		poolTimes.push(performance.now() - start);
		poolMatches = result.totalMatches;
	}

	// Worker pool concurrent (8x parallel)
	const poolConcurrentTimes: number[] = [];
	for (let i = 0; i < ITERATIONS; i++) {
		const start = performance.now();
		await Promise.all(
			Array.from({ length: CONCURRENCY }, () => grepPool({ pattern: c.pattern, path: c.path, glob: c.glob })),
		);
		poolConcurrentTimes.push(performance.now() - start);
	}

	// Subprocess rg sequential
	const rgTimes: number[] = [];
	let rgMatches = 0;
	const rgDefaultArgs = ["--hidden", "--no-ignore", "--no-ignore-vcs"];
	const globArg = c.glob ? ["-g", c.glob] : [];

	const runRg = (): Promise<string> =>
		new Promise((resolve, reject) => {
			const proc = spawn("rg", ["--json", ...rgDefaultArgs, ...globArg, c.pattern, c.path], {
				stdio: ["ignore", "pipe", "ignore"],
			});
			let stdout = "";
			proc.stdout.on("data", (data: Buffer) => {
				stdout += data.toString();
			});
			proc.on("close", () => resolve(stdout));
			proc.on("error", reject);
		});

	const countMatches = (result: string): number => {
		const lines = result.split("\n").filter((l) => l.trim());
		let matches = 0;
		for (const line of lines) {
			try {
				if (JSON.parse(line).type === "match") matches++;
			} catch {
				/* ignore */
			}
		}
		return matches;
	};

	for (let i = 0; i < ITERATIONS; i++) {
		const start = performance.now();
		const result = await runRg();
		rgTimes.push(performance.now() - start);
		rgMatches = countMatches(result);
	}

	// Subprocess rg concurrent (8x parallel)
	const rgConcurrentTimes: number[] = [];
	for (let i = 0; i < ITERATIONS; i++) {
		const start = performance.now();
		await Promise.all(Array.from({ length: CONCURRENCY }, () => runRg()));
		rgConcurrentTimes.push(performance.now() - start);
	}

	const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

	console.log(`${c.name}:`);
	console.log(`  Main thread:          ${avg(mainTimes).toFixed(2)}ms (${mainMatches} matches)`);
	console.log(`  Main thread 8x:       ${avg(mainConcurrentTimes).toFixed(2)}ms`);
	console.log(`  Worker pool:          ${avg(poolTimes).toFixed(2)}ms (${poolMatches} matches)`);
	console.log(`  Worker pool 8x:       ${avg(poolConcurrentTimes).toFixed(2)}ms`);
	console.log(`  Subprocess rg:        ${avg(rgTimes).toFixed(2)}ms (${rgMatches} matches)`);
	console.log(`  Subprocess rg 8x:     ${avg(rgConcurrentTimes).toFixed(2)}ms`);

	const mainVsRg = avg(rgTimes) / avg(mainTimes);
	const poolVsRgConcurrent = avg(rgConcurrentTimes) / avg(poolConcurrentTimes);
	console.log(
		`  => Main thread is ${mainVsRg > 1 ? `${mainVsRg.toFixed(1)}x faster` : `${(1 / mainVsRg).toFixed(1)}x slower`} than rg (sequential)`,
	);
	console.log(
		`  => Worker pool is ${poolVsRgConcurrent > 1 ? `${poolVsRgConcurrent.toFixed(1)}x faster` : `${(1 / poolVsRgConcurrent).toFixed(1)}x slower`} than rg (8x concurrent)\n`,
	);
}

terminate();
