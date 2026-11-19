import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRunReconnectCommand } from "omk-protocol";
import { planVerifiedRun, RunCoordinator } from "../../src/core/run-execution-api.ts";
import { readRunJournal } from "../../src/core/verified-run/journal.ts";
import {
	nativeExecutionDir,
	nativeRequestId,
	readRustExecutionRecord,
	requestRustCancel,
} from "../../src/core/verified-run/rust-host-record.ts";
import { waitUntil } from "./native-reconnect.ts";

export async function nativeVerifier(
	binary: string,
	options: {
		mode?: "live" | "exit-written" | "receipt-written";
		checks?: readonly { claimId: string; argv: readonly string[]; stdout: string }[];
		verifyMs?: number;
		workMs?: number;
		targetClaim?: string;
	} = {},
) {
	const root = mkdtempSync(join(tmpdir(), "omk-native-verifier-"));
	const workspace = join(root, "workspace");
	mkdirSync(workspace);
	writeFileSync(join(workspace, "input.txt"), "input");
	const stateRoot = join(root, "state");
	const coordinator = new RunCoordinator(stateRoot);
	const mode = options.mode ?? "live";
	const raw = {
		schemaVersion: "omk.verified-run.v1",
		profile: "linux-command-v1",
		runId: "verifier",
		goal: "Observe the same verifier",
		workspace: { root: workspace, baseDigest: "0".repeat(64) },
		writablePaths: ["output.txt"],
		writer: ["/bin/sh", "-c", "printf candidate > output.txt"],
		checks: options.checks ?? [
			{
				claimId: "check",
				argv: ["/bin/sh", "-c", mode !== "live" ? "cat output.txt" : "sleep 3; cat output.txt"],
				stdout: "candidate",
			},
		],
		budget: {
			workMs: options.workMs ?? 10_000,
			verifyMs: options.verifyMs ?? 20_000,
			cleanupMs: 1000,
			maxOutputBytes: 1024,
			maxFiles: 100,
			maxBytes: 65536,
		},
		apply: "artifact-only",
	};
	raw.workspace.baseDigest = planVerifiedRun(raw).baseDigest;
	const plan = planVerifiedRun(raw);
	const contractPath = join(root, "contract.json");
	writeFileSync(contractPath, JSON.stringify(raw));
	const checkpoint = join(root, "checkpoint");
	const repo = fileURLToPath(new URL("../../../../", import.meta.url));
	const env = {
		PATH: process.env.PATH,
		HOME: root,
		OMK_OFFLINE: "1",
		OMK_SKIP_VERSION_CHECK: "1",
		OMK_RUST_EXECUTION_HOST: binary,
		OMK_RUST_EXECUTION_RECONNECT: "1",
	};
	const args =
		mode === "live"
			? [
					"packages/coding-agent/src/cli.ts",
					"run",
					"start",
					"--contract",
					contractPath,
					"--approve",
					plan.contractDigest,
					"--command-id",
					"start",
					"--state-dir",
					stateRoot,
				]
			: [
					"packages/coding-agent/test/fixtures/native-verifier-owner.ts",
					stateRoot,
					contractPath,
					plan.contractDigest,
					mode,
					checkpoint,
				];
	const child = spawn(process.execPath, ["--import", "tsx", ...args], {
		cwd: repo,
		env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let output = "";
	child.stdout.on("data", (bytes) => {
		output += String(bytes);
	});
	child.stderr.on("data", (bytes) => {
		output += String(bytes);
	});
	const closed = once(child, "close");
	const runPath = join(stateRoot, "verifier");
	const recordDir = nativeExecutionDir(stateRoot);
	const snapshot = () => readRunJournal(runPath);
	const verifierId = () =>
		snapshot()?.records.find(
			({ event }) =>
				event.kind === "dispatch" &&
				event.role === "verifier" &&
				(!options.targetClaim || event.claimId === options.targetClaim),
		)?.event;
	const kill = async () => {
		if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
		await closed;
	};
	const cleanup = async () => {
		await kill();
		for (const process of snapshot()?.state.processes ?? []) {
			const id = nativeRequestId(process.executionId);
			if (!existsSync(join(recordDir, `${id}.jsonl`))) continue;
			requestRustCancel(recordDir, id);
			await waitUntil(() => {
				const record = readRustExecutionRecord(recordDir, id, 1024);
				if (record?.terminal) return true;
				try {
					const stat = readFileSync(`/proc/${record?.host.pid}/stat`, "utf8");
					const fields = stat
						.slice(stat.lastIndexOf(")") + 2)
						.trim()
						.split(/\s+/);
					return fields[0] === "Z" || fields[19] !== record?.host.ticks;
				} catch {
					return true;
				}
			}, 8000);
		}
		rmSync(root, { recursive: true, force: true });
	};
	try {
		await waitUntil(() => {
			if (child.exitCode !== null || child.signalCode !== null) throw new Error(`owner exited: ${output}`);
			const event = verifierId();
			if (event?.kind !== "dispatch") return false;
			if (mode !== "live") return existsSync(checkpoint);
			try {
				return !!readRustExecutionRecord(recordDir, nativeRequestId(event.executionId), 1024)?.committed;
			} catch {
				return false;
			}
		});
	} catch (error) {
		await cleanup();
		throw error;
	}
	const event = verifierId();
	if (event?.kind !== "dispatch") throw new Error("missing verifier dispatch");
	const executionId = event.executionId;
	const command = () =>
		parseRunReconnectCommand({
			schemaVersion: "omk.verified-command.v1",
			kind: "reconnect",
			runId: "verifier",
			commandId: "reconnect",
			contractDigest: plan.contractDigest,
			expectedRevision: snapshot()!.state.revision,
			expectedGeneration: snapshot()!.state.generation,
			executionId,
		});
	return {
		root,
		workspace,
		stateRoot,
		runPath,
		recordDir,
		coordinator,
		digest: plan.contractDigest,
		executionId,
		snapshot,
		command,
		kill,
		cleanup,
		repo,
		env,
	};
}
