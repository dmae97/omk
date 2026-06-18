import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyHarnessControlReplay } from "../src/core/harness-control-replay.ts";
import { runHarnessControlTransaction, runHarnessControlTransactionSync } from "../src/core/transaction-coordinator.ts";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

function createTempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omk-harness-transaction-"));
	tempDirs.push(dir);
	return dir;
}

describe("harness control transactions", () => {
	it("records started and completed events around a successful commit", async () => {
		const root = createTempDir();
		const logPath = path.join(root, "events.jsonl");

		const result = await runHarnessControlTransaction({
			kind: "interactive.theme.apply",
			data: { theme: "dark" },
			beforeState: { theme: "light" },
			afterState: (value) => ({ theme: value }),
			commit: () => "dark",
			eventOptions: { cwd: root, logPath, operationId: "tx-1" },
		});

		expect(result).toMatchObject({ status: "completed", operationId: "tx-1", value: "dark" });
		expect(verifyHarnessControlReplay(logPath)).toMatchObject({ ok: true });
	});

	it("records rolled_back when commit fails and rollback succeeds", async () => {
		const root = createTempDir();
		const logPath = path.join(root, "events.jsonl");
		let rolledBack = false;

		const result = await runHarnessControlTransaction({
			kind: "interactive.theme.apply",
			commit: () => {
				throw new Error("commit failed");
			},
			rollback: () => {
				rolledBack = true;
			},
			eventOptions: { cwd: root, logPath, operationId: "tx-2" },
		});

		expect(rolledBack).toBe(true);
		expect(result.status).toBe("rolled_back");
		expect(verifyHarnessControlReplay(logPath).operations[0]).toMatchObject({ terminalStatus: "rolled_back" });
	});

	it("records sync transactions for non-async UI changes", () => {
		const root = createTempDir();
		const logPath = path.join(root, "events.jsonl");

		const result = runHarnessControlTransactionSync({
			kind: "interactive.theme.apply",
			beforeState: { theme: "dark" },
			afterState: (value) => ({ theme: value }),
			commit: () => "light",
			eventOptions: { cwd: root, logPath, operationId: "tx-sync" },
		});

		expect(result).toMatchObject({ status: "completed", operationId: "tx-sync", value: "light" });
		expect(verifyHarnessControlReplay(logPath)).toMatchObject({ ok: true });
	});

	it("records in_doubt when rollback fails", async () => {
		const root = createTempDir();
		const logPath = path.join(root, "events.jsonl");

		const result = await runHarnessControlTransaction({
			kind: "extension.migration.apply",
			commit: () => {
				throw new Error("apply failed");
			},
			rollback: () => {
				throw new Error("rollback failed");
			},
			eventOptions: { cwd: root, logPath, operationId: "tx-3" },
		});

		expect(result.status).toBe("in_doubt");
		expect(verifyHarnessControlReplay(logPath).operations[0]).toMatchObject({ terminalStatus: "in_doubt" });
	});

	it("emits prepare/apply/verify phases and rolls back when verification fails", async () => {
		const root = createTempDir();
		const logPath = path.join(root, "events.jsonl");
		let rollbackValue: unknown;

		const result = await runHarnessControlTransaction({
			kind: "interactive.theme.apply",
			beforeState: { theme: "light" },
			prepare: () => ({ previousTheme: "light" }),
			commit: () => "dark",
			verify: () => {
				throw new Error("verify failed");
			},
			rollback: (_error, context) => {
				rollbackValue = context?.value;
			},
			eventOptions: { cwd: root, logPath, operationId: "tx-verify" },
		});

		expect(result.status).toBe("rolled_back");
		expect(rollbackValue).toBe("dark");
		const statuses = fs
			.readFileSync(logPath, "utf-8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as { status: string })
			.map((event) => event.status);
		expect(statuses).toEqual(["prepared", "started", "applying", "verifying", "rolled_back"]);
	});

	it("fails sync transactions when commit returns a thenable", () => {
		const root = createTempDir();
		const logPath = path.join(root, "events.jsonl");

		const result = runHarnessControlTransactionSync({
			kind: "interactive.theme.apply",
			commit: () => Promise.resolve("dark") as never,
			eventOptions: { cwd: root, logPath, operationId: "tx-sync-thenable" },
		});

		expect(result.status).toBe("failed");
		expect(result.error).toBeInstanceOf(Error);
		expect(verifyHarnessControlReplay(logPath).operations[0]).toMatchObject({ terminalStatus: "failed" });
	});
});
