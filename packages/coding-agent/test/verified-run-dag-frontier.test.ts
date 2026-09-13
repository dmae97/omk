import { mkdirSync, mkdtempSync, rmSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { planVerifiedRun } from "../src/core/run-execution-api.ts";
import { readRunJournal } from "../src/core/verified-run/journal.ts";
import { dagFixture } from "./verified-run-dag-fixture.ts";

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "dag-frontier-"));
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

function fixture() {
	const f = dagFixture(root);
	mkdirSync(f.stateRoot);
	const contract = {
		...f.contract,
		writer: {
			...f.contract.writer,
			maxConcurrentTasks: 2,
			tasks: [
				{
					id: "left",
					dependsOn: [],
					writablePaths: ["left"],
					attempts: [
						["/bin/sh", "-c", "while [ ! -f release-left ]; do sleep 0.01; done; rm release-left; cp input left"],
					],
				},
				{
					id: "right",
					dependsOn: [],
					writablePaths: ["right"],
					attempts: [
						[
							"/bin/sh",
							"-c",
							"while [ ! -f release-right ]; do sleep 0.01; done; rm release-right; tr a-z A-Z < input > right",
						],
					],
				},
				{
					id: "join",
					dependsOn: ["left"],
					writablePaths: ["joined"],
					attempts: [["/bin/sh", "-c", "test ! -e right && cp left joined"]],
				},
			],
		},
		checks: [
			{ claimId: "merged", argv: ["/bin/sh", "-c", "cat left right joined"], stdout: "originalORIGINALoriginal" },
		],
	};
	const contractDigest = planVerifiedRun(contract).contractDigest;
	return {
		...f,
		contract,
		command: { ...f.command, contractDigest },
		approval: { approvedContractDigest: contractDigest },
	};
}

describe("bounded eager DAG frontier", () => {
	it("starts the consumer after its parent settles while an unrelated real writer remains active", async () => {
		const f = fixture();
		const controller = new AbortController();
		let releasedLeft = false;
		let releasedRight = false;
		let maxActive = 0;
		let observationError: unknown;
		const watchdog = setTimeout(() => controller.abort(), 10000);
		const watcher = watch(f.stateRoot, { recursive: true }, () => {
			try {
				const snapshot = readRunJournal(f.runPath);
				if (!snapshot) return;
				maxActive = Math.max(maxActive, snapshot.state.activeExecutionIds.length);
				const right = snapshot.records.find(
					({ event }) => event.kind === "dispatch" && "taskId" in event && event.taskId === "right",
				)?.event;
				if (
					!releasedLeft &&
					right?.kind === "dispatch" &&
					snapshot.state.processes.some((item) => item.executionId === right.executionId)
				) {
					releasedLeft = true;
					writeFileSync(join(f.runPath, "tasks", "left-1-g1", "release-left"), "go");
				}
				if (
					!releasedRight &&
					snapshot.state.tasks.some((task) => task.taskId === "join" && task.status === "succeeded")
				) {
					releasedRight = true;
					writeFileSync(join(f.runPath, "tasks", "right-1-g1", "release-right"), "go");
				}
			} catch (error) {
				observationError = error;
				controller.abort();
			}
		});
		try {
			const state = await f.coordinator.start(f.contract, f.command, { ...f.approval, signal: controller.signal });
			expect(observationError).toBeUndefined();
			expect(state.verification, "a wave barrier or serial executor deadlocks the controlled dependencies").toBe(
				"verified",
			);
			expect(maxActive).toBe(2);
			expect(releasedLeft && releasedRight).toBe(true);
			const records = readRunJournal(f.runPath)?.records ?? [];
			const consumer = records.findIndex(({ event }) => event.kind === "task_started" && event.taskId === "join");
			const unrelated = records.findIndex(({ event }) => event.kind === "task_finished" && event.taskId === "right");
			expect(consumer).toBeLessThan(unrelated);
			expect(state.activeExecutionIds).toEqual([]);
		} finally {
			clearTimeout(watchdog);
			watcher.close();
			controller.abort();
		}
	}, 20000);

	it("joins both owned namespaces before settling a cancelled parallel run", async () => {
		const f = fixture();
		const controller = new AbortController();
		let observedTwo = false;
		let observationError: unknown;
		const watchdog = setTimeout(() => controller.abort(), 10000);
		const watcher = watch(f.stateRoot, { recursive: true }, () => {
			try {
				const state = readRunJournal(f.runPath)?.state;
				if (state?.activeExecutionIds.length === 2 && state.processes.length === 2) {
					observedTwo = true;
					controller.abort();
				}
			} catch (error) {
				observationError = error;
				controller.abort();
			}
		});
		try {
			const state = await f.coordinator.start(f.contract, f.command, { ...f.approval, signal: controller.signal });
			expect(observationError).toBeUndefined();
			expect(observedTwo).toBe(true);
			expect(state).toMatchObject({
				execution: "failed",
				failure: "cancelled",
				settlement: "settled",
				activeExecutionIds: [],
				candidateDigest: null,
			});
			expect(state.tasks.find((task) => task.taskId === "join")?.status).toBe("pending");
		} finally {
			clearTimeout(watchdog);
			watcher.close();
			controller.abort();
		}
	}, 20000);
});
