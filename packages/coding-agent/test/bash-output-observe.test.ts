import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBashToolDefinition } from "../src/core/tools/bash.ts";

const MARK = "omkSecretMarker";
const SMALL = `echo ${MARK}-small`;
const BIG = `for i in $(seq 1 5000); do echo ${MARK}-line-$i; done`;

let dir: string;
const ctx = (id: string) => ({ sessionManager: { getSessionId: () => id } }) as any;

async function run(command: string, sessionId = "s1") {
	const tool = createBashToolDefinition(process.cwd(), { exposeSessionEnvironment: false });
	return tool.execute("call", { command }, undefined, undefined, ctx(sessionId));
}

function lines(): any[] {
	const file = join(dir, "bash-output.jsonl");
	if (!existsSync(file)) return [];
	return readFileSync(file, "utf8")
		.trim()
		.split("\n")
		.map((l) => JSON.parse(l));
}

/** Temp file paths differ per call; replace the reported path with a placeholder. */
function normalize(result: any) {
	const path: string | undefined = result.details?.fullOutputPath;
	const json = JSON.stringify(result);
	return JSON.parse(path ? json.split(path).join("<tmp>") : json);
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "omk-bash-runlog-"));
	vi.stubEnv("OMK_RUN_LOG_DIR", "");
	vi.stubEnv("OMK_RUN_LOG_ROLE", "");
	vi.stubEnv("OMK_RUN_LOG_PARENT_SESSION", "");
	vi.stubEnv("OMK_EXEC_TRUNCATE_MIDDLE", "0");
});
afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(dir, { recursive: true, force: true });
});

describe("bash-output run log", () => {
	it("writes nothing when OMK_RUN_LOG_DIR is unset", async () => {
		await run(SMALL);
		await run(BIG);
		expect(existsSync(join(dir, "bash-output.jsonl"))).toBe(false);
	});

	it("writes one line per call with numbers only, truncated and not", async () => {
		vi.stubEnv("OMK_RUN_LOG_DIR", dir);
		await run(SMALL, "sess-a");
		await run(BIG, "sess-a");
		const [small, big] = lines();
		expect(lines()).toHaveLength(2);
		expect(small).toMatchObject({
			event: "bash_output",
			seq: 1,
			sessionId: "sess-a",
			parentSessionId: null,
			truncated: false,
			totalLines: 1,
		});
		expect(small.totalBytes).toBeGreaterThan(0);
		expect(small.outputBytes).toBe(small.totalBytes);
		expect(big).toMatchObject({ seq: 2, sessionId: "sess-a", truncated: true, totalLines: 5000 });
		expect(big.outputBytes).toBeLessThan(big.totalBytes);
		const raw = readFileSync(join(dir, "bash-output.jsonl"), "utf8");
		expect(raw).not.toContain(MARK);
		expect(raw).not.toContain("echo");
		expect(raw).not.toContain("seq 1");
	});

	it("records truncation under OMK_EXEC_TRUNCATE_MIDDLE=1 and worker parent session", async () => {
		vi.stubEnv("OMK_RUN_LOG_DIR", dir);
		vi.stubEnv("OMK_EXEC_TRUNCATE_MIDDLE", "1");
		vi.stubEnv("OMK_RUN_LOG_ROLE", "worker");
		vi.stubEnv("OMK_RUN_LOG_PARENT_SESSION", "lead-1");
		await run(BIG, "w-1");
		await run(SMALL, "w-1");
		const [big, small] = lines();
		expect(big).toMatchObject({
			seq: 1,
			sessionId: "w-1",
			parentSessionId: "lead-1",
			truncated: true,
			totalLines: 5000,
			role: "worker",
		});
		expect(small).toMatchObject({ seq: 2, truncated: false, totalLines: 1 });
		expect(readFileSync(join(dir, "bash-output.jsonl"), "utf8")).not.toContain(MARK);
	});

	it("also logs failed commands", async () => {
		vi.stubEnv("OMK_RUN_LOG_DIR", dir);
		await expect(run(`echo ${MARK}; exit 3`, "f")).rejects.toThrow(/code 3/);
		expect(lines()).toMatchObject([{ sessionId: "f", truncated: false, totalLines: 1 }]);
	});

	it("tool result and definition are identical with and without the run log", async () => {
		for (const middle of ["0", "1"]) {
			vi.stubEnv("OMK_EXEC_TRUNCATE_MIDDLE", middle);
			vi.stubEnv("OMK_RUN_LOG_DIR", "");
			const off = [await run(SMALL), await run(BIG)].map(normalize);
			const defOff = createBashToolDefinition(process.cwd());
			vi.stubEnv("OMK_RUN_LOG_DIR", dir);
			const on = [await run(SMALL), await run(BIG)].map(normalize);
			const defOn = createBashToolDefinition(process.cwd());
			expect(on).toEqual(off);
			expect(defOn.description).toBe(defOff.description);
			expect(JSON.stringify(defOn.parameters)).toBe(JSON.stringify(defOff.parameters));
		}
	});

	it("never throws when the log dir is unwritable", async () => {
		const blocker = join(dir, "not-a-dir");
		writeFileSync(blocker, "");
		vi.stubEnv("OMK_RUN_LOG_DIR", join(blocker, "x"));
		await expect(run(SMALL)).resolves.toBeDefined();
	});
});

describe("bash-output seq LRU cap", () => {
	it("keeps at most 1000 sessions and an active session's seq continues", async () => {
		const { logBashOutput, bashSeqSessionCount, BASH_SEQ_SESSION_CAP } = await import(
			"../src/core/tools/bash-output-observe.ts"
		);
		const env = { OMK_RUN_LOG_DIR: dir } as NodeJS.ProcessEnv;
		logBashOutput(undefined, ctx("active"), env);
		for (let i = 0; i < BASH_SEQ_SESSION_CAP + 50; i++) {
			logBashOutput(undefined, ctx(`lru-${i}`), env);
			if (i % 100 === 0) logBashOutput(undefined, ctx("active"), env);
			expect(bashSeqSessionCount()).toBeLessThanOrEqual(BASH_SEQ_SESSION_CAP);
		}
		expect(bashSeqSessionCount()).toBe(BASH_SEQ_SESSION_CAP);
		logBashOutput(undefined, ctx("active"), env);
		logBashOutput(undefined, ctx("lru-0"), env);
		const all = lines();
		const active = all.filter((l) => l.sessionId === "active").map((l) => l.seq);
		expect(active).toEqual(active.map((_, i) => i + 1));
		// lru-0 was evicted, so its counter restarts.
		expect(all.filter((l) => l.sessionId === "lru-0").map((l) => l.seq)).toEqual([1, 1]);
		const last = all[all.length - 1];
		expect([last.totalLines, last.totalBytes, last.outputBytes, last.truncated]).toEqual([null, null, null, false]);
	});
});
