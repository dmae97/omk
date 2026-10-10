import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type BashOperations, createBashTool } from "../src/core/tools/bash.ts";

let dir: string;
const artifacts = new Set<string>();
const raw = `${Array.from({ length: 30 }, (_, index) => ` ✓ test/case-${index}.test.ts (4 tests)`).join("\n")}\n Test Files 30 passed (30)\n Tests 120 passed (120)\n`;
const command = "node node_modules/vitest/dist/cli.js --run test/example.test.ts";
const summary = "Tests: 120 passed\n";

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "omk-rtk-test-"));
	vi.stubEnv("OMK_RTK_OUTPUT", "1");
	vi.stubEnv("OMK_RTK_PATH", join(dir, "rtk"));
});
afterEach(() => {
	vi.unstubAllEnvs();
	for (const file of artifacts) rmSync(file, { force: true });
	artifacts.clear();
	rmSync(dir, { recursive: true, force: true });
});

function installFilter(body: string): void {
	writeFileSync(join(dir, "rtk"), `#!/usr/bin/env node\n${body}\n`, { mode: 0o700 });
	chmodSync(join(dir, "rtk"), 0o700);
}
function tool(output = raw, exitCode = 0) {
	const exec = vi.fn<BashOperations["exec"]>(async (_command, _cwd, { onData }) => {
		onData(Buffer.from(output));
		return { exitCode };
	});
	return { bash: createBashTool(dir, { operations: { exec } }), exec };
}
function rememberPath(text: string): string {
	const match = text.match(/Full output: ([^\]\n]+)/);
	if (!match) throw new Error("Expected raw output path");
	artifacts.add(match[1]);
	return match[1];
}

