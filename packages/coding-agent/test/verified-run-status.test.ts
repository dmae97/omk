import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runVerifiedRunCli } from "../src/commands/verified-run-cli.ts";
import {
	AuthorityStore,
	authorityStorePath,
	deriveAuthorityStatus,
	deriveRunStatus,
	planVerifiedRun,
	RunCoordinator,
} from "../src/core/run-execution-api.ts";
import { canonicalJson } from "../src/core/run-journal.ts";
import { journalPath, readRunJournal } from "../src/core/verified-run/journal.ts";
import { publishPolicyDigest } from "../src/core/verified-run/run-publish.ts";
import * as supervisor from "../src/core/verified-run/supervisor-adapter.ts";
import { bridgeBlocksCompletion } from "../src/metacognition/index.ts";
import { dagFixture } from "./verified-run-dag-fixture.ts";

/**
 * WP06 lifecycle/recovery state visibility (docs/03, docs/12 WP06).
 *
 * Acceptance surface: `omk run status|events|authority` and the SDK
 * `status`/`events`/`inspectAuthority` channels project the same journal
 * truth — a derived view, never a parallel status string. Recovery and
 * unknown states (resuming, quarantined, termination_unverified,
 * descendant_escape, publish outbox pending/refused, bridge partial)
 * stay distinguishable from a clean terminal success.
 */

let root: string;
let workspace: string;
let stateRoot: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "run-status-"));
	workspace = join(root, "workspace");
	stateRoot = join(root, "state");
	mkdirSync(workspace);
	writeFileSync(join(workspace, "input.txt"), "hello");
});
afterEach(() => {
	vi.restoreAllMocks();
	rmSync(root, { recursive: true, force: true });
});

function git(args: readonly string[], cwd: string): void {
	const result = spawnSync("git", args, { cwd, encoding: "utf-8", timeout: 30000 });
	if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
}

function contractFor(runId: string, writer: readonly string[], stdout = "hello") {
	const contract = {
		schemaVersion: "omk.verified-run.v1" as const,
		profile: "linux-command-v1" as const,
		runId,
		goal: "status fixture",
		workspace: { root: workspace, baseDigest: "0".repeat(64) },
		writablePaths: ["result.txt"],
		writer,
		checks: [{ claimId: "answer", argv: ["/bin/cat", "result.txt"], stdout }],
		budget: { workMs: 30000, verifyMs: 15000, cleanupMs: 5000, maxOutputBytes: 4096, maxFiles: 100, maxBytes: 65536 },
		apply: "artifact-only" as const,
	};
	contract.workspace.baseDigest = planVerifiedRun(contract).baseDigest;
	return { contract, plan: planVerifiedRun(contract) };
}

async function startCommand(
	runId = "status-run",
	writer: readonly string[] = ["/bin/cp", "input.txt", "result.txt"],
	stdout = "hello",
) {
	const { contract, plan } = contractFor(runId, writer, stdout);
	const coordinator = new RunCoordinator(stateRoot);
	const approval = { approvedContractDigest: plan.contractDigest };
	const state = await coordinator.start(
		contract,
		{
			schemaVersion: "omk.verified-command.v1",
			kind: "start",
			runId,
			commandId: "start",
			expectedRevision: 0,
			expectedGeneration: 0,
			contractDigest: plan.contractDigest,
		},
		approval,
	);
	return { contract, plan, coordinator, approval, state };
}

/** Freeze a real run right after its candidate event — the resumable journal truth. */
async function frozenCandidate() {
	const fixture = await startCommand("resume-run");
	const runPath = join(stateRoot, "resume-run");
	const journal = readRunJournal(runPath);
	if (!journal) throw new Error("missing fixture journal");
	const end = journal.records.findIndex((record) => record.event.kind === "candidate");
	writeFileSync(
		journalPath(runPath),
		`${journal.records
			.slice(0, end + 1)
			.map(canonicalJson)
			.join("\n")}\n`,
	);
	return { ...fixture, runPath };
}

