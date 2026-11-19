import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeSandbox } from "../src/core/verified-run/broker.ts";
import { probeNamespace } from "../src/core/verified-run/namespace-identity.ts";
import { prepareNativeWitnessDir } from "../src/core/verified-run/native-witness.ts";
import { reattachRustExecution } from "../src/core/verified-run/rust-host-reattach.ts";
import {
	nativeExecutionDir,
	nativeRequestId,
	parseRustExecutionRecord,
	readRustExecutionRecord,
} from "../src/core/verified-run/rust-host-record.ts";

const binary = process.env.EXECUTION_HOST_TEST_BINARY;
const ID = "a".repeat(32);
const BOOT = "0123abcd-0000-4000-8000-00000000beef";
const accepted = `{"kind":"accepted","requestId":"${ID}","hostPid":7,"hostTicks":"99"}`;
const ready = `{"kind":"ready","identity":{"pid":4242,"startTicks":"987654","namespace":"pid:[4026532000]","bootId":"${BOOT}"}}`;
const lines = (...items: string[]): string => `${items.join("\n")}\n`;

let root: string;
let dir: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "rust-record-"));
	dir = prepareNativeWitnessDir(nativeExecutionDir(root));
});
afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(root, { recursive: true, force: true });
});

describe("native execution record reducer", () => {
	it("reduces the durable lifecycle and treats a torn tail as an append in flight", () => {
		const record = parseRustExecutionRecord(
			`${lines(accepted, ready, '{"kind":"committed"}', '{"kind":"detached"}')}{"kind":"fini`,
			ID,
			16,
		);
		expect(record).toMatchObject({ committed: true, detached: true, terminal: null, host: { pid: 7, ticks: "99" } });
		const finished = parseRustExecutionRecord(
			lines(
				accepted,
				ready,
				'{"kind":"committed"}',
				'{"kind":"detached"}',
				'{"kind":"finished","exitCode":0,"failure":null,"durationMs":5,"stdout":"6f6b","stderr":""}',
			),
			ID,
			16,
		);
		expect(finished.terminal?.kind === "finished" && finished.terminal.output?.stdout.toString()).toBe("ok");
	});

	it.each([
		["another request", lines(accepted.replace(ID, "b".repeat(32)))],
		["commit before ready", lines(accepted, '{"kind":"committed"}')],
		[
			"success without commit",
			lines(accepted, ready, '{"kind":"finished","exitCode":0,"failure":null,"durationMs":1}'),
		],
		[
			"output before commit",
			lines(
				accepted,
				ready,
				'{"kind":"finished","exitCode":null,"failure":"cancelled","durationMs":1,"stdout":"","stderr":""}',
			),
		],
		[
			"detached terminal without output",
			lines(
				accepted,
				ready,
				'{"kind":"committed"}',
				'{"kind":"detached"}',
				'{"kind":"finished","exitCode":0,"failure":null,"durationMs":1}',
			),
		],
		["records after a terminal", lines(accepted, '{"kind":"error","code":"protocol"}', '{"kind":"committed"}')],
		[
			"output beyond the budget",
			lines(
				accepted,
				ready,
				'{"kind":"committed"}',
				'{"kind":"detached"}',
				`{"kind":"finished","exitCode":0,"failure":null,"durationMs":1,"stdout":"${"61".repeat(17)}","stderr":""}`,
			),
		],
		["unknown fields", lines(`${accepted.slice(0, -1)},"approve":true}`)],
	])("rejects %s", (_, text) => {
		expect(() => parseRustExecutionRecord(text, ID, 16)).toThrow(/integrity/);
	});

	it("reads only an owner-only record in an owner-only directory", () => {
		const path = join(dir, `${ID}.jsonl`);
		writeFileSync(path, lines(accepted), { mode: 0o600 });
		expect(readRustExecutionRecord(dir, ID, 16)?.requestId).toBe(ID);
		chmodSync(path, 0o640);
		expect(() => readRustExecutionRecord(dir, ID, 16)).toThrow(/integrity/);
		expect(readRustExecutionRecord(dir, "c".repeat(32), 16)).toBeNull();
	});
});

