import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mayBeRunCommand } from "../src/cli/subcommand-words.ts";
import { runCodexUltra, supportedCodexVersion } from "../src/commands/codex-ultra.ts";
import { codexUltraAvailable } from "../src/commands/codex-ultra-catalog.ts";
import { runCodexTask } from "../src/commands/codex-ultra-exec.ts";
import { readCodexVersion } from "../src/commands/codex-ultra-version.ts";
import { runCommand } from "../src/commands/run-command.ts";

let dir: string;
let binary: string;
let callLog: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "omk-codex-ultra-"));
	binary = join(dir, "codex");
	callLog = join(dir, "calls.jsonl");
	writeFileSync(
		binary,
		`#!/usr/bin/env node
const fs = require("node:fs");
const readline = require("node:readline");
const spawn = require("node:child_process").spawn;
const args = process.argv.slice(2);
fs.appendFileSync(process.env.ULTRA_TEST_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "--version") {
  if (process.env.ULTRA_TEST_VERSION_FLOOD) {
    fs.writeFileSync(process.env.ULTRA_TEST_PID, String(process.pid));
    process.on("SIGTERM", () => {}); setInterval(() => process.stdout.write("x".repeat(100000)), 1); return;
  }
  if (process.env.ULTRA_TEST_VERSION_STUCK) {
    fs.writeFileSync(process.env.ULTRA_TEST_PID, String(process.pid));
    process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); return;
  }
  console.log(process.env.ULTRA_TEST_VERSION || "codex-cli 0.159.0"); process.exit(0);
}
if (args[0] === "exec") {
  if (process.env.ULTRA_TEST_GRANDCHILD) {
    const script = 'process.on("SIGTERM",()=>{}); require("fs").writeFileSync(process.env.ULTRA_TEST_GRAND_READY,String(process.pid)); setInterval(()=>{},1000); setTimeout(()=>process.exit(0),6000);';
    spawn(process.execPath, ["-e", script], {stdio:"ignore"}).unref();
  }
  if (process.env.ULTRA_TEST_OUTPUT_FLOOD) {
    fs.writeFileSync(process.env.ULTRA_TEST_PID, String(process.pid));
    process.on("SIGTERM", () => {});
    setInterval(() => process.stdout.write("x".repeat(100000)), 1); return;
  }
  let task = "";
  process.stdin.on("data", (chunk) => { task += chunk.toString(); });
  process.stdin.on("end", () => {
    fs.writeFileSync(process.env.ULTRA_TEST_PROMPT, task);
    if (!process.env.ULTRA_TEST_INTERACTIVE_WAIT) { process.stdout.write('{"type":"done"}\\n'); process.exit(0); }
  });
  if (process.env.ULTRA_TEST_INTERACTIVE_WAIT) {
    if (process.env.ULTRA_TEST_SELF_EXIT) setTimeout(() => { fs.writeFileSync(process.env.ULTRA_TEST_SELF_EXIT, "exited"); process.exit(0); }, 1000);
    fs.writeFileSync(process.env.ULTRA_TEST_PID, String(process.pid));
    process.on("SIGINT", () => { fs.writeFileSync(process.env.ULTRA_TEST_SIGNAL, "SIGINT"); process.exit(130); });
    process.on("SIGTERM", () => { fs.writeFileSync(process.env.ULTRA_TEST_SIGNAL, "SIGTERM"); process.exit(143); });
    const ready = () => {
      if (process.env.ULTRA_TEST_GRANDCHILD && !fs.existsSync(process.env.ULTRA_TEST_GRAND_READY)) return;
      fs.writeFileSync(process.env.ULTRA_TEST_READY, "ready");
    };
    setInterval(ready, 10); return;
  }
  return;
}
if (process.env.ULTRA_TEST_IGNORE_TERM) {
  fs.writeFileSync(process.env.ULTRA_TEST_PID, String(process.pid));
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1000);
}
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    if (process.env.ULTRA_TEST_STUCK) return;
    if (process.env.ULTRA_TEST_MALFORMED) { console.log("broken json"); return; }
    console.log(JSON.stringify({id:message.id,result:{}}));
  }
  if (message.method === "model/list") {
    if (process.env.ULTRA_TEST_MULTIPAGE && message.params.cursor === null) {
      console.log(JSON.stringify({id:message.id,result:{data:[],nextCursor:"page-2"}})); return;
    }
    const result = process.env.ULTRA_TEST_UNSUPPORTED ? {data:[],nextCursor:null} :
      {data:[{id:"gpt-6.1-terra",model:"gpt-6.1-terra",multiAgentVersion:process.env.ULTRA_TEST_V1 ? "v1" : "v2",supportedReasoningEfforts:[{reasoningEffort:"ultra"}]}],nextCursor:null};
    console.log(JSON.stringify({id:message.id,result}));
  }
});
`,
	);
	chmodSync(binary, 0o755);
	vi.stubEnv("ULTRA_TEST_LOG", callLog);
	vi.stubEnv("ULTRA_TEST_PID", join(dir, "server.pid"));
	vi.stubEnv("ULTRA_TEST_READY", join(dir, "ready"));
	vi.stubEnv("ULTRA_TEST_SIGNAL", join(dir, "signal"));
	vi.stubEnv("ULTRA_TEST_PROMPT", join(dir, "task"));
	vi.stubEnv("ULTRA_TEST_GRAND_READY", join(dir, "grandchild"));
	vi.stubEnv("PATH", `${dir}${delimiter}${process.env.PATH ?? ""}`);
});

afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("Codex Terra Ultra CLI", () => {
	it("routes the subcommand from the native dispatcher", async () => {
		expect(mayBeRunCommand(["codex-ultra", "--help"])).toBe(true);
		expect(await runCommand(["codex-ultra", "--help"])).toEqual({ handled: true, exitCode: 0 });
	});
	it.each([
		["codex-cli 0.158.9", false],
		["codex-cli 0.159.0", true],
		["codex-cli 1.0.0", true],
		["codex-cli 0.159.0-beta", false],
		["unrelated 9.9.9", false],
	])("checks the installed version: %s", (value, expected) => {
		expect(supportedCodexVersion(value)).toBe(expected);
	});

	it("uses Codex model discovery and delegates to the real CLI argument contract", async () => {
		expect(await codexUltraAvailable(binary)).toBe(true);
		const source = pathToFileURL(join(process.cwd(), "src/commands/codex-ultra.ts")).href;
		const driver = spawn(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				`import { runCodexUltra } from ${JSON.stringify(source)}; process.exitCode = await runCodexUltra([]);`,
			],
			{ stdio: ["pipe", "pipe", "ignore"] },
		);
		let output = "";
		driver.stdout.on("data", (chunk: Buffer) => {
			output += chunk.toString("utf8");
		});
		driver.stdin.end("private task");
		const result = await new Promise<number | null>((resolve) => driver.once("close", resolve));
		expect(result).toBe(0);
		expect(output).toBe('{"type":"done"}\n');
		const calls = readFileSync(callLog, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(calls.at(-1)).toEqual([
			"exec",
			"--json",
			"--model",
			"gpt-6.1-terra",
			"--config",
			'model_reasoning_effort="ultra"',
			"-",
		]);
		expect(readFileSync(join(dir, "task"), "utf8")).toBe("private task");
	});

	it("does not launch a session when the account does not advertise support", async () => {
		vi.stubEnv("ULTRA_TEST_UNSUPPORTED", "1");
		expect(await runCodexUltra([], "private task")).toBe(1);
		const calls = readFileSync(callLog, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(calls).toEqual([["--version"], ["app-server"]]);
	});

	it("recognizes a model on a later page and rejects an older multi-agent capability", async () => {
		vi.stubEnv("ULTRA_TEST_MULTIPAGE", "1");
		expect(await codexUltraAvailable(binary)).toBe(true);
		vi.stubEnv("ULTRA_TEST_V1", "1");
		expect(await codexUltraAvailable(binary)).toBe(false);
	});

	it("stops discovery on malformed replies and timeout", async () => {
		vi.stubEnv("ULTRA_TEST_MALFORMED", "1");
		await expect(codexUltraAvailable(binary)).rejects.toThrow("invalid JSON");
		vi.stubEnv("ULTRA_TEST_MALFORMED", "");
		vi.stubEnv("ULTRA_TEST_STUCK", "1");
		await expect(codexUltraAvailable(binary, 250)).rejects.toThrow("timed out");
	});

	it("does not return until a server that ignores SIGTERM has been killed and reaped", async () => {
		vi.stubEnv("ULTRA_TEST_IGNORE_TERM", "1");
		expect(await codexUltraAvailable(binary)).toBe(true);
		const pid = Number(readFileSync(join(dir, "server.pid"), "utf8"));
		expect(() => process.kill(pid, 0)).toThrow();
	});

	it("kills and reaps an unresponsive version check", async () => {
		vi.stubEnv("ULTRA_TEST_VERSION_STUCK", "1");
		await expect(readCodexVersion(binary, 250)).rejects.toThrow("timed out");
		const pid = Number(readFileSync(join(dir, "server.pid"), "utf8"));
		expect(() => process.kill(pid, 0)).toThrow();
	});

	it("limits and terminates an oversized version response", async () => {
		vi.stubEnv("ULTRA_TEST_VERSION_FLOOD", "1");
		await expect(readCodexVersion(binary)).rejects.toThrow("too large");
		const pid = Number(readFileSync(join(dir, "server.pid"), "utf8"));
		expect(() => process.kill(pid, 0)).toThrow();
	});

	it("forwards a parent-only SIGINT in non-interactive environments", async () => {
		vi.stubEnv("ULTRA_TEST_INTERACTIVE_WAIT", "1");
		const source = pathToFileURL(join(process.cwd(), "src/commands/codex-ultra.ts")).href;
		const driver = spawn(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				`import { runCodexUltra } from ${JSON.stringify(source)}; process.exitCode = await runCodexUltra([], "private task");`,
			],
			{ stdio: "ignore" },
		);
		const result = new Promise<number | null>((resolve) => driver.once("close", resolve));
		const start = Date.now();
		while (!existsSync(join(dir, "ready")) && Date.now() - start < 5_000) {
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		if (!existsSync(join(dir, "ready"))) {
			driver.kill("SIGKILL");
			throw new Error("driver did not reach the interactive CLI");
		}
		driver.kill("SIGINT");
		expect(await result).toBe(130);
		expect(readFileSync(join(dir, "signal"), "utf8")).toBe("SIGTERM");
	});

	it("returns unknown instead of claiming cleanup if a descendant remains after leader exit", async () => {
		vi.stubEnv("ULTRA_TEST_INTERACTIVE_WAIT", "1");
		vi.stubEnv("ULTRA_TEST_GRANDCHILD", "1");
		const source = pathToFileURL(join(process.cwd(), "src/commands/codex-ultra.ts")).href;
		const driver = spawn(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				`import { runCodexUltra } from ${JSON.stringify(source)}; process.exitCode = await runCodexUltra([], "task");`,
			],
			{ stdio: ["ignore", "ignore", "pipe"] },
		);
		let stderr = "";
		driver.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf8");
		});
		const result = new Promise<number | null>((resolve) => driver.once("close", resolve));
		const start = Date.now();
		while (!existsSync(join(dir, "ready")) && Date.now() - start < 5_000)
			await new Promise((resolve) => setTimeout(resolve, 25));
		if (!existsSync(join(dir, "ready"))) {
			driver.kill("SIGKILL");
			throw new Error("driver was not ready");
		}
		const grandchild = Number(readFileSync(join(dir, "grandchild"), "utf8"));
		driver.kill("SIGINT");
		const code = await result;
		let alive = true;
		try {
			process.kill(grandchild, 0);
		} catch {
			alive = false;
		}
		if (alive) {
			expect(code).toBe(1);
			expect(stderr).toContain("unknown");
		} else expect(code).toBe(130);
	}, 12_000);

	it("supervisor cancels its Codex child after its parent disappears", async () => {
		vi.stubEnv("ULTRA_TEST_INTERACTIVE_WAIT", "1");
		const source = pathToFileURL(join(process.cwd(), "src/commands/codex-ultra.ts")).href;
		const driver = spawn(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				`import { runCodexUltra } from ${JSON.stringify(source)}; process.exitCode = await runCodexUltra([], "task");`,
			],
			{ stdio: "ignore" },
		);
		const start = Date.now();
		while (!existsSync(join(dir, "ready")) && Date.now() - start < 5_000)
			await new Promise((resolve) => setTimeout(resolve, 25));
		if (!existsSync(join(dir, "ready"))) {
			driver.kill("SIGKILL");
			throw new Error("driver was not ready");
		}
		const closed = new Promise<void>((resolve) => driver.once("close", () => resolve()));
		driver.kill("SIGKILL");
		await closed;
		const signalStart = Date.now();
		while (!existsSync(join(dir, "signal")) && Date.now() - signalStart < 5_000)
			await new Promise((resolve) => setTimeout(resolve, 25));
		expect(readFileSync(join(dir, "signal"), "utf8")).toBe("SIGTERM");
		const childPid = Number(readFileSync(join(dir, "server.pid"), "utf8"));
		const terminationStart = Date.now();
		let alive = true;
		while (alive && Date.now() - terminationStart < 5_000) {
			try {
				process.kill(childPid, 0);
			} catch {
				alive = false;
			}
			if (alive) await new Promise((resolve) => setTimeout(resolve, 25));
		}
		expect(alive).toBe(false);
	}, 12_000);

	it("reports unknown if the supervisor crashes while its child is still running", async () => {
		vi.stubEnv("ULTRA_TEST_INTERACTIVE_WAIT", "1");
		vi.stubEnv("ULTRA_TEST_SELF_EXIT", join(dir, "selfexit"));
		const fixture = join(dir, "crash-supervisor.cjs");
		writeFileSync(
			fixture,
			`process.on("message", (message) => { require("child_process").spawn(message.binary, ["exec"], {stdio:"ignore"}).unref(); setTimeout(() => process.kill(process.pid, "SIGKILL"), 300); }); process.send({type:"ready"});`,
		);
		expect(await runCodexTask(binary, "task", fixture)).toBe(1);
		const start = Date.now();
		while (!existsSync(join(dir, "selfexit")) && Date.now() - start < 4_000)
			await new Promise((resolve) => setTimeout(resolve, 25));
		expect(readFileSync(join(dir, "selfexit"), "utf8")).toBe("exited");
	});

	it("terminates and reaps a child exceeding the output limit", async () => {
		vi.stubEnv("ULTRA_TEST_OUTPUT_FLOOD", "1");
		const source = pathToFileURL(join(process.cwd(), "src/commands/codex-ultra.ts")).href;
		const driver = spawn(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				`import { runCodexUltra } from ${JSON.stringify(source)}; process.exitCode = await runCodexUltra([], "task");`,
			],
			{ stdio: "ignore" },
		);
		const result = await new Promise<number | null>((resolve) => driver.once("close", resolve));
		expect(result).toBe(1);
		const pid = Number(readFileSync(join(dir, "server.pid"), "utf8"));
		expect(() => process.kill(pid, 0)).toThrow();
	});

	it("rejects unsupported options before launching any process", async () => {
		expect(await runCodexUltra(["--dangerously-bypass-approvals-and-sandbox"])).toBe(2);
		expect(() => readFileSync(callLog)).toThrow();
	});
});
