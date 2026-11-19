import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { journalPath } from "../../src/core/verified-run/journal.ts";
import { readRustExecutionRecord } from "../../src/core/verified-run/rust-host-record.ts";
import { waitUntil } from "./native-reconnect.ts";
import { nativeVerifier } from "./native-verifier.ts";

/** Explicit old mtimes avoid WSL wall-clock resync racing the eligibility assertion. */
export function ageNativeGcArtifacts(run: Pick<Awaited<ReturnType<typeof nativeVerifier>>, "runPath" | "recordDir">) {
	const old = new Date("2000-01-01T00:00:00.000Z");
	for (const name of readdirSync(run.recordDir)) utimesSync(join(run.recordDir, name), old, old);
	utimesSync(journalPath(run.runPath), old, old);
}

export async function settledNativeVerifier(binary: string) {
	const run = await nativeVerifier(binary, { mode: "receipt-written" });
	try {
		await run.kill();
		const command = run.command();
		const result = await run.coordinator.reconnect(command, { approvedContractDigest: run.digest });
		for (const name of readdirSync(run.recordDir).filter((name) => name.endsWith(".jsonl"))) {
			const record = readRustExecutionRecord(run.recordDir, name.slice(0, -6), 1024)!;
			await waitUntil(() => {
				try {
					const stat = readFileSync(`/proc/${record.host.pid}/stat`, "utf8");
					const fields = stat
						.slice(stat.lastIndexOf(")") + 2)
						.trim()
						.split(/\s+/);
					return fields[19] !== record.host.ticks || fields[0] === "Z" || fields[0] === "X";
				} catch {
					return true;
				}
			});
		}
		ageNativeGcArtifacts(run);
		return { ...run, result, completedCommand: command };
	} catch (error) {
		await run.cleanup();
		throw error;
	}
}

export function nativeGcCli(
	run: Pick<Awaited<ReturnType<typeof nativeVerifier>>, "stateRoot" | "repo" | "env">,
	execute: boolean,
) {
	return spawnSync(
		process.execPath,
		[
			"--import",
			"tsx",
			"packages/coding-agent/src/cli.ts",
			"run",
			"gc",
			"--state-dir",
			run.stateRoot,
			"--older-than",
			"0ms",
			...(execute ? ["--execute"] : []),
		],
		{ cwd: run.repo, env: run.env, encoding: "utf8", timeout: 15_000 },
	);
}