describe.skipIf(!binary)("real Rust host record and reattach (explicit EXECUTION_HOST_TEST_BINARY)", () => {
	const budget = { timeoutMs: 20_000, cleanupMs: 5_000, maxOutputBytes: 4096 };

	/** Drive the host as a parent that commits and then dies: stdin closed, stdout unread. */
	function orphan(executionId: string, workspace: string, argv: readonly string[], detachable: boolean) {
		const requestId = nativeRequestId(executionId);
		const child = spawn(binary ?? "", [], { env: {}, stdio: ["pipe", "pipe", "pipe"] });
		const exited = new Promise<number | null>((resolve) => child.once("close", resolve));
		let buffered = "";
		let sent = false;
		const committed = new Promise<void>((resolve) => {
			child.stdout.setEncoding("utf8");
			child.stdout.on("data", (chunk: string) => {
				buffered += chunk;
				if (sent || !buffered.includes('"type":"ready"')) return;
				sent = true;
				child.stdin.write(`${JSON.stringify({ type: "commit", requestId })}\n`);
				setTimeout(() => {
					child.stdin.end();
					child.stdout.destroy();
					resolve();
				}, 100);
			});
		});
		child.stdin.write(
			`${JSON.stringify({ version: 1, requestId, workspace, argv, writable: true, recordDir: dir, detachable, ...budget })}\n`,
		);
		return { committed, exited };
	}
	const project = (): string => {
		const workspace = join(root, "project");
		mkdirSync(workspace, { recursive: true });
		return workspace;
	};

	it("refuses a second start for one request before any spawn", async () => {
		vi.stubEnv("OMK_RUST_EXECUTION_HOST", binary ?? "");
		const workspace = project();
		const requestId = nativeRequestId("12345678-1234-4234-8234-123456789abc");
		const first = await executeSandbox({
			...budget,
			workspace,
			writable: true,
			argv: ["/bin/sh", "-c", "touch first"],
			requestId,
			recordDir: dir,
			onReady: () => {},
		});
		expect(first.failure).toBeNull();
		expect(readRustExecutionRecord(dir, requestId, 4096)).toMatchObject({
			committed: true,
			terminal: { kind: "finished", failure: null, output: null },
		});
		let readied = false;
		await expect(
			executeSandbox({
				...budget,
				workspace,
				writable: true,
				argv: ["/bin/sh", "-c", "touch second"],
				requestId,
				recordDir: dir,
				onReady: () => {
					readied = true;
				},
			}),
		).rejects.toThrow(/duplicate/);
		expect(readied).toBe(false);
		expect(existsSync(join(workspace, "first"))).toBe(true);
		expect(existsSync(join(workspace, "second"))).toBe(false);
	});

	it("keeps a committed detachable execution running and hands its full outcome to a new parent", async () => {
		const workspace = project();
		const executionId = "22345678-1234-4234-8234-123456789abc";
		const { committed, exited } = orphan(
			executionId,
			workspace,
			["/bin/sh", "-c", "printf before; sleep 1; printf done > marker; printf after; printf warn >&2"],
			true,
		);
		await committed;
		expect(existsSync(join(workspace, "marker"))).toBe(false);
		const outcome = await reattachRustExecution(root, executionId, {
			maxOutputBytes: 4096,
			cleanupMs: 5_000,
			deadline: performance.now() + 15_000,
		});
		expect(outcome).toMatchObject({ exitCode: 0, failure: null });
		expect(outcome.stdout.toString()).toBe("beforeafter");
		expect(outcome.stderr.toString()).toBe("warn");
		expect(readFileSync(join(workspace, "marker"), "utf8")).toBe("done");
		expect(await exited).toBe(0);
		const record = readRustExecutionRecord(dir, nativeRequestId(executionId), 4096);
		expect(record?.detached).toBe(true);
		if (!record?.identity) throw new Error("identity missing");
		expect(probeNamespace(record.identity)).toBe("gone");
	}, 20_000);

	it("cancels a detached execution through the record channel when the new parent aborts", async () => {
		const workspace = project();
		const executionId = "32345678-1234-4234-8234-123456789abc";
		const { committed } = orphan(executionId, workspace, ["/bin/sh", "-c", "sleep 30; touch survived"], true);
		await committed;
		const until = performance.now() + 5_000;
		let record = readRustExecutionRecord(dir, nativeRequestId(executionId), 4096);
		while (!record?.detached) {
			if (performance.now() > until) throw new Error("host did not detach");
			await new Promise((resolve) => setTimeout(resolve, 20));
			record = readRustExecutionRecord(dir, nativeRequestId(executionId), 4096);
		}
		expect(record.terminal).toBeNull();
		const controller = new AbortController();
		controller.abort();
		const outcome = await reattachRustExecution(root, executionId, {
			maxOutputBytes: 4096,
			cleanupMs: 5_000,
			deadline: performance.now() + 15_000,
			signal: controller.signal,
		});
		expect(outcome.failure).toBe("cancelled");
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(existsSync(join(workspace, "survived"))).toBe(false);
	}, 20_000);

	it("keeps the earlier cancel-on-disconnect contract when not detachable", async () => {
		const workspace = project();
		const executionId = "42345678-1234-4234-8234-123456789abc";
		const { committed, exited } = orphan(
			executionId,
			workspace,
			["/bin/sh", "-c", "sleep 30; touch survived"],
			false,
		);
		await committed;
		await exited;
		expect(readRustExecutionRecord(dir, nativeRequestId(executionId), 4096)).toMatchObject({
			detached: false,
			terminal: { kind: "finished", failure: "cancelled", output: null },
		});
		await expect(
			reattachRustExecution(root, executionId, {
				maxOutputBytes: 4096,
				cleanupMs: 5_000,
				deadline: performance.now() + 5_000,
			}),
		).rejects.toThrow(/outcome_unknown/);
		expect(existsSync(join(workspace, "survived"))).toBe(false);
	}, 20_000);
});
