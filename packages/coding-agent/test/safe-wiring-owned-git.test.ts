import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseRunContract, parseRunPublishCommand } from "omk-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planVerifiedRun, RunCoordinator } from "../src/core/run-execution-api.ts";
import { openRunAuthorityStore, runAuthorityProbe } from "../src/core/verified-run/authority-runtime.ts";
import { AuthorityStore, authorityStorePath } from "../src/core/verified-run/authority-store.ts";
import { executeSandbox } from "../src/core/verified-run/broker.ts";
import { readRunJournal, VerifiedRunJournal } from "../src/core/verified-run/journal.ts";
import type { NamespaceIdentity } from "../src/core/verified-run/namespace-identity.ts";
import { readRunClock } from "../src/core/verified-run/recovery-clock.ts";
import { OMK_ACCEPTED_REF, publishPolicyDigest } from "../src/core/verified-run/run-publish.ts";
import { digestObject, VerifiedRunError } from "../src/core/verified-run/storage.ts";
import * as supervisor from "../src/core/verified-run/supervisor-adapter.ts";

let root: string;
let workspace: string;
let stateRoot: string;
function git(...args: string[]) {
	const result = spawnSync("git", ["-C", workspace, ...args], { encoding: "utf8" });
	if (result.status !== 0) throw new Error(result.stderr);
	return result.stdout.trim();
}
beforeEach(() => {
	// Process-boundary tests use a stable trusted clock; raw-wall rollback is tested separately.
	const wall = Date.now();
	const began = process.hrtime.bigint();
	const open = AuthorityStore.open;
	vi.spyOn(AuthorityStore, "open").mockImplementation((path, options) =>
		open(path, {
			...options,
			clock: options.clock ?? (() => wall + Number((process.hrtime.bigint() - began) / 1_000_000n)),
		}),
	);
	root = mkdtempSync(join(tmpdir(), "owned-git-"));
	workspace = join(root, "repo");
	stateRoot = join(root, "state");
	mkdirSync(workspace);
	writeFileSync(join(workspace, "input"), "hello");
	git("init", "-q");
});
afterEach(() => {
	vi.restoreAllMocks();
	rmSync(root, { recursive: true, force: true });
});
async function fixture() {
	const raw = {
		schemaVersion: "omk.verified-run.v1",
		profile: "linux-command-v1",
		runId: "owned",
		goal: "copy",
		workspace: { root: workspace, baseDigest: "0".repeat(64) },
		writablePaths: ["result"],
		writer: ["/bin/cp", "input", "result"],
		checks: [{ claimId: "copy", argv: ["/bin/cat", "result"], stdout: "hello" }],
		budget: { workMs: 5000, verifyMs: 15000, cleanupMs: 15000, maxOutputBytes: 4096, maxFiles: 100, maxBytes: 65536 },
		apply: "artifact-only",
	};
	raw.workspace.baseDigest = planVerifiedRun(raw).baseDigest;
	const contract = parseRunContract(raw);
	const digest = digestObject(contract);
	const coordinator = new RunCoordinator(stateRoot);
	const approval = { approvedContractDigest: digest };
	await coordinator.start(
		contract,
		{
			schemaVersion: "omk.verified-command.v1",
			kind: "start",
			runId: "owned",
			commandId: "start",
			expectedRevision: 0,
			expectedGeneration: 0,
			contractDigest: digest,
		},
		approval,
	);
	const state = coordinator.inspect("owned");
	const command = parseRunPublishCommand({
		schemaVersion: "omk.verified-command.v1",
		kind: "publish",
		runId: "owned",
		commandId: "publish",
		expectedRevision: state.revision,
		expectedGeneration: state.generation,
		contractDigest: digest,
		candidateDigest: state.candidateDigest,
		receiptDigest: state.receiptDigest,
		parentOid: "0".repeat(40),
		policyDigest: publishPolicyDigest(contract),
	});
	return { coordinator, command, approval };
}
function publicationGrant() {
	return [...AuthorityStore.inspect(authorityStorePath(stateRoot)).grants.values()].find(
		(grant) => grant.commandId === "publish",
	);
}

