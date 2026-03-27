import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { grep, SearchDb } from "../src/index.js";

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

const benchDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-natives-grep-bench-"));
const searchDb = new SearchDb(path.join(benchDir, "search-db"));

try {
	// Warm per-root state before timing so the benchmark measures steady-state DB-backed search.
	for (const c of cases) {
		await grep({ pattern: c.pattern, path: c.path, glob: c.glob }, undefined, searchDb);
	}

	console.log(`Benchmark: ${ITERATIONS} iterations per case\n`);

	for (const c of cases) {
		const grepArgs = { pattern: c.pattern, path: c.path, glob: c.glob };
		const rgDefaultArgs = ["--hidden", "--no-ignore", "--no-ignore-vcs"];
		const globArg = c.glob ? ["-g", c.glob] : [];
		const runNative = () => grep(grepArgs, undefined, searchDb);

		const runRg = (): Promise<string> => {
			const { promise, resolve, reject } = Promise.withResolvers<string>();
			const proc = spawn("rg", ["--json", ...rgDefaultArgs, ...globArg, c.pattern, c.path], {
				stdio: ["ignore", "pipe", "ignore"],
			});
			let stdout = "";
			proc.stdout.on("data", (data: Buffer) => {
				stdout += data.toString();
			});
			proc.on("close", () => resolve(stdout));
			proc.on("error", reject);
			return promise;
		};

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

		const nativeMatches = (await runNative()).totalMatches;
		const rgMatches = countMatches(await runRg());

		let start = Bun.nanoseconds();
		for (let i = 0; i < ITERATIONS; i++) await runNative();
		const nativeMs = (Bun.nanoseconds() - start) / 1e6 / ITERATIONS;

		start = Bun.nanoseconds();
		for (let i = 0; i < ITERATIONS; i++) {
			await Promise.all(Array.from({ length: CONCURRENCY }, () => runNative()));
		}
		const nativeConcurrentMs = (Bun.nanoseconds() - start) / 1e6 / ITERATIONS;

		start = Bun.nanoseconds();
		for (let i = 0; i < ITERATIONS; i++) await runRg();
		const rgMs = (Bun.nanoseconds() - start) / 1e6 / ITERATIONS;

		start = Bun.nanoseconds();
		for (let i = 0; i < ITERATIONS; i++) {
			await Promise.all(Array.from({ length: CONCURRENCY }, () => runRg()));
		}
		const rgConcurrentMs = (Bun.nanoseconds() - start) / 1e6 / ITERATIONS;

		console.log(`${c.name}:`);
		console.log(`  Native + DB:          ${nativeMs.toFixed(2)}ms (${nativeMatches} matches)`);
		console.log(`  Native + DB 8x:       ${nativeConcurrentMs.toFixed(2)}ms`);
		console.log(`  Subprocess rg:        ${rgMs.toFixed(2)}ms (${rgMatches} matches)`);
		console.log(`  Subprocess rg 8x:     ${rgConcurrentMs.toFixed(2)}ms`);

		const nativeVsRg = rgMs / nativeMs;
		const nativeVsRgConcurrent = rgConcurrentMs / nativeConcurrentMs;
		console.log(
			`  => Native + DB is ${nativeVsRg > 1 ? `${nativeVsRg.toFixed(1)}x faster` : `${(1 / nativeVsRg).toFixed(1)}x slower`} than rg (sequential)`,
		);
		console.log(
			`  => Native + DB is ${nativeVsRgConcurrent > 1 ? `${nativeVsRgConcurrent.toFixed(1)}x faster` : `${(1 / nativeVsRgConcurrent).toFixed(1)}x slower`} than rg (8x concurrent)\n`,
		);
	}
} finally {
	await fs.rm(benchDir, { recursive: true, force: true });
}