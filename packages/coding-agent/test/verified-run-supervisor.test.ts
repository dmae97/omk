import { mkdirSync, mkdtempSync, rmSync, watch } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planVerifiedRun } from "../src/core/run-execution-api.ts";
import { executeSandbox } from "../src/core/verified-run/broker.ts";
import { readRunJournal } from "../src/core/verified-run/journal.ts";
import type { NamespaceIdentity } from "../src/core/verified-run/namespace-identity.ts";
import * as identityModule from "../src/core/verified-run/namespace-identity.ts";
import * as supervisor from "../src/core/verified-run/supervisor-adapter.ts";
import { dagFixture } from "./verified-run-dag-fixture.ts";
import { waitForNamespaceGone } from "./verified-run-namespace-wait.ts";

/**
 * WP02 cancellation proof, measured against the real boundary:
 *
 * 1. claims (`activeExecutionIds`) stay held between a cancellation request
 *    and the termination witness; only the post-drain `exited` event releases
 *    them, and successors never start off a cancelled effect;
 * 2. a non-cooperative worker and its detached (`setsid`) descendants are
 *    terminated by the SIGKILL-to-namespace escalation;
 * 3. direct-child-only termination with a live descendant is detected — the
 *    witness enumerates namespace membership, so a reaped or fabricated init
 *    cannot mask survivors;
 * 4. when termination cannot be proven the boundary fails closed
 *    (`descendant_escape` / `termination_unverified` / `unsupported_boundary`)
 *    instead of releasing the claim.
 */

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "supervisor-"));
});
afterEach(() => {
	vi.restoreAllMocks();
	rmSync(root, { recursive: true, force: true });
});

const request = () => ({
	workspace: root,
	writable: true,
	timeoutMs: 8000,
	cleanupMs: 3000,
	maxOutputBytes: 4096,
});

function deferred<T>() {
	let settle: (value: T) => void = () => {
		throw new Error("not initialized");
	};
	const promise = new Promise<T>((resolve) => {
		settle = resolve;
	});
	return { promise, resolve: (value: T) => settle(value) };
}

interface DrainObservation {
	readonly namespace: string;
	readonly held: readonly string[];
	readonly recordsAtCompletion: number;
	readonly result: string;
}

/** Wrap the termination witness; each call records the claims still held when the drain began and where the journal stood when it completed. */
function observeDrains(runPath: string): DrainObservation[] {
	const original = supervisor.awaitBoundaryDrained;
	const observations: DrainObservation[] = [];
	vi.spyOn(supervisor, "awaitBoundaryDrained").mockImplementation(async (identity, budgetMs) => {
		const held = readRunJournal(runPath)?.state.activeExecutionIds ?? [];
		const result = await original(identity, budgetMs);
		observations.push({
			namespace: identity.namespace,
			held,
			recordsAtCompletion: readRunJournal(runPath)?.records.length ?? -1,
			result,
		});
		return result;
	});
	return observations;
}

function records(runPath: string) {
	const journal = readRunJournal(runPath);
	if (!journal) throw new Error("missing journal");
	return journal.records;
}

/** The gate releases the argv asynchronously; poll until the spawned members are visible in the namespace. */
async function waitForMembers(identity: Pick<NamespaceIdentity, "namespace">, minimum: number): Promise<number[]> {
	const deadline = performance.now() + 5000;
	let members = supervisor.namespaceMemberPids(identity);
	while (members.length < minimum && performance.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 10));
		members = supervisor.namespaceMemberPids(identity);
	}
	return members;
}