function publishCommand(fixture: Awaited<ReturnType<typeof startCommand>>, parentOid: string, commandId: string) {
	const state = fixture.coordinator.inspect(fixture.contract.runId);
	return {
		schemaVersion: "omk.verified-command.v1",
		kind: "publish",
		runId: fixture.contract.runId,
		commandId,
		expectedRevision: state.revision,
		expectedGeneration: state.generation,
		contractDigest: fixture.plan.contractDigest,
		candidateDigest: state.candidateDigest,
		parentOid,
		receiptDigest: state.receiptDigest,
		policyDigest: publishPolicyDigest(fixture.contract),
	};
}

function initGitWorkspace(): void {
	git(["init", "--initial-branch=main"], workspace);
	git(["config", "--local", "user.email", "fixture@localhost"], workspace);
	git(["config", "--local", "user.name", "fixture"], workspace);
	git(["add", "input.txt"], workspace);
	git(["commit", "-m", "base"], workspace);
}

/** A real, existing commit OID that is not the expected parent — `commit-tree` requires it to exist. */
function unrelatedOid(): string {
	writeFileSync(join(workspace, "other.txt"), "unrelated");
	git(["add", "other.txt"], workspace);
	git(["commit", "-m", "other"], workspace);
	const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: workspace, encoding: "utf-8" });
	if (result.status !== 0) throw new Error(`git rev-parse: ${result.stderr}`);
	return result.stdout.trim();
}

async function captureCli(args: readonly string[]) {
	const writes: string[] = [];
	const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
		writes.push(String(chunk));
		return true;
	});
	const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
	try {
		const result = await runVerifiedRunCli([...args]);
		return { result, stdout: writes.join(""), parsed: writes.length ? JSON.parse(writes.join("")) : null };
	} finally {
		stdout.mockRestore();
		stderr.mockRestore();
	}
}