describe.skipIf(process.platform === "win32")("bash RTK output-only filter", () => {
	it("keeps execution unchanged, compresses only the final result and persists exact raw bytes", async () => {
		const inputFile = join(dir, "received");
		installFilter(
			`let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', d => input += d); process.stdin.on('end', () => { require('node:fs').writeFileSync(${JSON.stringify(inputFile)}, input); process.stdout.write(${JSON.stringify(summary)}); });`,
		);
		const { bash, exec } = tool();
		const result = await bash.execute("call", { command });
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		expect(text).toContain(summary.trim());
		expect(text).not.toContain("case-29");
		expect(result.details).toMatchObject({ outputFilter: { name: "rtk", filter: "vitest", status: "applied" } });
		const path = rememberPath(text);
		expect(readFileSync(path, "utf8")).toBe(raw);
		expect(readFileSync(inputFile, "utf8")).toBe(raw);
		expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(exec).toHaveBeenCalledTimes(1);
		expect(exec.mock.calls[0][0]).toBe(command);
	});

	it("does nothing by default", async () => {
		vi.stubEnv("OMK_RTK_OUTPUT", "0");
		installFilter("throw new Error('must not execute')");
		const { bash } = tool();
		const result = await bash.execute("call", { command });
		expect(result.content).toEqual([{ type: "text", text: raw }]);
	});

	it.each(["node node_modules/vitest/dist/cli.js --run test/x.test.ts && echo done", "echo vitest", "vitest --help"])(
		"does not filter unrelated or compound commands: %s",
		async (command) => {
			installFilter("throw new Error('must not execute')");
			const { bash } = tool();
			const result = await bash.execute("call", { command });
			expect(result.content).toEqual([{ type: "text", text: raw }]);
		},
	);

	it("never turns the original failure into success", async () => {
		installFilter(`process.stdout.write(${JSON.stringify(summary)})`);
		const { bash } = tool(`${raw}AssertionError: missing required receipt\n`, 7);
		await expect(bash.execute("call", { command })).rejects.toThrow("Command exited with code 7");
	});

	it.each([
		"process.exit(4)",
		"process.stdout.write('')",
		"process.stdout.write('x'.repeat(60000))",
		"process.stderr.write('filter failure'); process.stdout.write('ok')",
	])("falls back to raw output on filter failure or unusable output", async (body) => {
		installFilter(body);
		const { bash } = tool();
		const result = await bash.execute("call", { command });
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		expect(text).toContain("case-29");
		expect(result.details).toMatchObject({ outputFilter: { name: "rtk", status: "fallback" } });
		if (text.includes("Full output:")) rememberPath(text);
	});

	it("falls back when RTK is absent", async () => {
		const { bash } = tool();
		const result = await bash.execute("call", { command });
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		expect(text).toContain("case-29");
		expect(result.details).toMatchObject({ outputFilter: { name: "rtk", status: "fallback" } });
		if (text.includes("Full output:")) rememberPath(text);
	});

	it("passes fixed filter arguments without inheriting credentials or session metadata", async () => {
		const metadata = join(dir, "metadata");
		vi.stubEnv("OPENAI_API_KEY", "test-only-not-a-credential");
		vi.stubEnv("PI_SESSION_ID", "private-session");
		installFilter(
			`require('node:fs').writeFileSync(${JSON.stringify(metadata)}, JSON.stringify({ args: process.argv.slice(2), apiKey: process.env.OPENAI_API_KEY, session: process.env.PI_SESSION_ID, telemetry: process.env.RTK_TELEMETRY_DISABLED })); process.stdout.write(${JSON.stringify(summary)});`,
		);
		const { bash } = tool();
		const result = await bash.execute("call", { command });
		rememberPath(result.content[0].type === "text" ? result.content[0].text : "");
		expect(JSON.parse(readFileSync(metadata, "utf8"))).toEqual({
			args: ["pipe", "--filter", "vitest"],
			telemetry: "1",
		});
	});

	it("times out a stalled filter, joins it and returns raw output", async () => {
		const pidFile = join(dir, "pid");
		installFilter(
			`require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`,
		);
		const { bash } = tool();
		const result = await bash.execute("call", { command });
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		expect(text).toContain("case-29");
		rememberPath(text);
		const pid = Number(readFileSync(pidFile, "utf8"));
		expect(() => process.kill(pid, 0)).toThrow();
	});

	it("does not filter truncated output", async () => {
		const marker = join(dir, "started");
		installFilter(
			`require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started'); process.stdout.write(${JSON.stringify(summary)});`,
		);
		const { bash } = tool(raw.repeat(100));
		const result = await bash.execute("call", { command });
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		const path = rememberPath(text);
		expect(readFileSync(path, "utf8")).toBe(raw.repeat(100));
		expect(() => statSync(marker)).toThrow();
	});

	it("normalizes ANSI only for the filter, retaining exact original bytes", async () => {
		const received = join(dir, "received");
		installFilter(
			`let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', d => input += d); process.stdin.on('end', () => { require('node:fs').writeFileSync(${JSON.stringify(received)}, input); process.stdout.write(${JSON.stringify(summary)}); });`,
		);
		const colored = `\u001b[32m${raw}\u001b[0m`;
		const { bash } = tool(colored);
		const result = await bash.execute("call", { command });
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		expect(readFileSync(rememberPath(text), "utf8")).toBe(colored);
		expect(readFileSync(received, "utf8")).toBe(raw);
	});

	it("cancels and joins an active filter without reporting a successful command result", async () => {
		const pidFile = join(dir, "pid");
		installFilter(
			`require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`,
		);
		const { bash } = tool();
		const controller = new AbortController();
		const pending = bash.execute("call", { command }, controller.signal).catch((error: unknown) => {
			if (error instanceof Error) rememberPath(error.message);
			throw error;
		});
		const rejected = expect(pending).rejects.toThrow("aborted");
		await vi.waitFor(() => expect(() => statSync(pidFile)).not.toThrow());
		const pid = Number(readFileSync(pidFile, "utf8"));
		controller.abort();
		await rejected;
		expect(() => process.kill(pid, 0)).toThrow();
	});

	it("keeps raw output when the filtered result plus its provenance footer would be larger", async () => {
		installFilter(`process.stdout.write(${JSON.stringify(raw.slice(0, -20))})`);
		const { bash } = tool();
		const result = await bash.execute("call", { command });
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		expect(text).toContain("case-29");
		expect(result.details).toMatchObject({ outputFilter: { status: "fallback" } });
		rememberPath(text);
	});
});