describe("owned process supervisor cancellation proof", () => {
	it("holds claims across a requested cancellation and releases them only after observed termination", async () => {
		const f = dagFixture(root);
		mkdirSync(f.stateRoot);
		f.contract.writer.tasks[0].attempts[0] = ["/bin/sh", "-c", "cp input left; setsid sleep 60 & sleep 60"];
		const contractDigest = planVerifiedRun(f.contract).contractDigest;
		const drains = observeDrains(f.runPath);
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 10000);
		let observed = false;
		const watcher = watch(f.stateRoot, { recursive: true }, (_event, path) => {
			if (path?.toString().endsWith("left-1-g1/left")) {
				observed = true;
				controller.abort();
			}
		});
		try {
			const state = await f.coordinator.start(
				f.contract,
				{ ...f.command, contractDigest },
				{ approvedContractDigest: contractDigest, signal: controller.signal },
			);
			expect(observed).toBe(true);
			expect(state).toMatchObject({
				execution: "failed",
				failure: "cancelled",
				activeExecutionIds: [],
				settlement: "settled",
			});
			const journal = records(f.runPath);
			const dispatches = journal.filter((record) => record.event.kind === "dispatch");
			// The cancelled task was the only execution ever dispatched: successors
			// of a cancelled effect never start.
			expect(dispatches).toHaveLength(1);
			const dispatch = dispatches[0];
			if (dispatch.event.kind !== "dispatch") throw new Error("unreachable");
			const executionId = dispatch.event.executionId;
			const exited = journal.find(
				(record) => record.event.kind === "exited" && record.event.executionId === executionId,
			);
			expect(exited?.event).toMatchObject({ kind: "exited", failure: "cancelled" });
			// The termination witness ran exactly once, observed the namespace
			// empty, and at that moment the claim was still held — release happens
			// strictly after the witness, via the `exited` record.
			expect(drains).toHaveLength(1);
			expect(drains[0].result).toBe("drained");
			expect(drains[0].held).toContain(dispatch.event.executionId);
			if (!exited) throw new Error("missing exited record");
			expect(drains[0].recordsAtCompletion).toBeLessThan(exited.seq);
			// No successor task ever started.
			expect(journal.some((record) => record.event.kind === "task_started" && record.event.taskId !== "left")).toBe(
				false,
			);
		} finally {
			clearTimeout(timer);
			watcher.close();
			controller.abort();
		}
	});

	it("dispatches every successor only after the previous namespace drained", async () => {
		const f = dagFixture(root);
		const drains = observeDrains(f.runPath);
		const state = await f.coordinator.start(f.contract, f.command, f.approval);
		expect(state).toMatchObject({
			execution: "succeeded",
			application: "candidate_ready",
			settlement: "settled",
			activeExecutionIds: [],
		});
		const journal = records(f.runPath);
		const exits = journal.filter((record) => record.event.kind === "exited");
		expect(exits.length).toBeGreaterThanOrEqual(4); // three tasks + one check
		// Namespace inodes are recycled between executions, so drains correlate
		// with exits by call order — every drained boundary released exactly one claim.
		expect(drains).toHaveLength(exits.length);
		for (const [index, record] of exits.entries()) {
			if (record.event.kind !== "exited") throw new Error("unreachable");
			const drain = drains[index];
			expect(drain?.result).toBe("drained");
			// The claim was held while the drain ran, and `exited` — the only
			// event that releases it — was appended strictly after the witness.
			expect(drain?.held).toContain(record.event.executionId);
			expect(drain?.recordsAtCompletion).toBeLessThan(record.seq);
		}
	});

	it("SIGKILL escalation terminates a non-cooperative worker and its detached descendant", async () => {
		const ready = deferred<NamespaceIdentity>();
		const controller = new AbortController();
		const execution = executeSandbox({
			...request(),
			argv: ["/bin/sh", "-c", 'trap "" TERM; setsid sleep 60 & sleep 60'],
			signal: controller.signal,
			onReady: (identity) => ready.resolve(identity),
		});
		const identity = await Promise.race([
			ready.promise,
			execution.then(() => {
				throw new Error("process exited before ready");
			}),
		]);
		expect((await waitForMembers(identity, 2)).length).toBeGreaterThanOrEqual(2);
		controller.abort();
		const outcome = await execution;
		expect(outcome.failure).toBe("cancelled");
		expect(outcome.exitCode).toBeNull();
		// Init death terminates every remaining task in the namespace: the
		// member set is empty, and init teardown completes on the kernel side.
		expect(await supervisor.awaitBoundaryDrained(identity, 5000)).toBe("drained");
		expect(await waitForNamespaceGone(identity)).toBe("gone");
	});

	it("detects a live descendant independently of the recorded direct child", async () => {
		const ready = deferred<NamespaceIdentity>();
		const controller = new AbortController();
		const execution = executeSandbox({
			...request(),
			argv: ["/bin/sh", "-c", "setsid sleep 60 & sleep 60"],
			signal: controller.signal,
			onReady: (identity) => ready.resolve(identity),
		});
		const identity = await Promise.race([
			ready.promise,
			execution.then(() => {
				throw new Error("process exited before ready");
			}),
		]);
		try {
			// The witness enumerates namespace membership, not the recorded init:
			// a dead or fabricated direct child cannot mask the surviving members.
			const members = await waitForMembers({ namespace: identity.namespace }, 2);
			expect(members).toContain(identity.pid);
			expect(await supervisor.awaitBoundaryDrained(identity, 0)).toBe("populated");
		} finally {
			controller.abort();
			const outcome = await execution;
			expect(outcome.failure).toBe("cancelled");
			expect(await waitForNamespaceGone(identity)).toBe("gone");
		}
	});

	it("fails closed as descendant_escape when the namespace still has members after close", async () => {
		vi.spyOn(supervisor, "awaitBoundaryDrained").mockResolvedValue("populated");
		await expect(executeSandbox({ ...request(), argv: ["/bin/true"], onReady: () => {} })).rejects.toThrow(
			/descendant_escape/,
		);
	});

	it("takes the termination witness from namespace init death, not the host process table", async () => {
		// ubuntu-22.04 CI (kernel 6.8.0-1064-azure) poisoned the /proc member
		// scan: zombies keep their ns link until reaped and foreign same-uid
		// tasks read as unreadable, so namespaceMemberPids never reported an
		// empty set and every drain settled descendant_escape. The witness
		// must be init death alone.
		const identity: NamespaceIdentity = {
			pid: 4242,
			startTicks: "123",
			namespace: "pid:[4026531836]",
			bootId: "01234567-89ab-cdef-0123-456789abcdef",
		};
		const probe = vi.spyOn(identityModule, "probeNamespace");
		probe.mockReturnValue("gone");
		expect(await supervisor.awaitBoundaryDrained(identity, 100)).toBe("drained");
		probe.mockReturnValue("unknown");
		expect(await supervisor.awaitBoundaryDrained(identity, 100)).toBe("unknown");
		probe.mockReturnValueOnce("alive").mockReturnValueOnce("alive").mockReturnValue("gone");
		expect(await supervisor.awaitBoundaryDrained(identity, 1000)).toBe("drained");
	});

	it("keeps claims quarantined when termination cannot be proven", async () => {
		const f = dagFixture(root);
		vi.spyOn(supervisor, "awaitBoundaryDrained").mockResolvedValue("populated");
		const state = await f.coordinator.start(f.contract, f.command, f.approval);
		expect(state.execution).toBe("failed");
		expect(state.failure).toBe("descendant_escape");
		// The unsettled effect is never released: the execution id stays in
		// activeExecutionIds and no `exited` record exists for it.
		expect(state.settlement).toBe("quarantined");
		expect(state.activeExecutionIds).toHaveLength(1);
		const journal = records(f.runPath);
		expect(journal.some((record) => record.event.kind === "exited")).toBe(false);
		expect(journal.filter((record) => record.event.kind === "dispatch")).toHaveLength(1);
	});

	it("fails closed as termination_unverified when the boundary cannot be enumerated", async () => {
		vi.spyOn(supervisor, "awaitBoundaryDrained").mockResolvedValue("unknown");
		await expect(executeSandbox({ ...request(), argv: ["/bin/true"], onReady: () => {} })).rejects.toThrow(
			/termination_unverified/,
		);
	});
});
