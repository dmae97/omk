import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadMcpServerConfigs } from "../src/core/mcp/config.ts";

describe("mcp config path expansion", () => {
	it("expands ~ and $VAR in command/args/cwd", () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "omk-mcp-home-"));
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "omk-mcp-cwd-"));
		fs.mkdirSync(path.join(home, ".omk"), { recursive: true });
		fs.writeFileSync(
			path.join(home, ".omk", "mcp.json"),
			JSON.stringify({
				mcpServers: {
					srv: {
						command: "~/bin/tool",
						args: ["$OMK_TEST_ARG", "${" + "OMK_TEST_ARG2}", "plain"],
						cwd: "~/work",
					},
				},
			}),
		);
		process.env.OMK_TEST_ARG = "/tmp/arg1";
		process.env.OMK_TEST_ARG2 = "/tmp/arg2";
		const configs = loadMcpServerConfigs(cwd, home);
		expect(configs).toHaveLength(1);
		expect(configs[0].command).toBe(path.join(os.homedir(), "bin", "tool"));
		expect(configs[0].args).toEqual(["/tmp/arg1", "/tmp/arg2", "plain"]);
		expect(configs[0].cwd).toBe(path.join(os.homedir(), "work"));
	});

	it("leaves unknown variables untouched", () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "omk-mcp-home2-"));
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "omk-mcp-cwd2-"));
		fs.mkdirSync(path.join(home, ".omk"), { recursive: true });
		fs.writeFileSync(
			path.join(home, ".omk", "mcp.json"),
			JSON.stringify({ mcpServers: { s: { command: "echo", args: ["$NOPE_UNSET"] } } }),
		);
		const configs = loadMcpServerConfigs(cwd, home);
		expect(configs[0].args).toEqual(["$NOPE_UNSET"]);
	});
});
