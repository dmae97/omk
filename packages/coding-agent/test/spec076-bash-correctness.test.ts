/**
 * Spec 076 regression tests. The first three cases are the Harness Engineer audit
 * repros for items #1 and #3 (`/workspace/omk-he-audit-repro/zz-audit-repro.test.ts`,
 * main `b94639dec6`) turned into assertions; the write case covers item #15.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BashOperations, createBashTool } from "../src/core/tools/bash.ts";
import { createLocalBashOperations } from "../src/core/tools/bash-local-operations.ts";
import { createWriteTool } from "../src/core/tools/write.ts";

// A configured but missing locale makes spawned shells print setlocale warnings.
const savedLcAll = process.env.LC_ALL;
let dir = "";
beforeAll(() => {
	process.env.LC_ALL = "C";
	dir = mkdtempSync(join(tmpdir(), "omk-spec076-"));
});
afterAll(() => {
	if (savedLcAll === undefined) delete process.env.LC_ALL;
	else process.env.LC_ALL = savedLcAll;
	rmSync(dir, { recursive: true, force: true });
});

function textOf(content: ReadonlyArray<{ type: string; text?: string }>): string {
	return content.map((block) => (block.type === "text" ? (block.text ?? "") : "")).join("");
}

describe("spec 076 #3: a signal-killed command is an error", () => {
	it("local operations report the signal", async () => {
		const ops = createLocalBashOperations();
		const res = await ops.exec("echo before; kill -9 $$", process.cwd(), {
			onData: () => {},
			signal: undefined,
			timeout: 10,
			env: process.env,
		});
		expect(res).toEqual({ exitCode: null, signal: "SIGKILL" });
	});

	it("the bash tool throws with the output and the signal name", async () => {
		const tool = createBashTool(process.cwd());
		const run = tool.execute("c2", { command: "echo before; kill -9 $$" }, undefined, undefined);
		await expect(run).rejects.toThrow(/^before\n+Command terminated by signal SIGKILL/);
		await expect(run).rejects.toThrow("possibly killed for running out of memory");
	});

	it("SIGTERM is reported without the memory hint", async () => {
		const tool = createBashTool(process.cwd());
		const run = tool.execute("c3", { command: "kill -TERM $$" }, undefined, undefined);
		await expect(run).rejects.toThrow(/^\(no output\)\n\nCommand terminated by signal SIGTERM$/);
	});

	it("custom operations that return only a null exit code still succeed", async () => {
		const operations: BashOperations = {
			exec: async (_command, _cwd, { onData }) => {
				onData(Buffer.from("remote ok\n"));
				return { exitCode: null };
			},
		};
		const tool = createBashTool(process.cwd(), { operations });
		const result = await tool.execute("c4", { command: "true" }, undefined, undefined);
		expect(textOf(result.content)).toBe("remote ok\n");
	});
});

describe("spec 076 Req 2.4: abort and timeout keep their own message", () => {
	it("abort wins over the SIGKILL used to stop the command", async () => {
		const tool = createBashTool(process.cwd());
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 300);
		const run = tool.execute(
			"c5",
			{ command: "echo before-abort; sleep 5", timeout: 10 },
			controller.signal,
			undefined,
		);
		await expect(run).rejects.toThrow(/before-abort\n+Command aborted/);
	});

	it("inner timeout wins over the SIGKILL used to stop the command", async () => {
		const tool = createBashTool(process.cwd());
		const run = tool.execute("c6", { command: "echo before-timeout; sleep 5", timeout: 1 }, undefined, undefined);
		const error = await run.then(
			() => "",
			(e: unknown) => String(e),
		);
		expect(error).toContain("before-timeout");
		expect(error).toContain("Command timed out after 1 seconds");
	});
});

describe("spec 076 #15: write reports UTF-8 bytes", () => {
	it("counts Korean and emoji in UTF-8", async () => {
		const tool = createWriteTool(dir);
		const content = "안녕🙂";
		const result = await tool.execute("w1", { path: "ko.txt", content }, undefined, undefined);
		const onDisk = readFileSync(join(dir, "ko.txt"));
		expect(onDisk.length).toBe(10);
		expect(textOf(result.content)).toBe("Successfully wrote 10 bytes to ko.txt");
	});

	it("ASCII content reports the same count as before", async () => {
		const tool = createWriteTool(dir);
		const result = await tool.execute("w2", { path: "a.txt", content: "hello\n" }, undefined, undefined);
		expect(textOf(result.content)).toBe("Successfully wrote 6 bytes to a.txt");
	});
});
