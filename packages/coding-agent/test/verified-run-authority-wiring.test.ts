import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseRunContract } from "omk-protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type AuthorityRecord,
	AuthorityStore,
	authorityStorePath,
	planVerifiedRun,
	RunCoordinator,
} from "../src/core/run-execution-api.ts";
import { readRunJournal } from "../src/core/verified-run/journal.ts";
import { OMK_ACCEPTED_REF, publishPolicyDigest } from "../src/core/verified-run/run-publish.ts";
import { dagFixture } from "./verified-run-dag-fixture.ts";

/**
 * WP03 §8 integration: the real verified-run dispatch path records through
 * the durable authority store — grant → dispatch-intent → effect-started →
 * termination-observed — and a restart reconciles quarantined effects before
 * any successor dispatch is admitted. Fail-closed is preserved: a quarantined
 * grant without a provable termination keeps its claims and blocks overlap.
 */

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "authority-wiring-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function authorityRecords(stateRoot: string): readonly AuthorityRecord[] {
	return AuthorityStore.inspectJournal(authorityStorePath(stateRoot)).records;
}

function kinds(records: readonly AuthorityRecord[]): string[] {
	return records.map((record) => record.event.kind);
}

describe("authority wiring on the real dispatch path", () => {
	it("records grant, intent, start and termination for every dispatch of a real run", async () => {
		const f = dagFixture(root);
		const state = await f.coordinator.start(f.contract, f.command, f.approval);
		expect(state.application).toBe("candidate_ready");
		const records = authorityRecords(f.stateRoot);
		const eventKinds = kinds(records);
		// Epoch advanced and reconciled exactly once around this writer's work;
		// one session incarnation registered for the run.
		expect(eventKinds.filter((kind) => kind === "authority-epoch-advanced")).toHaveLength(1);
		expect(eventKinds.filter((kind) => kind === "authority-reconciled")).toHaveLength(1);
		expect(eventKinds.filter((kind) => kind === "session-registered")).toHaveLength(1);
		// Every journaled dispatch has a grant-reserved → dispatch-intent →
		// effect-started → termination-observed lifecycle, in order.
		const journal = readRunJournal(f.runPath);
		const executions = journal?.records.flatMap(({ event }) =>
			event.kind === "dispatch" ? [event.executionId] : [],
		);
		expect(executions?.length).toBeGreaterThanOrEqual(4);
		for (const executionId of executions ?? []) {
			const grantIndex = records.findIndex(
				(record) => record.event.kind === "grant-reserved" && record.event.grant.commandId === executionId,
			);
			expect(grantIndex, `grant-reserved for ${executionId}`).toBeGreaterThan(-1);
			const grantRecord = records[grantIndex];
			if (grantRecord?.event.kind !== "grant-reserved") throw new Error("unreachable");
			const grantSequence = grantRecord.event.grant.token.grantSequence;
			const lifecycle = ["dispatch-intent", "effect-started", "termination-observed"] as const;
			let cursor = grantIndex;
			for (const kind of lifecycle) {
				const index = records.findIndex(
					(record, at) =>
						at > cursor &&
						record.event.kind === kind &&
						(record.event as { grantSequence: string }).grantSequence === grantSequence,
				);
				expect(index, `${kind} for ${executionId}`).toBeGreaterThan(cursor);
				cursor = index;
			}
		}
		// Nothing is left holding claims: every grant is settled.
		const view = f.coordinator.inspectAuthority();
		expect(view.status.blockingGrants).toHaveLength(0);
		expect(view.status.pendingReconcile).toBe(false);
		expect(view.status.settledGrantCount).toBe(executions?.length ?? -1);
	});

	it("keeps an unwitnessed quarantined claim blocking the next run — fail closed", async () => {
		const f = dagFixture(root);
		mkdirSync(f.runPath, { recursive: true });
		// Seed an identity-less effect-live grant that quarantines on the next
		// open and can never be probed terminated — the crash window between a
		// committed dispatch intent and the spawn it never reported.
		const store = AuthorityStore.open(authorityStorePath(f.stateRoot), { capacity: 4 });
		store.reconcile();
		store.register("seed");
		const seed = store.acquire({
			sessionId: "seed",
			incarnation: "1",
			commandId: "wedged",
			intentDigest: "a".repeat(64),
			claims: [
				{
					namespace: "filesystem",
					instanceId: "verified-run",
					canonicalKey: realpathSync(f.runPath).replace(/^\/+/, ""),
					access: "write",
					generation: "1",
				},
			],
			now: Date.now(),
			ttl: 60000,
		});
		if (seed.status !== "granted") throw new Error("unreachable");
		expect(store.dispatchIntent(seed.token, "wedged-dispatch")).toBe(true);
		store.release();

		// The new writer opens the store: epoch advances, the seeded effect
		// quarantines, reconcile cannot prove termination (no recorded
		// namespace identity → "unknown"), and the overlapping writer claim is
		// refused rather than silently admitted.
		const state = await f.coordinator.start(f.contract, f.command, f.approval);
		expect(state.execution).toBe("failed");
		expect(state.failure).toBe("authority_blocked");
		const records = authorityRecords(f.stateRoot);
		const wedged = records.find(
			(record) => record.event.kind === "grant-reserved" && record.event.grant.commandId === "wedged",
		);
		expect(wedged).toBeDefined();
		const events = records.map((record) => record.event);
		if (wedged?.event.kind !== "grant-reserved") throw new Error("unreachable");
		const grantSequence = wedged.event.grant.token.grantSequence;
		// The coordinator's restart is the last epoch advance; it must
		// quarantine exactly the seeded grant.
		const epoch = events.filter((event) => event.kind === "authority-epoch-advanced").at(-1);
		if (epoch?.kind !== "authority-epoch-advanced") throw new Error("missing epoch advance");
		expect(epoch.transitions).toEqual([{ grantSequence, outcome: "quarantined" }]);
		expect(events.filter((event) => event.kind === "termination-observed")).toHaveLength(0);
		// The wedged grant still holds its claim; the run's own grant was never minted.
		const view = f.coordinator.inspectAuthority();
		expect(view.status.blockingGrants.map((grant) => grant.commandId)).toEqual(["wedged"]);
		expect(view.status.blockingGrants[0]?.cause).toBe("restart_unreconciled");
	});

	it("reconciles a SIGKILLed supervisor's intents before any successor dispatch", async () => {
		const f = dagFixture(root);
		mkdirSync(f.stateRoot);
		f.contract.writer.tasks[0].attempts = [
			["/bin/sh", "-c", "cp input left; sleep 30"],
			["/bin/cp", "input", "left"],
		];
		f.contract.writer.tasks[1].attempts = [
			["/bin/sh", "-c", "tr a-z A-Z < input > right; sleep 30"],
			["/bin/sh", "-c", "tr a-z A-Z < input > right"],
		];
		const contract = { ...f.contract, writer: { ...f.contract.writer, maxConcurrentTasks: 2 } };
		const plan = planVerifiedRun(contract);
		const contractPath = join(root, "contract.json");
		writeFileSync(contractPath, JSON.stringify(contract));
		const repo = fileURLToPath(new URL("../../../", import.meta.url));
		const env = { PATH: process.env.PATH, HOME: root, OMK_OFFLINE: "1", OMK_SKIP_VERSION_CHECK: "1" };
		const prefix = ["--import", "tsx", "packages/coding-agent/src/cli.ts", "run"];
		const child = spawn(
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
				f.stateRoot,
			],
			{ cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] },
		);
		child.stdout.resume();
		let diagnostics = "";
		child.stderr.on("data", (bytes: Buffer) => {
			diagnostics = (diagnostics + bytes.toString()).slice(-4096);
		});
		const closed = once(child, "close");
		try {
			await new Promise<void>((resolve, reject) => {
				let done = false;
				const timer = setTimeout(() => finish(new Error(`parallel writer timeout: ${diagnostics}`)), 20000);
				const watcher = watch(f.stateRoot, { recursive: true }, () => {
					if (
						existsSync(join(f.runPath, "tasks", "left-1-g1", "left")) &&
						existsSync(join(f.runPath, "tasks", "right-1-g1", "right"))
					)
						finish();
				});
				function finish(error?: Error) {
					if (done) return;
					done = true;
					clearTimeout(timer);
					watcher.close();
					if (error) reject(error);
					else resolve();
				}
				void closed.then(
					() => finish(new Error(`supervisor exited early: ${diagnostics}`)),
					() => finish(new Error("child error")),
				);
			});
			child.kill("SIGKILL");
			await closed;
			// Wait until the killed namespaces are provably gone, then drive the
			// successor through the real CLI — its store open must quarantine the
			// crashed writer's intents and reconcile them before new dispatch.
			const deadline = performance.now() + 5000;
			while (f.coordinator.inspectTaskRecovery("dag").reason === "unsettled" && performance.now() < deadline)
				await delay(10);
			const report = f.coordinator.inspectTaskRecovery("dag");
			expect(report).toMatchObject({ readiness: "ready", retryableTaskIds: ["left", "right"] });
			const result = spawnSync(
				process.execPath,
				[
					...prefix,
					"retry-tasks",
					"dag",
					"--execute",
					"--tasks",
					"left,right",
					"--approve",
					plan.contractDigest,
					"--base",
					contract.workspace.baseDigest,
					"--revision",
					String(report.state.revision),
					"--generation",
					String(report.state.generation),
					"--command-id",
					"retry",
					"--state-dir",
					f.stateRoot,
				],
				{ cwd: repo, env, encoding: "utf8", timeout: 30000 },
			);
			expect(result.status, result.stderr).toBe(0);
			expect(JSON.parse(result.stdout)).toMatchObject({
				generation: 2,
				verification: "verified",
				settlement: "settled",
				activeExecutionIds: [],
			});

			const records = authorityRecords(f.stateRoot);
			const events = records.map((record) => record.event);
			// Two writers were dispatched and started under epoch 1 by the killed supervisor.
			const started = events.filter((event) => event.kind === "effect-started");
			expect(started.length).toBeGreaterThanOrEqual(2);
			// The retry's open advanced the epoch and quarantined exactly the two
			// unsettled grants the crashed writer left behind.
			const advances = events.flatMap((event, index) =>
				event.kind === "authority-epoch-advanced" ? [{ event, index }] : [],
			);
			const restart = advances.at(-1);
			if (restart?.event.kind !== "authority-epoch-advanced") throw new Error("missing restart epoch");
			expect(restart.event.authorityEpoch).toBe("2");
			expect(restart.event.transitions).toHaveLength(2);
			expect(restart.event.transitions.every((transition) => transition.outcome === "quarantined")).toBe(true);
			// Reconcile witnessed both terminations, then reconciled — strictly
			// before the first grant-reserved of the successor generation.
			const quarantined = new Set(restart.event.transitions.map((transition) => transition.grantSequence));
			const witnessed = events.flatMap((event, index) =>
				event.kind === "termination-observed" && quarantined.has(event.grantSequence) ? [{ event, index }] : [],
			);
			expect(witnessed).toHaveLength(2);
			const reconciledIndex = events.findIndex(
				(event, index) => index > restart.index && event.kind === "authority-reconciled",
			);
			const successorGrant = events.findIndex(
				(event, index) => index > restart.index && event.kind === "grant-reserved",
			);
			expect(witnessed.every(({ index }) => index < reconciledIndex)).toBe(true);
			expect(reconciledIndex).toBeGreaterThan(-1);
			expect(successorGrant).toBeGreaterThan(reconciledIndex);
			expect(f.coordinator.inspectAuthority().status.blockingGrants).toHaveLength(0);
		} finally {
			if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
			await closed.catch(() => {});
		}
	}, 60000);

	it("publishes through the same authority boundary — git-ref grant, started, witnessed", async () => {
		const workspace = join(root, "workspace");
		const stateRoot = join(root, "state");
		mkdirSync(workspace);
		writeFileSync(join(workspace, "input.txt"), "hello");
		const git = (args: readonly string[]) => {
			const result = spawnSync("git", args, { cwd: workspace, encoding: "utf8", timeout: 30000 });
			if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
			return result.stdout.trim();
		};
		git(["init", "--initial-branch=main"]);
		git(["config", "--local", "user.email", "fixture@localhost"]);
		git(["config", "--local", "user.name", "fixture"]);
		git(["add", "input.txt"]);
		git(["commit", "-m", "base"]);
		const contract = {
			schemaVersion: "omk.verified-run.v1",
			profile: "linux-command-v1",
			runId: "pub",
			goal: "copy",
			workspace: { root: workspace, baseDigest: "0".repeat(64) },
			writablePaths: ["result.txt"],
			writer: ["/bin/cp", "input.txt", "result.txt"],
			checks: [{ claimId: "answer", argv: ["/bin/cat", "result.txt"], stdout: "hello" }],
			budget: {
				workMs: 5000,
				verifyMs: 15000,
				cleanupMs: 1000,
				maxOutputBytes: 4096,
				maxFiles: 100,
				maxBytes: 65536,
			},
			apply: "artifact-only",
		};
		contract.workspace.baseDigest = planVerifiedRun(contract).baseDigest;
		const plan = planVerifiedRun(contract);
		const parsed = parseRunContract(contract);
		const coordinator = new RunCoordinator(stateRoot);
		const approval = { approvedContractDigest: plan.contractDigest };
		await coordinator.start(
			parsed,
			{
				schemaVersion: "omk.verified-command.v1",
				kind: "start",
				runId: "pub",
				commandId: "start",
				expectedRevision: 0,
				expectedGeneration: 0,
				contractDigest: plan.contractDigest,
			},
			approval,
		);
		const before = coordinator.inspect("pub");
		if (!before.candidateDigest || !before.receiptDigest) throw new Error("fixture run not verified");
		const state = await coordinator.publish(
			{
				schemaVersion: "omk.verified-command.v1",
				kind: "publish",
				runId: "pub",
				commandId: "publish-1",
				expectedRevision: before.revision,
				expectedGeneration: before.generation,
				contractDigest: plan.contractDigest,
				candidateDigest: before.candidateDigest,
				parentOid: "0".repeat(40),
				receiptDigest: before.receiptDigest,
				policyDigest: publishPolicyDigest(parsed),
			},
			approval,
		);
		expect(state.publication).toBe("accepted");
		const events = authorityRecords(stateRoot).map((record) => record.event);
		const grant = events.find((event) => event.kind === "grant-reserved" && event.grant.commandId === "publish-1");
		expect(grant?.kind).toBe("grant-reserved");
		if (grant?.kind !== "grant-reserved") throw new Error("unreachable");
		expect(grant.grant.claims.every((claim) => claim.namespace === "git-ref")).toBe(true);
		const grantSequence = grant.grant.token.grantSequence;
		const started = events.find((event) => event.kind === "effect-started" && event.grantSequence === grantSequence);
		expect(started).toBeDefined();
		const witnessed = events.find(
			(event) => event.kind === "termination-observed" && event.grantSequence === grantSequence,
		);
		expect(witnessed).toBeDefined();
		expect(coordinator.inspectAuthority().status.blockingGrants).toHaveLength(0);
		expect(git(["rev-parse", OMK_ACCEPTED_REF])).toBe(state.publicationCandidateOid);
	});
});
