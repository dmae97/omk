import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareNativeWitnessDir } from "../src/core/verified-run/native-witness.ts";
import { parseRustHostEvent, type RustHostEvent } from "../src/core/verified-run/rust-host-protocol.ts";
import { reattachRustExecution } from "../src/core/verified-run/rust-host-reattach.ts";
import { nativeExecutionDir, readRustExecutionRecord } from "../src/core/verified-run/rust-host-record.ts";

const binary = process.env.EXECUTION_HOST_TEST_BINARY;
const requestId = "d".repeat(32);
let root: string;
let workspace: string;
let recordDir: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "rust-durability-"));
	workspace = join(root, "project");
	mkdirSync(workspace);
	recordDir = prepareNativeWitnessDir(nativeExecutionDir(root));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function start(detachable: boolean) {
	const child = spawn(binary ?? "", [], { env: {}, stdio: ["pipe", "pipe", "pipe"] });
	const events: RustHostEvent[] = [];
	const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
	let pending = "";
	child.stderr.resume();
	child.stdin.on("error", () => {});
	child.stdout.setEncoding("utf8");
	child.stdout.on("data", (chunk: string) => {
		pending += chunk;
		let end = pending.indexOf("\n");
		while (end !== -1) {
			const event = parseRustHostEvent(pending.slice(0, end), requestId);
			pending = pending.slice(end + 1);
			events.push(event);
			if (event.type === "ready") child.stdin.write(`${JSON.stringify({ type: "commit", requestId })}\n`);
			end = pending.indexOf("\n");
		}
	});
	child.stdin.write(
		`${JSON.stringify({
			version: 1,
			requestId,
			workspace,
			argv: ["/bin/sh", "-c", "while ! test -f release; do sleep 0.01; done; printf 'ok'; printf 'warn' >&2"],
			writable: true,
			timeoutMs: 10_000,
			cleanupMs: 5_000,
			maxOutputBytes: 4096,
			recordDir,
			detachable,
		})}\n`,
	);
	return { child, events, exited };
}

async function waitCommitted(events: readonly RustHostEvent[]): Promise<void> {
	const deadline = performance.now() + 5_000;
	while (
		!events.some((event) => event.type === "ready") ||
		!readRustExecutionRecord(recordDir, requestId, 4096)?.committed
	) {
		if (performance.now() >= deadline) throw new Error("commit not observed");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

describe.skipIf(!binary)("native durable terminal boundary (real host)", () => {
	it("never sends success when persisting the terminal record is impossible", async () => {
		const { child, events, exited } = start(false);
		try {
			await waitCommitted(events);
			if (!child.pid) throw new Error("missing child PID");
			// Limit only this owned host after commit; the already-spawned sandbox is unaffected.
			const limited = spawnSync("/usr/bin/prlimit", [`--pid=${child.pid}`, "--fsize=0:0"], { env: {} });
			expect(limited.status).toBe(0);
			writeFileSync(join(workspace, "release"), "");
			await exited;
			expect(events.some((event) => event.type === "finished")).toBe(false);
			expect(readRustExecutionRecord(recordDir, requestId, 4096)?.terminal).toBeNull();
		} finally {
			child.stdin.end();
			await exited;
		}
	}, 20_000);

	it("withholds a complete terminal payload when publishing its durable prefix fails", async () => {
		const { child, events, exited } = start(false);
		try {
			await waitCommitted(events);
			mkdirSync(join(recordDir, `.${requestId}.head.tmp`), { mode: 0o700 });
			writeFileSync(join(workspace, "release"), "");
			await exited;
			expect(events.some((event) => event.type === "finished")).toBe(false);
			expect(readFileSync(join(recordDir, `${requestId}.jsonl`), "utf8")).toContain('"kind":"finished"');
			expect(readRustExecutionRecord(recordDir, requestId, 4096)?.terminal).toBeNull();
		} finally {
			child.stdin.end();
			await exited;
		}
	}, 20_000);

	it("persists a detachable outcome even when the first parent receives every event", async () => {
		const { child, events, exited } = start(true);
		try {
			await waitCommitted(events);
			writeFileSync(join(workspace, "release"), "");
			await exited;
			expect(events.at(-1)).toMatchObject({ type: "finished", exitCode: 0, failure: null });
			const outcome = await reattachRustExecution(root, requestId, {
				maxOutputBytes: 4096,
				cleanupMs: 5_000,
				deadline: performance.now() + 5_000,
			});
			expect(outcome.stdout.toString()).toBe("ok");
			expect(outcome.stderr.toString()).toBe("warn");
			expect(Date.parse(outcome.startedAt)).toBe(readRustExecutionRecord(recordDir, requestId, 4096)?.startedAtMs);
			expect(Date.parse(outcome.finishedAt) - Date.parse(outcome.startedAt)).toBe(outcome.durationMs);
			expect(readRustExecutionRecord(recordDir, requestId, 4096)?.detached).toBe(false);
			const path = join(recordDir, `${requestId}.jsonl`);
			const saved = readFileSync(path, "utf8");
			chmodSync(path, 0o400);
			await reattachRustExecution(root, requestId, {
				maxOutputBytes: 4096,
				cleanupMs: 5_000,
				deadline: performance.now() + 5_000,
			});
			expect(readFileSync(path, "utf8")).toBe(saved);
		} finally {
			child.stdin.end();
			await exited;
		}
	}, 20_000);
});
