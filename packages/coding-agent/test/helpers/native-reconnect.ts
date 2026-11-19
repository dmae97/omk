import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { planVerifiedRun, RunCoordinator } from "../../src/core/run-execution-api.ts";
import { readRunJournal } from "../../src/core/verified-run/journal.ts";
import {
	nativeExecutionDir,
	nativeRequestId,
	readRustExecutionRecord,
} from "../../src/core/verified-run/rust-host-record.ts";

export async function waitUntil(check: () => boolean, timeoutMs = 15_000): Promise<void> {
	const deadline = performance.now() + timeoutMs;
	while (!check()) {
		if (performance.now() >= deadline) throw new Error("checkpoint timeout");
		await delay(20);
	}
}

/** A real source-CLI parent, killed only after its candidate code has started. */
export async function nativeWriter(binary: string, workMs = 60_000) {
	const root = mkdtempSync(join(tmpdir(), "native-reconnect-"));
	const workspace = join(root, "project");
	const stateRoot = join(root, "state");
	const runPath = join(stateRoot, "reconnect");
	mkdirSync(workspace);
	const contract = {
		schemaVersion: "omk.verified-run.v1",
		profile: "linux-command-v1",
		runId: "reconnect",
		goal: "Complete the same writer once",
		workspace: { root: workspace, baseDigest: "0".repeat(64) },
		writablePaths: ["attempts", "started", "release", "output"],
		writer: [
			"/bin/sh",
			"-c",
			"printf x >> attempts; touch started; while ! test -f release; do sleep 0.02; done; printf recovered > output",
		],
		checks: [{ claimId: "output", argv: ["/bin/cat", "output"], stdout: "recovered" }],
		budget: { workMs, verifyMs: 15_000, cleanupMs: 5_000, maxOutputBytes: 4096, maxFiles: 100, maxBytes: 65536 },
		apply: "artifact-only",
	};
	contract.workspace.baseDigest = planVerifiedRun(contract).baseDigest;
	const plan = planVerifiedRun(contract);
	const contractPath = join(root, "contract.json");
	writeFileSync(contractPath, JSON.stringify(contract));
	const repo = fileURLToPath(new URL("../../../../", import.meta.url));
	const env = {
		PATH: process.env.PATH,
		HOME: root,
		OMK_OFFLINE: "1",
		OMK_SKIP_VERSION_CHECK: "1",
		OMK_RUST_EXECUTION_HOST: binary,
		OMK_RUST_EXECUTION_RECONNECT: "1",
	};
	const prefix = ["--import", "tsx", "packages/coding-agent/src/cli.ts", "run"];
	const parent = spawn(
		process.execPath,
		[
			...prefix,
			"start",
			"--contract",
			contractPath,
			"--approve",
			plan.contractDigest,
			"--command-id",
			"start",
			"--state-dir",
			stateRoot,
		],
		{ cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] },
	);
	const closed = once(parent, "close");
	parent.stdout.resume();
	let diagnostic = "";
	parent.stderr.on("data", (b: Buffer) => {
		diagnostic = (diagnostic + b.toString()).slice(-2048);
	});
	const coordinator = new RunCoordinator(stateRoot);
	let executionId = "";
	const cleanup = async () => {
		if (parent.exitCode === null && parent.signalCode === null) parent.kill("SIGKILL");
		await closed;
		if (executionId) {
			const id = nativeRequestId(executionId);
			writeFileSync(join(nativeExecutionDir(stateRoot), `${id}.cancel`), "", { mode: 0o600 });
			await waitUntil(() => {
				const record = readRustExecutionRecord(nativeExecutionDir(stateRoot), id, 4096);
				if (!record || record.terminal) return true;
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
			}, 8_000);
		}
		rmSync(root, { recursive: true, force: true });
	};
	try {
		await waitUntil(() => {
			if (parent.exitCode !== null || parent.signalCode !== null)
				throw new Error(`source parent exited: ${diagnostic}`);
			return existsSync(join(runPath, "writer", "started"));
		});
		executionId = coordinator.inspect("reconnect").activeExecutionIds[0] ?? "";
		if (!executionId) throw new Error("missing execution");
		const before = readRunJournal(runPath);
		if (!before) throw new Error("missing journal");
		const authorityBefore = coordinator.inspectAuthority();
		parent.kill("SIGKILL");
		await closed;
		const command = {
			schemaVersion: "omk.verified-command.v1",
			kind: "reconnect",
			runId: "reconnect",
			commandId: "reconnect-1",
			executionId,
			expectedRevision: before.state.revision,
			expectedGeneration: before.state.generation,
			contractDigest: plan.contractDigest,
		};
		return {
			root,
			workspace,
			stateRoot,
			runPath,
			repo,
			env,
			prefix,
			coordinator,
			before,
			authorityBefore,
			command,
			approval: { approvedContractDigest: plan.contractDigest },
			cleanup,
			recordPath: join(nativeExecutionDir(stateRoot), `${nativeRequestId(executionId)}.jsonl`),
			release: () => writeFileSync(join(runPath, "writer", "release"), ""),
			record: () => readRustExecutionRecord(nativeExecutionDir(stateRoot), nativeRequestId(executionId), 4096),
			attempts: () => readFileSync(join(runPath, "writer", "attempts"), "utf8"),
		};
	} catch (error) {
		await cleanup();
		throw error;
	}
}
