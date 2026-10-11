import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import deliverableGuard from "../src/core/extensions/builtin/deliverable-guard.ts";
import type { ExtensionAPI } from "../src/core/extensions/types.ts";
import type { RunLogRecord } from "../src/core/run-log.ts";

// spec 034 AC 18 on spec 042: the guard logs through appendRunLog("deliverable-guard", …) to
// <OMK_RUN_LOG_DIR>/deliverable-guard.jsonl, because bench runs keep no session entries.
type Handler = (event: unknown, ctx: unknown) => unknown;
const RESERVED = ["t", "elapsedFraction", "pid", "role"];
const dirs: string[] = [];
afterEach(() => {
	while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function run(env: NodeJS.ProcessEnv, capture?: RunLogRecord[]) {
	const work = mkdtempSync(join(tmpdir(), "omk-guard-log-"));
	dirs.push(work);
	const logDir = join(work, "run-log");
	const file = join(logDir, "deliverable-guard.jsonl");
	let clock = 0;
	const handlers = new Map<string, Handler[]>();
	const signals: (() => void)[] = [];
	const omk = {
		on: (name: string, handler: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
		sendUserMessage: () => {},
		appendEntry: () => {},
		events: { emit: () => {}, on: () => () => {} },
	} as unknown as ExtensionAPI;
	deliverableGuard(omk, {
		env: { OMK_TIME_BUDGET_SEC: "900", OMK_RUN_LOG_DIR: logDir, SECRET_TOKEN: "s3cr3t-value", ...env },
		budgetFraction: () => clock / 900,
		storeRoot: join(work, "store"),
		timers: { setInterval: () => ({}), clearInterval: () => {} },
		onTerminate: (handler) => {
			signals.push(handler);
			return () => {};
		},
		...(capture ? { runLog: (record: RunLogRecord) => capture.push(record) } : {}),
	});
	const ctx = { hasUI: false, cwd: work, hasPendingMessages: () => false };
	const fire = async (name: string, event: unknown = {}) => {
		for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
	};
	const lines = () =>
		existsSync(file)
			? readFileSync(file, "utf8")
					.trim()
					.split("\n")
					.map((line) => JSON.parse(line) as Record<string, unknown>)
			: [];
	return {
		fire,
		work,
		file,
		logDir,
		lines,
		signals,
		at: (s: number) => {
			clock = s;
		},
	};
}

const ON = { OMK_DELIVERABLE_GUARD: "on" };
const settled = { messages: [{ role: "assistant", stopReason: "stop", content: [] }] };

/** A task with a watchdog steer, a 90% size restore and a settle restore of a deleted file. */
async function fullRun(r: ReturnType<typeof run>) {
	const path = join(r.work, "out.txt");
	await r.fire("input", { type: "input", text: `Write ${path}. It must be at most 10 bytes.`, source: "cli" });
	r.at(400);
	await r.fire("tool_execution_end", { toolName: "bash" });
	writeFileSync(path, "good");
	r.at(500);
	await r.fire("tool_execution_end", { toolName: "write" });
	writeFileSync(path, "way too long now");
	r.at(820);
	await r.fire("tool_execution_end", { toolName: "write" });
	unlinkSync(path);
	await r.fire("agent_settled", settled);
	return path;
}

describe("deliverable guard run log (appendRunLog)", () => {
	it("writes nothing when the guard is off, even with OMK_RUN_LOG_DIR set", async () => {
		const r = run({});
		await r.fire("input", { type: "input", text: `Write ${join(r.work, "a.txt")}.`, source: "cli" });
		await r.fire("agent_settled", settled);
		expect(existsSync(r.logDir)).toBe(false);
	});

	it("writes nothing when OMK_RUN_LOG_DIR is unset", async () => {
		const r = run({ ...ON, OMK_RUN_LOG_DIR: undefined });
		await fullRun(r);
		expect(existsSync(r.logDir)).toBe(false);
	});

	it("logs steer, verdict, restore and summary lines with appendRunLog's fields", async () => {
		const r = run(ON);
		const before = Date.now();
		const path = await fullRun(r);
		const lines = r.lines();
		expect(lines.map((line) => line.type)).toEqual([
			"steer",
			"verdict",
			"restore",
			"steer",
			"verdict",
			"restore",
			"summary",
		]);
		expect(lines[0]).toMatchObject({ kind: "watchdog", paths: [path] });
		expect(lines[1]).toMatchObject({ path, point: "budget", ok: false, reason: "size", decision: "restore" });
		expect(lines[2]).toMatchObject({
			path,
			point: "budget",
			outcome: "restored",
			reason: "invalid:size",
			restoredSize: 4,
		});
		expect(lines[3]).toMatchObject({ kind: "restore", paths: [path] });
		expect(lines[5]).toMatchObject({ path, point: "settle", outcome: "restored", reason: "missing" });
		expect(lines[6]).toMatchObject({ steers: 2, restores: 2 });
		expect(typeof lines[6].guardMs).toBe("number");
		for (const line of lines) {
			expect(line.t as number).toBeGreaterThanOrEqual(before);
			expect(line).toMatchObject({ pid: process.pid, role: "lead", elapsedFraction: null });
			expect(line).not.toHaveProperty("ts");
		}
		const raw = readFileSync(r.file, "utf8");
		expect(raw).not.toContain("way too long");
		expect(raw).not.toContain("s3cr3t-value");
	});

	it("never sets appendRunLog's own keys in a record", async () => {
		const records: RunLogRecord[] = [];
		await fullRun(run(ON, records));
		expect(records.length).toBeGreaterThan(0);
		for (const record of records) for (const key of RESERVED) expect(record).not.toHaveProperty(key);
	});

	it("logs a valid file at a restore point as keep", async () => {
		const r = run(ON);
		const path = join(r.work, "out.txt");
		await r.fire("input", { type: "input", text: `Write ${path}.`, source: "cli" });
		writeFileSync(path, "ok");
		await r.fire("agent_settled", settled);
		expect(r.lines()[0]).toMatchObject({ type: "verdict", path, point: "settle", ok: true, decision: "keep" });
	});

	it("writes the SIGTERM restore line synchronously", async () => {
		const r = run(ON);
		const path = join(r.work, "out.txt");
		await r.fire("input", { type: "input", text: `Write ${path}.`, source: "cli" });
		writeFileSync(path, "ok");
		await r.fire("tool_execution_end", { toolName: "write" });
		unlinkSync(path);
		r.signals[0]();
		expect(r.lines().at(-1)).toMatchObject({
			type: "restore",
			point: "sigterm",
			path,
			outcome: "restored",
			reason: "missing",
		});
	});
});