describe("run status surface", () => {
	it("reports a verified run as accepted and clean, distinct from published", async () => {
		const { coordinator, contract } = await startCommand();
		const status = coordinator.status(contract.runId);
		expect(status).toMatchObject({
			lifecycle: "accepted",
			completion: "verification_passed",
			cleanSuccess: true,
			terminal: true,
			unresolved: [],
			settlement: "settled",
			pendingEffects: 0,
			cause: null,
		});
		// prompt settled ≠ verified: completion climbed the ladder, and
		// accepted ≠ published — the outbox is still untouched.
		expect(status.publication).toMatchObject({ state: "none", commandId: null, candidateOid: null });
		const events = coordinator.events(contract.runId);
		const kinds = events.map((record) => record.event.kind);
		expect(kinds).toContain("evaluated");
		expect(events.at(-1)?.seq).toBe(events.length);
		// SDK and journal replay agree byte-for-byte on the status view.
		const replayed = readRunJournal(join(stateRoot, contract.runId));
		expect(replayed && deriveRunStatus(replayed.state)).toEqual(status);
	});

	it("distinguishes prompt_settled from verified for a violated check", async () => {
		const { coordinator, contract } = await startCommand(
			"violated-run",
			["/bin/cp", "input.txt", "result.txt"],
			"expected-other",
		);
		const status = coordinator.status(contract.runId);
		expect(status).toMatchObject({
			lifecycle: "violated",
			completion: "prompt_settled",
			cleanSuccess: false,
			terminal: true,
			verification: "violated",
		});
		expect(status.unresolved).toContain("verification_violated");
	});

	it("marks a frozen candidate resumable and names the exact recovery command", async () => {
		const { coordinator, contract } = await frozenCandidate();
		const frozen = coordinator.inspect(contract.runId);
		const status = coordinator.status(contract.runId);
		// The candidate settled but verification never ran — not a success.
		expect(status).toMatchObject({
			lifecycle: "verifying",
			completion: "prompt_settled",
			cleanSuccess: false,
			terminal: false,
		});
		expect(status.unresolved).toContain("verification_pending");
		const resume = status.recoveryCommands.find((hint) => hint.command === "resume");
		expect(resume).toMatchObject({
			runId: contract.runId,
			revision: frozen.revision,
			generation: frozen.generation,
			advisory: true,
		});
		expect(resume?.scope.candidateDigest).toBe(frozen.candidateDigest);
		expect(coordinator.inspectRecovery(contract.runId).readiness).toBe("ready");
	});

	it("reports resuming while a recovered generation is in flight", async () => {
		const { coordinator, contract, plan, approval, runPath } = await frozenCandidate();
		const before = coordinator.inspect(contract.runId);
		const resumed = coordinator.resume(
			{
				schemaVersion: "omk.verified-command.v1",
				kind: "resume",
				runId: contract.runId,
				commandId: "resume-1",
				expectedRevision: before.revision,
				expectedGeneration: before.generation,
				contractDigest: plan.contractDigest,
				candidateDigest: before.candidateDigest,
			},
			approval,
		);
		// Truncate the journal right after `resumed` + the first dispatch of the
		// new generation — a real in-flight resume, replayed from disk truth.
		const finalState = await resumed;
		const journal = readRunJournal(runPath);
		if (!journal) throw new Error("missing journal");
		const dispatchIndex = journal.records.findIndex(
			(record) => record.generation === 2 && record.event.kind === "dispatch",
		);
		const bytes = readFileSync(journalPath(runPath));
		writeFileSync(
			journalPath(runPath),
			`${journal.records
				.slice(0, dispatchIndex + 1)
				.map(canonicalJson)
				.join("\n")}\n`,
		);
		const mid = coordinator.status(contract.runId);
		expect(mid).toMatchObject({
			lifecycle: "resuming",
			completion: "prompt_settled",
			cleanSuccess: false,
			terminal: false,
			generation: 2,
		});
		expect(mid.recovery).toMatchObject({ kind: "resumed", commandId: "resume-1", generation: 2 });
		expect(mid.unresolved).toContain("pending_effects");
		writeFileSync(journalPath(runPath), bytes);
		const restored = coordinator.status(contract.runId);
		expect(restored).toMatchObject({ lifecycle: "accepted", completion: "verification_passed" });
		expect(finalState.verification).toBe("verified");
	});

	it("keeps quarantined runs distinct from both success and clean failure", async () => {
		mkdirSync(join(root, "dag"));
		const f = dagFixture(join(root, "dag"));
		vi.spyOn(supervisor, "awaitBoundaryDrained").mockResolvedValue("populated");
		await f.coordinator.start(f.contract, f.command, f.approval);
		const status = f.coordinator.status("dag");
		expect(status).toMatchObject({
			lifecycle: "quarantined",
			completion: "none",
			cleanSuccess: false,
			cause: "descendant_escape",
			pendingEffects: 1,
			settlement: "quarantined",
		});
		expect(status.unresolved).toContain("pending_effects");
		// The journal itself is the truth: no `exited` witness was ever recorded.
		const events = f.coordinator.events("dag");
		expect(events.some((record) => record.event.kind === "exited")).toBe(false);
		expect(events.map((record) => record.event.kind)).toContain("failed");
	});

	it("keeps termination_unverified distinct from a witnessed cancel", async () => {
		mkdirSync(join(root, "dag"));
		const f = dagFixture(join(root, "dag"));
		vi.spyOn(supervisor, "awaitBoundaryDrained").mockResolvedValue("unknown");
		await f.coordinator.start(f.contract, f.command, f.approval);
		const status = f.coordinator.status("dag");
		expect(status).toMatchObject({
			lifecycle: "quarantined",
			cause: "termination_unverified",
			cleanSuccess: false,
			pendingEffects: 1,
		});
	});

	it("separates a witnessed cancellation from quarantine", async () => {
		const { contract, plan } = contractFor("cancel-run", ["/bin/sleep", "60"]);
		const coordinator = new RunCoordinator(stateRoot);
		const controller = new AbortController();
		const runPath = join(stateRoot, contract.runId);
		const started = coordinator.start(
			contract,
			{
				schemaVersion: "omk.verified-command.v1",
				kind: "start",
				runId: contract.runId,
				commandId: "start",
				expectedRevision: 0,
				expectedGeneration: 0,
				contractDigest: plan.contractDigest,
			},
			{ approvedContractDigest: plan.contractDigest, signal: controller.signal },
		);
		const deadline = performance.now() + 15000;
		while (performance.now() < deadline) {
			const journal = readRunJournal(runPath);
			if (journal && journal.state.activeExecutionIds.length > 0) break;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		controller.abort();
		const state = await started;
		expect(state).toMatchObject({ execution: "failed", failure: "cancelled", settlement: "settled" });
		const status = coordinator.status(contract.runId);
		// Cancellation was witnessed (exited appended) — terminated, not
		// quarantined, and never a success.
		expect(status).toMatchObject({
			lifecycle: "cancelled",
			cause: "cancelled",
			cleanSuccess: false,
			terminal: true,
			settlement: "settled",
			pendingEffects: 0,
		});
		const exited = coordinator.events(contract.runId).find((record) => record.event.kind === "exited");
		expect(exited?.event).toMatchObject({ kind: "exited", failure: "cancelled" });
	});
});

describe("publication status surface", () => {
	beforeEach(initGitWorkspace);

	it("climbs accepted -> published and reports the outbox result", async () => {
		const fixture = await startCommand();
		const before = fixture.coordinator.status(fixture.contract.runId);
		expect(before.lifecycle).toBe("accepted");
		const zero = "0".repeat(40);
		const published = await fixture.coordinator.publish(publishCommand(fixture, zero, "publish-1"), fixture.approval);
		expect(published.publication).toBe("accepted");
		const status = fixture.coordinator.status(fixture.contract.runId);
		expect(status).toMatchObject({
			lifecycle: "published",
			completion: "published",
			cleanSuccess: true,
		});
		expect(status.publication).toMatchObject({
			state: "accepted",
			ref: "refs/omk/accepted",
			candidateOid: expect.any(String),
		});
		const events = fixture.coordinator.events(fixture.contract.runId);
		expect(events.map((record) => record.event.kind)).toEqual(
			expect.arrayContaining(["publish_intent", "published"]),
		);
	});

	it("keeps a refused publication visible instead of reporting success", async () => {
		const fixture = await startCommand();
		const refused = await fixture.coordinator.publish(
			publishCommand(fixture, unrelatedOid(), "publish-1"),
			fixture.approval,
		);
		expect(refused.publication).toBe("failed");
		const status = fixture.coordinator.status(fixture.contract.runId);
		// The run is still verified/accepted — but the refused publish is an
		// open concern, not a clean success.
		expect(status).toMatchObject({
			lifecycle: "accepted",
			completion: "verification_passed",
			cleanSuccess: false,
		});
		expect(status.publication).toMatchObject({ state: "failed", failure: "stale-parent" });
		expect(status.unresolved).toContain("publication_refused");
	});

	it("surfaces a half-published outbox intent and its recovery", async () => {
		const fixture = await startCommand();
		const zero = "0".repeat(40);
		await expect(
			fixture.coordinator.publish(publishCommand(fixture, zero, "publish-1"), fixture.approval, {
				afterCas: () => {
					throw new Error("injected crash after CAS");
				},
			}),
		).rejects.toThrow("injected crash");
		const mid = fixture.coordinator.status(fixture.contract.runId);
		expect(mid).toMatchObject({ lifecycle: "accepted", cleanSuccess: false });
		expect(mid.publication).toMatchObject({ state: "intent", commandId: "publish-1" });
		expect(mid.unresolved).toContain("publication_intent");
		expect(mid.recoveryCommands.map((hint) => hint.command)).toContain("publish");
		// Re-driving the same command finishes the outbox — replay, never a second CAS.
		const done = await fixture.coordinator.publish(publishCommand(fixture, zero, "publish-1"), fixture.approval);
		expect(done.publication).toBe("accepted");
		expect(fixture.coordinator.status(fixture.contract.runId)).toMatchObject({
			lifecycle: "published",
			cleanSuccess: true,
		});
	});
});

describe("authority status surface", () => {
	const claims = [
		{
			namespace: "filesystem",
			instanceId: "repo",
			canonicalKey: "src/a",
			access: "write",
			generation: "0",
		},
	];

	function openStore() {
		const store = AuthorityStore.open(authorityStorePath(stateRoot), {
			capacity: 4,
			probe: () => "unknown",
			clock: () => 0,
		});
		store.reconcile();
		return store;
	}

	it("reads a missing store as an empty projection", () => {
		const view = new RunCoordinator(stateRoot).inspectAuthority();
		expect(view.path).toBe(authorityStorePath(stateRoot));
		expect(view.status).toMatchObject({
			epoch: null,
			pendingReconcile: false,
			blockingGrants: [],
			settledGrantCount: 0,
			tombstoneCount: 0,
		});
	});

	it("shows which grant blocks what, with cancel requested vs terminated separated", () => {
		const store = openStore();
		const incarnation = store.register("s");
		const acquired = store.acquire({
			sessionId: "s",
			incarnation,
			commandId: "cmd-1",
			intentDigest: "a".repeat(64),
			claims,
			now: 0,
			ttl: 1000,
		});
		if (acquired.status !== "granted") throw new Error("fixture grant not granted");
		expect(store.dispatchIntent(acquired.token, "dispatch-1")).toBe(true);
		expect(store.effectStarted(acquired.token, claims)).toBe(true);
		expect(store.cancel(acquired.token)).toBe(true);
		store.release();

		const view = new RunCoordinator(stateRoot).inspectAuthority();
		expect(view.records.map((record) => record.event.kind)).toEqual(
			expect.arrayContaining(["grant-reserved", "dispatch-intent", "effect-started", "cancel-requested"]),
		);
		const grant = view.status.blockingGrants.find((entry) => entry.commandId === "cmd-1");
		expect(grant).toMatchObject({
			state: "quarantined",
			effectLive: true,
			cause: "cancel_requested",
			terminationWitnessed: false,
			dispatchId: "dispatch-1",
		});
		// The cancellation released nothing: the claim still blocks.
		expect(grant?.claims).toEqual([
			expect.objectContaining({ canonicalKey: "src/a", access: "write", namespace: "filesystem" }),
		]);
	});

	it("marks restart-quarantined grants and settles only on witnessed termination", () => {
		let store = openStore();
		const incarnation = store.register("s");
		const acquired = store.acquire({
			sessionId: "s",
			incarnation,
			commandId: "cmd-2",
			intentDigest: "b".repeat(64),
			claims,
			now: 0,
			ttl: 1000,
		});
		if (acquired.status !== "granted") throw new Error("fixture grant not granted");
		expect(store.dispatchIntent(acquired.token, "dispatch-2")).toBe(true);
		expect(store.effectStarted(acquired.token, claims)).toBe(true);
		store.release();

		// Restart without reconcile: the epoch advance quarantines the live effect.
		store = AuthorityStore.open(authorityStorePath(stateRoot), { capacity: 4, probe: () => "unknown" });
		const pending = new RunCoordinator(stateRoot).inspectAuthority();
		expect(pending.status.pendingReconcile).toBe(true);
		const grant = pending.status.blockingGrants.find((entry) => entry.commandId === "cmd-2");
		expect(grant).toMatchObject({
			state: "quarantined",
			cause: "restart_unreconciled",
			terminationWitnessed: false,
		});
		// A quarantined grant keeps blocking the same scope.
		expect(() =>
			store.acquire({
				sessionId: "s",
				incarnation: store.register("s"),
				commandId: "cmd-3",
				intentDigest: "c".repeat(64),
				claims,
				now: 1,
				ttl: 10,
			}),
		).toThrow(/reconcile_pending/);
		store.reconcile(() => "unknown");
		const settled = new RunCoordinator(stateRoot).inspectAuthority();
		expect(settled.status.pendingReconcile).toBe(false);
		expect(settled.status.blockingGrants.find((entry) => entry.commandId === "cmd-2")?.state).toBe("quarantined");
		expect(store.confirmTerminated(acquired.token)).toBe(true);
		const done = new RunCoordinator(stateRoot).inspectAuthority();
		expect(done.status.blockingGrants).toEqual([]);
		expect(done.status.settledGrantCount).toBe(1);
		store.release();
	});

	it("derives causes only from records, never inventing them", () => {
		const store = openStore();
		const incarnation = store.register("s");
		const acquired = store.acquire({
			sessionId: "s",
			incarnation,
			commandId: "cmd-4",
			intentDigest: "d".repeat(64),
			claims,
			now: 0,
			ttl: 5,
		});
		if (acquired.status !== "granted") throw new Error("fixture grant not granted");
		expect(store.dispatchIntent(acquired.token, "dispatch-4")).toBe(true);
		expect(store.effectStarted(acquired.token, claims)).toBe(true);
		store.expire(10); // live effect past deadline quarantines, it never frees
		store.release();
		const inspection = AuthorityStore.inspectJournal(authorityStorePath(stateRoot));
		const withEvents = deriveAuthorityStatus(
			inspection.state,
			inspection.records.map((record) => record.event),
		);
		const grant = withEvents.blockingGrants.find((entry) => entry.commandId === "cmd-4");
		expect(grant).toMatchObject({ state: "quarantined", cause: "authorization_expired" });
		// The same projection without records reports the honest unknown, not a
		// guessed cause: quarantined is still quarantined, the reason is not.
		const withoutEvents = deriveAuthorityStatus(inspection.state);
		const bare = withoutEvents.blockingGrants.find((entry) => entry.commandId === "cmd-4");
		expect(bare).toMatchObject({ state: "quarantined", cause: "unwitnessed" });
	});
});

describe("CLI status surface", () => {
	it("omk run status/events/authority report the same journal truth", async () => {
		const { coordinator, contract } = await startCommand();
		const status = await captureCli(["run", "status", contract.runId, "--state-dir", stateRoot]);
		expect(status.result).toEqual({ handled: true, exitCode: 0 });
		expect(status.parsed).toMatchObject({ lifecycle: "accepted", completion: "verification_passed" });
		// CLI view and SDK view are the same object — single source of truth.
		expect(status.parsed).toEqual(JSON.parse(JSON.stringify(coordinator.status(contract.runId))));

		const events = await captureCli(["run", "events", contract.runId, "--state-dir", stateRoot]);
		expect(events.result).toEqual({ handled: true, exitCode: 0 });
		expect(events.parsed.map((record: { seq: number }) => record.seq)).toEqual(
			coordinator.events(contract.runId).map((record) => record.seq),
		);

		const authority = await captureCli(["run", "authority", "--state-dir", stateRoot]);
		expect(authority.result).toEqual({ handled: true, exitCode: 0 });
		expect(authority.parsed).toMatchObject({
			path: authorityStorePath(stateRoot),
			status: { pendingReconcile: false, blockingGrants: [] },
		});
	});

	it("omk run status exits nonzero for quarantined and refused states", async () => {
		initGitWorkspace();
		const fixture = await startCommand();
		await fixture.coordinator.publish(publishCommand(fixture, unrelatedOid(), "publish-1"), fixture.approval);
		const refused = await captureCli(["run", "status", fixture.contract.runId, "--state-dir", stateRoot]);
		expect(refused.result.exitCode).toBe(1);
		expect(refused.parsed.unresolved).toContain("publication_refused");

		mkdirSync(join(root, "dag"));
		const f = dagFixture(join(root, "dag"));
		vi.spyOn(supervisor, "awaitBoundaryDrained").mockResolvedValue("populated");
		await f.coordinator.start(f.contract, f.command, f.approval);
		const quarantined = await captureCli(["run", "status", "dag", "--state-dir", f.stateRoot]);
		expect(quarantined.result.exitCode).toBe(1);
		expect(quarantined.parsed).toMatchObject({ lifecycle: "quarantined", cause: "descendant_escape" });
	});
});

describe("bridge status surface", () => {
	it("exposes mapped|partial|rejected through the SDK gate", () => {
		const value = { state: undefined as never, claims: [], observations: [], sources: [] };
		// A clean mapped bridge is the only non-blocking result.
		expect(bridgeBlocksCompletion({ status: "mapped", value })).toBe(false);
		expect(bridgeBlocksCompletion({ status: "rejected", reason: "binding-mismatch" })).toBe(true);
		expect(
			bridgeBlocksCompletion({
				status: "partial",
				value,
				loss: {
					lostFields: ["obs-1.sequence"],
					unmappedClaims: [],
					unknownBindings: [],
					sourceFamilyConflicts: [],
					rejectedObservations: [],
				},
				touchesRequiredClaims: ["claim-1"],
			}),
		).toBe(true);
		// Advisory-only loss does not block — partial is visible, not fatal.
		expect(
			bridgeBlocksCompletion({
				status: "partial",
				value,
				loss: {
					lostFields: [],
					unmappedClaims: [],
					unknownBindings: ["obs-9"],
					sourceFamilyConflicts: [],
					rejectedObservations: [],
				},
				touchesRequiredClaims: [],
			}),
		).toBe(false);
	});
});
