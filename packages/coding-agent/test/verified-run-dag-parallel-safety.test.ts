import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as durableIo from "../src/core/durable-file-io.ts";
import { planVerifiedRun } from "../src/core/run-execution-api.ts";
import { canonicalJson } from "../src/core/run-journal.ts";
import * as broker from "../src/core/verified-run/broker.ts";
import { projectRun } from "../src/core/verified-run/events.ts";
import { journalPath, readRunJournal } from "../src/core/verified-run/journal.ts";
import { type NamespaceIdentity, probeNamespace } from "../src/core/verified-run/namespace-identity.ts";
import { digestObject } from "../src/core/verified-run/storage.ts";
import { dagFixture } from "./verified-run-dag-fixture.ts";

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "parallel-safety-"));
});
afterEach(() => {
	vi.restoreAllMocks();
	rmSync(root, { recursive: true, force: true });
});

describe("parallel DAG ownership and compatibility", () => {
	it("retains a failed branch independently of its successful peer and retries only that branch", async () => {
		const f = dagFixture(root, true);
		const contract = { ...f.contract, writer: { ...f.contract.writer, maxConcurrentTasks: 2 } };
		const contractDigest = planVerifiedRun(contract).contractDigest;
		const approval = { approvedContractDigest: contractDigest };
		const state = await f.coordinator.start(contract, { ...f.command, contractDigest }, approval);
		expect(state).toMatchObject({
			execution: "paused",
			tasks: [{ status: "succeeded" }, { status: "failed", failure: "execution_failed" }, { status: "pending" }],
		});
		const result = await f.coordinator.retryTasks(
			{
				...f.command,
				contractDigest,
				commandId: "retry",
				kind: "retry_tasks",
				baseDigest: contract.workspace.baseDigest,
				taskIds: ["right"],
				expectedRevision: state.revision,
				expectedGeneration: 1,
			},
			approval,
		);
		expect(result).toMatchObject({
			generation: 2,
			verification: "verified",
			tasks: [{ attempt: 1 }, { attempt: 2 }, { attempt: 1 }],
		});
		expect(result.budget).toEqual(state.budget);
	});

	it.each([false, true])(
		"drains both real namespaces when a process-ready append fails (visible: %s)",
		async (visible) => {
			const f = dagFixture(root);
			f.contract.writer.tasks[0].attempts = [["/bin/sleep", "30"]];
			f.contract.writer.tasks[1].attempts = [["/bin/sleep", "30"]];
			const contract = { ...f.contract, writer: { ...f.contract.writer, maxConcurrentTasks: 2 } };
			const contractDigest = planVerifiedRun(contract).contractDigest;
			const identities: NamespaceIdentity[] = [];
			const execute = broker.executeSandbox;
			vi.spyOn(broker, "executeSandbox").mockImplementation((request) =>
				execute({
					...request,
					onReady: (identity) => {
						identities.push(identity);
						return request.onReady?.(identity);
					},
				}),
			);
			const persist = durableIo.appendFileDurablySync;
			let ready = 0;
			vi.spyOn(durableIo, "appendFileDurablySync").mockImplementation((path, bytes) => {
				if (Buffer.from(bytes).toString().includes('"kind":"process_ready"') && ++ready === 2) {
					if (visible) persist(path, bytes);
					throw new Error("parallel fsync failure");
				}
				persist(path, bytes);
			});
			await expect(
				f.coordinator.start(contract, { ...f.command, contractDigest }, { approvedContractDigest: contractDigest }),
			).rejects.toThrow(/parallel fsync failure/);
			expect(identities).toHaveLength(2);
			expect(identities.map(probeNamespace)).toEqual(["gone", "gone"]);
			const snapshot = readRunJournal(f.runPath);
			expect(snapshot?.records.filter(({ event }) => event.kind === "dispatch")).toHaveLength(2);
			expect(snapshot?.state.receiptDigest).toBeNull();
			expect(snapshot?.state.activeExecutionIds).toHaveLength(2);
		},
	);

	it("continues to read old serial journals and adopted checkpoints without rewriting them", async () => {
		const f = dagFixture(root, true);
		const before = await f.coordinator.start(f.contract, f.command, f.approval);
		const result = await f.coordinator.retryTasks(
			{
				...f.command,
				commandId: "retry",
				kind: "retry_tasks",
				baseDigest: f.contract.workspace.baseDigest,
				taskIds: ["right"],
				expectedRevision: before.revision,
				expectedGeneration: 1,
			},
			f.approval,
		);
		const snapshot = readRunJournal(f.runPath);
		if (!snapshot) throw new Error("missing fixture");
		let previous = "0".repeat(64);
		const records = snapshot.records.map((record) => {
			const event =
				record.event.kind === "dispatch"
					? {
							kind: record.event.kind,
							executionId: record.event.executionId,
							role: record.event.role,
							claimId: record.event.claimId,
						}
					: record.event;
			const material = { version: 2, seq: record.seq, generation: record.generation, previous, event };
			const hash = digestObject(material);
			previous = hash;
			return { ...material, hash };
		});
		writeFileSync(journalPath(f.runPath), `${records.map(canonicalJson).join("\n")}\n`);
		const bytes = readFileSync(journalPath(f.runPath));
		expect(f.coordinator.inspect("dag")).toEqual(result);
		expect(f.coordinator.evidence("dag").verified).toBe(true);
		expect(readFileSync(journalPath(f.runPath))).toEqual(bytes);
	});

	it("refuses ambiguous task-less dispatch in a parallel contract even with one currently running task", async () => {
		const f = dagFixture(root);
		const contract = { ...f.contract, writer: { ...f.contract.writer, maxConcurrentTasks: 2 } };
		const contractDigest = planVerifiedRun(contract).contractDigest;
		await f.coordinator.start(contract, { ...f.command, contractDigest }, { approvedContractDigest: contractDigest });
		const records = readRunJournal(f.runPath)?.records ?? [];
		const end = records.findIndex(({ event }) => event.kind === "task_started");
		const events = records.slice(0, end + 1).map(({ event }) => event);
		expect(() =>
			projectRun([...events, { kind: "dispatch", executionId: "ambiguous", role: "writer", claimId: null }]),
		).toThrow(/task_not_ready/);
	});
});