describe("owned Git publication public path", () => {
	it("recovers a SIGKILLed publisher after observing the actual namespace drain", async () => {
		const f = await fixture();
		const marker = join(root, "cas-observed");
		const coordinatorModule = new URL("../src/core/verified-run/coordinator.ts", import.meta.url).href;
		const authorityModule = new URL("../src/core/verified-run/authority-store.ts", import.meta.url).href;
		const script = `
			import { writeFileSync } from 'node:fs';
			import { RunCoordinator } from ${JSON.stringify(coordinatorModule)};
			import { AuthorityStore } from ${JSON.stringify(authorityModule)};
			const base=Date.now(), start=process.hrtime.bigint(), open=AuthorityStore.open;
			AuthorityStore.open=(path, options)=>open(path,{...options,clock:()=>base+Number((process.hrtime.bigint()-start)/1_000_000n)});
			const command=JSON.parse(process.argv[2]);
			await new RunCoordinator(process.argv[1]).publish(command,{approvedContractDigest:command.contractDigest},{afterCas:()=>{
				writeFileSync(process.argv[3],'ready');
				Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
			}});
		`;
		const child = spawn(
			process.execPath,
			[
				"--experimental-strip-types",
				"--input-type=module",
				"-e",
				script,
				stateRoot,
				JSON.stringify(f.command),
				marker,
			],
			{ env: { PATH: process.env.PATH, HOME: join(root, "home") }, stdio: ["ignore", "ignore", "pipe"] },
		);
		const closed = once(child, "close");
		try {
			const until = process.hrtime.bigint() + 20_000_000_000n;
			while (
				!existsSync(marker) &&
				child.exitCode === null &&
				child.signalCode === null &&
				process.hrtime.bigint() < until
			)
				await delay(10);
			expect(existsSync(marker)).toBe(true);
			const grant = publicationGrant();
			if (!grant?.identity) throw new Error("missing persisted namespace");
			expect(supervisor.namespaceMemberPids(grant.identity).length).toBeGreaterThan(0);
			const counter = AuthorityStore.inspect(authorityStorePath(stateRoot)).grantCounter;
			const oid = git("rev-parse", OMK_ACCEPTED_REF);
			child.kill("SIGKILL");
			await closed;
			expect(await supervisor.awaitBoundaryDrained(grant.identity, 4000)).toBe("drained");
			expect((await f.coordinator.publish(f.command, f.approval)).publication).toBe("accepted");
			expect(publicationGrant()).toMatchObject({ state: "terminated", effectLive: false });
			expect(AuthorityStore.inspect(authorityStorePath(stateRoot)).grantCounter).toBe(counter);
			expect(git("rev-parse", OMK_ACCEPTED_REF)).toBe(oid);
		} finally {
			if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
			await closed;
		}
	}, 30000);

	it("enforces readonly worktree and writable Git metadata in the real namespace", async () => {
		const result = await executeSandbox({
			workspace,
			writable: false,
			gitPublication: true,
			argv: [
				"/bin/sh",
				"-c",
				"if printf forbidden > input 2>/dev/null; then exit 91; fi; printf allowed > .git/mount-probe",
			],
			timeoutMs: 5000,
			cleanupMs: 15000,
			maxOutputBytes: 4096,
			onReady: () => {},
		});
		expect(result.exitCode).toBe(0);
		expect(result.failure).toBeNull();
		expect(git("status", "--porcelain")).toBe("?? input");
	});

	it("rejects a writable worktree combined with Git publication capability", async () => {
		await expect(
			executeSandbox({
				workspace,
				writable: true,
				gitPublication: true,
				argv: ["/bin/true"],
				timeoutMs: 1000,
				cleanupMs: 15000,
				maxOutputBytes: 4096,
				onReady: () => {},
			}),
		).rejects.toThrow(/unsupported_boundary/);
	});

	it("reports committed publication when cancellation arrives after CAS", async () => {
		const f = await fixture();
		const controller = new AbortController();
		const state = await f.coordinator.publish(
			f.command,
			{ ...f.approval, signal: controller.signal },
			{ afterCas: () => controller.abort() },
		);
		expect(state.publication).toBe("accepted");
		expect(publicationGrant()).toMatchObject({ state: "terminated", effectLive: false });
		expect(f.coordinator.status("owned").cleanSuccess).toBe(true);
	});

	it("awaits asynchronous post-CAS failures without misreporting cancellation", async () => {
		const f = await fixture();
		await expect(
			f.coordinator.publish(f.command, f.approval, {
				afterCas: async () => {
					await Promise.resolve();
					throw new VerifiedRunError("cancelled");
				},
			}),
		).rejects.toThrow(/cancelled/);
		expect(publicationGrant()).toMatchObject({ state: "terminated", effectLive: false });
		expect(readRunJournal(join(stateRoot, "owned"))?.state.publication).toBe("intent");
		expect((await f.coordinator.publish(f.command, f.approval)).publication).toBe("accepted");
	});

	it("keeps publication truth separate from an unsettled Git owner in status", async () => {
		const f = await fixture();
		await f.coordinator.publish(f.command, f.approval);
		const store = openRunAuthorityStore(join(stateRoot, "owned"));
		try {
			const incarnation = store.register("owned");
			const pending = store.acquire({
				sessionId: "owned",
				incarnation,
				commandId: "pending-git",
				intentDigest: "a".repeat(64),
				claims: [
					{
						namespace: "git-ref",
						instanceId: "verified-run",
						canonicalKey: "repo",
						access: "write",
						generation: "1",
					},
				],
				now: Date.now(),
				ttl: 60_000,
			});
			if (pending.status !== "granted") throw new Error("fixture admission failed");
			store.dispatchIntent(pending.token, "pending-git");
		} finally {
			store.release();
		}
		const status = f.coordinator.status("owned");
		expect(status.publication.state).toBe("accepted");
		expect(status.cleanSuccess).toBe(false);
		expect(status.terminal).toBe(false);
		expect(status.pendingEffects).toBe(1);
		expect(status.unresolved).toContain("pending_effects");
	});

	it("keeps a live namespace blocking another owner after the writer lease is released", async () => {
		const f = await fixture();
		let liveObserved = false;
		let conflictBlocked = false;
		const authorize = AuthorityStore.prototype.effectAuthorized;
		vi.spyOn(AuthorityStore.prototype, "effectAuthorized").mockImplementationOnce(function (
			this: AuthorityStore,
			token,
			claims,
		) {
			const grant = this.state.grants.get(token.grantSequence);
			liveObserved = !!grant?.identity && supervisor.namespaceMemberPids(grant.identity).length > 0;
			this.release();
			const next = openRunAuthorityStore(join(stateRoot, "owned"));
			try {
				const incarnation = next.register("contender");
				conflictBlocked =
					next.acquire({
						sessionId: "contender",
						incarnation,
						commandId: "contender",
						intentDigest: "a".repeat(64),
						claims,
						now: Date.now(),
						ttl: 60_000,
					}).status === "blocked";
			} finally {
				next.release();
			}
			return authorize.call(this, token, claims);
		});
		await expect(f.coordinator.publish(f.command, f.approval)).rejects.toThrow();
		expect(liveObserved).toBe(true);
		expect(conflictBlocked).toBe(true);
		const recovered = openRunAuthorityStore(join(stateRoot, "owned"));
		try {
			expect([...recovered.state.grants.values()].find((grant) => grant.commandId === "publish")).toMatchObject({
				state: "terminated",
				effectLive: false,
			});
		} finally {
			recovered.release();
		}
		expect(spawnSync("git", ["-C", workspace, "rev-parse", "--verify", "--quiet", OMK_ACCEPTED_REF]).status).toBe(1);
	});

	it("does not accept a reused PID or a different boot as termination evidence", async () => {
		const f = await fixture();
		await f.coordinator.publish(f.command, f.approval);
		const grant = publicationGrant();
		if (!grant) throw new Error("missing fixture grant");
		const identity = {
			pid: process.pid,
			startTicks: "0",
			namespace: readlinkSync(`/proc/${process.pid}/ns/pid`),
			bootId: readRunClock().bootId,
		};
		expect(runAuthorityProbe({ ...grant, state: "quarantined", effectLive: true, identity })).toBe("unknown");
		expect(
			runAuthorityProbe({
				...grant,
				state: "quarantined",
				effectLive: true,
				identity: { ...identity, bootId: "0".repeat(36) },
			}),
		).toBe("unknown");
	});

	it("cancels a sealed worker before the CAS gate and observes termination", async () => {
		const f = await fixture();
		const controller = new AbortController();
		const append = VerifiedRunJournal.prototype.append;
		vi.spyOn(VerifiedRunJournal.prototype, "append").mockImplementation(function (this: VerifiedRunJournal, event) {
			const state = append.call(this, event);
			if (event.kind === "publish_intent") controller.abort();
			return state;
		});
		await expect(f.coordinator.publish(f.command, { ...f.approval, signal: controller.signal })).rejects.toThrow(
			/cancelled/,
		);
		expect(publicationGrant()).toMatchObject({ state: "terminated", effectLive: false });
		expect(spawnSync("git", ["-C", workspace, "rev-parse", "--verify", "--quiet", OMK_ACCEPTED_REF]).status).toBe(1);
	});

	it("records a real namespace identity and observes its drain before settlement", async () => {
		const f = await fixture();
		const state = await f.coordinator.publish(f.command, f.approval);
		expect(state.publication).toBe("accepted");
		const grant = publicationGrant();
		expect(grant?.identity).not.toBeNull();
		if (!grant?.identity) throw new Error("missing Git namespace witness");
		expect(grant).toMatchObject({ state: "terminated", effectLive: false });
		expect(git("show", `${OMK_ACCEPTED_REF}:result`)).toBe("hello");
		expect(readdirSync(workspace).sort()).toEqual([".git", "input"]);
		expect(readdirSync(join(workspace, ".git")).filter((name) => name.startsWith("omk-publish-"))).toEqual([]);
	});
	it("keeps a post-CAS child owned while recording fails, then drains and reconciles without another CAS", async () => {
		const f = await fixture();
		let identity: NamespaceIdentity | null = null;
		let aliveAtCas = false;
		await expect(
			f.coordinator.publish(f.command, f.approval, {
				afterCas: () => {
					identity = publicationGrant()?.identity ?? null;
					aliveAtCas = identity !== null && supervisor.namespaceMemberPids(identity).length > 0;
					throw new Error("after-CAS fault");
				},
			}),
		).rejects.toThrow(/after-CAS fault/);
		expect(aliveAtCas).toBe(true);
		expect(publicationGrant()).toMatchObject({ state: "terminated", effectLive: false });
		const count = AuthorityStore.inspect(authorityStorePath(stateRoot)).grantCounter;
		const oid = git("rev-parse", OMK_ACCEPTED_REF);
		expect(readRunJournal(join(stateRoot, "owned"))?.state.publication).toBe("intent");
		expect((await f.coordinator.publish(f.command, f.approval)).publication).toBe("accepted");
		expect(git("rev-parse", OMK_ACCEPTED_REF)).toBe(oid);
		expect(AuthorityStore.inspect(authorityStorePath(stateRoot)).grantCounter).toBe(count);
	});
	it("does not fall back to unsupervised Git when the boundary is unavailable", async () => {
		const f = await fixture();
		const before = readdirSync(join(workspace, ".git", "objects"), { recursive: true }).sort();
		vi.spyOn(supervisor, "loadSupervisorBackend").mockImplementation(() => {
			throw new VerifiedRunError("unsupported_boundary");
		});
		await expect(f.coordinator.publish(f.command, f.approval)).rejects.toThrow(/unsupported_boundary/);
		expect(readdirSync(join(workspace, ".git", "objects"), { recursive: true }).sort()).toEqual(before);
		expect(publicationGrant()).toBeUndefined();
	});
});
