import { spawn } from "node:child_process";
import * as path from "node:path";
import { grep } from "../src/index.js";

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

console.log(`Benchmark: ${ITERATIONS} iterations per case\n`);

for (const c of cases) {
	const grepArgs = { pattern: c.pattern, path: c.path, glob: c.glob };
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

	// Capture match counts from a single run
	const mainMatches = (await grep(grepArgs)).totalMatches;
	const rgMatches = countMatches(await runRg());

	// Main thread sequential
	let start = Bun.nanoseconds();
	for (let i = 0; i < ITERATIONS; i++) await grep(grepArgs);
	const mainMs = (Bun.nanoseconds() - start) / 1e6 / ITERATIONS;

	// Main thread concurrent (8x parallel)
	start = Bun.nanoseconds();
	for (let i = 0; i < ITERATIONS; i++) {
		await Promise.all(Array.from({ length: CONCURRENCY }, () => grep(grepArgs)));
	}
	const mainConcurrentMs = (Bun.nanoseconds() - start) / 1e6 / ITERATIONS;

	// Subprocess rg sequential
	start = Bun.nanoseconds();
	for (let i = 0; i < ITERATIONS; i++) await runRg();
	const rgMs = (Bun.nanoseconds() - start) / 1e6 / ITERATIONS;

	// Subprocess rg concurrent (8x parallel)
	start = Bun.nanoseconds();
	for (let i = 0; i < ITERATIONS; i++) {
		await Promise.all(Array.from({ length: CONCURRENCY }, () => runRg()));
	}
	const rgConcurrentMs = (Bun.nanoseconds() - start) / 1e6 / ITERATIONS;

	console.log(`${c.name}:`);
	console.log(`  Main thread:          ${mainMs.toFixed(2)}ms (${mainMatches} matches)`);
	console.log(`  Main thread 8x:       ${mainConcurrentMs.toFixed(2)}ms`);
	console.log(`  Subprocess rg:        ${rgMs.toFixed(2)}ms (${rgMatches} matches)`);
	console.log(`  Subprocess rg 8x:     ${rgConcurrentMs.toFixed(2)}ms`);

	const mainVsRg = rgMs / mainMs;
	const mainVsRgConcurrent = rgConcurrentMs / mainConcurrentMs;
	console.log(
		`  => Main thread is ${mainVsRg > 1 ? `${mainVsRg.toFixed(1)}x faster` : `${(1 / mainVsRg).toFixed(1)}x slower`} than rg (sequential)`,
	);
	console.log(
		`  => Main thread is ${mainVsRgConcurrent > 1 ? `${mainVsRgConcurrent.toFixed(1)}x faster` : `${(1 / mainVsRgConcurrent).toFixed(1)}x slower`} than rg (8x concurrent)\n`,
	);
}
