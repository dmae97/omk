#!/usr/bin/env bun
/**
 * Spawns many instances of the CLI to reproduce rare stuck/hang issues.
 * Healthy instances (that produce TUI output) are killed.
 * Stuck instances (no output after timeout) are kept alive for debugging.
 *
 * Usage: bun scripts/repro-stuck.ts [options]
 *
 * Options:
 *   --count=N     Instances per batch (default: 50)
 *   --timeout=N   Ms to wait for output (default: 15000)
 *   --rounds=N    Max rounds to try (default: 1000)
 */

import { Subprocess } from "bun";
import * as path from "node:path";

const CLI_PATH = path.resolve(import.meta.dir, "../packages/coding-agent/src/cli.ts");
const TRACE_LOADER = path.resolve(import.meta.dir, "trace-loader.ts");
const POLL_INTERVAL = 200;

interface Args {
	count: number;
	timeout: number;
	rounds: number;
}

function parseArgs(): Args {
	const args: Args = { count: 50, timeout: 15000, rounds: 1000 };
	for (const arg of process.argv.slice(2)) {
		const [key, val] = arg.replace(/^--/, "").split("=");
		if (key === "count") args.count = parseInt(val, 10);
		if (key === "timeout") args.timeout = parseInt(val, 10);
		if (key === "rounds") args.rounds = parseInt(val, 10);
	}
	return args;
}

interface Instance {
	proc: Subprocess;
	port: number;
	stdout: string;
	stderr: string;
	status: "pending" | "launched" | "exited" | "stuck";
}

/** Check if stdout contains the TUI (success indicator) */
function hasLaunched(stdout: string): boolean {
	return stdout.includes("omp v") || stdout.includes("▀█") || stdout.includes("Welcome back");
}

/** Non-blocking drain of a stream */
async function drainStream(stream: ReadableStream<Uint8Array>): Promise<string> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let result = "";
	try {
		while (true) {
			const read = reader.read();
			const timeout = Bun.sleep(10).then(() => ({ done: true, value: undefined, timedOut: true }));
			const chunk = (await Promise.race([read, timeout])) as { done: boolean; value?: Uint8Array; timedOut?: boolean };
			if (chunk.timedOut || chunk.done) break;
			if (chunk.value) result += decoder.decode(chunk.value);
		}
	} finally {
		reader.releaseLock();
	}
	return result;
}

async function spawnBatch(count: number, basePort: number, timeout: number): Promise<Instance | null> {
	const instances: Instance[] = [];

	// Spawn all
	for (let i = 0; i < count; i++) {
		const port = basePort + i;
		const proc = Bun.spawn(["bun", "--preload", TRACE_LOADER, `--inspect=127.0.0.1:${port}`, CLI_PATH], {
			stdout: "pipe",
			stderr: "pipe",
			stdin: "pipe",
			env: { ...Bun.env, NO_COLOR: "1", PI_DEBUG_STARTUP: "1" },
		});
		instances.push({ proc, port, stdout: "", stderr: "", status: "pending" });
	}

	const start = Date.now();

	// Poll until all resolved or timeout
	while (Date.now() - start < timeout) {
		let allResolved = true;

		for (const inst of instances) {
			if (inst.status !== "pending") continue;

			// Check if exited
			if (inst.proc.exitCode !== null) {
				inst.status = "exited";
				continue;
			}

			// Drain available output
			try {
				inst.stdout += await drainStream(inst.proc.stdout as ReadableStream<Uint8Array>);
				inst.stderr += await drainStream(inst.proc.stderr as ReadableStream<Uint8Array>);
			} catch {}

			// Check if launched
			if (hasLaunched(inst.stdout)) {
				inst.status = "launched";
				inst.proc.kill();
				continue;
			}

			allResolved = false;
		}

		if (allResolved) break;
		await Bun.sleep(POLL_INTERVAL);
	}

	// Mark remaining pending as stuck
	for (const inst of instances) {
		if (inst.status === "pending") {
			// Final drain
			try {
				inst.stdout += await drainStream(inst.proc.stdout as ReadableStream<Uint8Array>);
				inst.stderr += await drainStream(inst.proc.stderr as ReadableStream<Uint8Array>);
			} catch {}
			inst.status = inst.proc.exitCode !== null ? "exited" : "stuck";
		}
	}

	// Find and report stuck instances
	let stuck: Instance | null = null;
	for (const inst of instances) {
		if (inst.status === "stuck") {
			stuck = inst;
			console.log(`\n\n🎯 STUCK INSTANCE FOUND!`);
			console.log(`   PID: ${inst.proc.pid}`);
			console.log(`   Inspector: ws://127.0.0.1:${inst.port}`);
			console.log(`   Stdout: ${inst.stdout.slice(0, 200) || "(none)"}`);

			const traceLines = inst.stderr.split("\n").filter(l => l.startsWith("[") && !l.includes("Bun Inspector"));
			if (traceLines.length > 0) {
				console.log(`   Last traces (${traceLines.length} total):`);
				for (const line of traceLines.slice(-15)) {
					console.log(`     ${line}`);
				}
			}
		} else if (inst.status !== "launched") {
			inst.proc.kill();
		}
	}

	return stuck;
}

async function main() {
	const args = parseArgs();

	console.log(`🔍 Hunting for stuck process...`);
	console.log(`   Batch size: ${args.count}`);
	console.log(`   Timeout: ${args.timeout}ms`);
	console.log();

	let basePort = 9230;
	let totalSpawned = 0;

	for (let round = 1; round <= args.rounds; round++) {
		process.stdout.write(`\rRound ${round}/${args.rounds} (${totalSpawned} spawned)...`);

		const stuck = await spawnBatch(args.count, basePort, args.timeout);
		totalSpawned += args.count;

		if (stuck) {
			console.log(`\n✅ Found after ${round} rounds, ${totalSpawned} total spawns`);
			console.log(`\nTo debug: chrome://inspect → Configure → 127.0.0.1:${stuck.port}`);
			console.log(`Press Ctrl+C to exit`);
			await new Promise(() => {});
		}

		basePort += args.count;
		if (basePort > 60000) basePort = 9230;
	}

	console.log(`\n\n❌ No stuck process found after ${totalSpawned} spawns`);
	process.exit(1);
}

main().catch(console.error);
