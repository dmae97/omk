import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "open-multi-agent-kit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverAgents } from "../examples/extensions/subagent/agents.ts";
import subagentExtension, { getOmkInvocation } from "../examples/extensions/subagent/index.ts";

const AGENT_MD = `---
name: scout
description: read-only reconnaissance agent
---
You are a scout. Report findings.`;

describe("subagent extension — OMK-native agent discovery", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "omk-subagent-test-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("discovers project agents under .omk/agents", () => {
		const agentsDir = path.join(tempDir, ".omk", "agents");
		fs.mkdirSync(agentsDir, { recursive: true });
		fs.writeFileSync(path.join(agentsDir, "scout.md"), AGENT_MD);

		const result = discoverAgents(tempDir, "project");

		expect(result.projectAgentsDir).toBe(agentsDir);
		expect(result.agents.map((a) => a.name)).toContain("scout");
		const scout = result.agents.find((a) => a.name === "scout");
		expect(scout?.source).toBe("project");
		expect(scout?.description).toBe("read-only reconnaissance agent");
	});

	it("no longer reads legacy .pi/agents for project scope", () => {
		const legacyDir = path.join(tempDir, ".pi", "agents");
		fs.mkdirSync(legacyDir, { recursive: true });
		fs.writeFileSync(path.join(legacyDir, "legacy.md"), AGENT_MD);

		const result = discoverAgents(tempDir, "project");

		expect(result.projectAgentsDir).toBeNull();
		expect(result.agents).toHaveLength(0);
	});
});

describe("subagent extension — runtime invocation resolution", () => {
	let originalArgv1: string | undefined;
	let execPathDescriptor: PropertyDescriptor | undefined;

	beforeEach(() => {
		originalArgv1 = process.argv[1];
		execPathDescriptor = Object.getOwnPropertyDescriptor(process, "execPath");
	});

	afterEach(() => {
		if (originalArgv1 === undefined) process.argv.splice(1, 1);
		else process.argv[1] = originalArgv1;
		if (execPathDescriptor) Object.defineProperty(process, "execPath", execPathDescriptor);
	});

	it("self-invokes the current script when it exists", () => {
		const realScript = fileURLToPath(import.meta.url);
		process.argv[1] = realScript;

		const invocation = getOmkInvocation(["--mode", "json"]);

		expect(invocation.command).toBe(process.execPath);
		expect(invocation.args).toEqual([realScript, "--mode", "json"]);
	});

	it("falls back to the omk command on a generic runtime with no script", () => {
		process.argv[1] = path.join(os.tmpdir(), "does-not-exist-omk-script.js");
		Object.defineProperty(process, "execPath", {
			value: "/usr/bin/node",
			configurable: true,
			writable: true,
		});

		const invocation = getOmkInvocation(["-p", "task"]);

		expect(invocation.command).toBe("omk");
		expect(invocation.args).toEqual(["-p", "task"]);
	});

	it("invokes a packaged binary runtime directly", () => {
		process.argv[1] = path.join(os.tmpdir(), "does-not-exist-omk-script.js");
		Object.defineProperty(process, "execPath", {
			value: "/opt/omk/bin/omk",
			configurable: true,
			writable: true,
		});

		const invocation = getOmkInvocation(["-p", "task"]);

		expect(invocation.command).toBe("/opt/omk/bin/omk");
		expect(invocation.args).toEqual(["-p", "task"]);
	});
});

describe("subagent extension — registration metadata", () => {
	it("describes OMK agent paths and never legacy .pi paths", () => {
		let description = "";
		const pi = {
			registerTool: (definition: { description?: string }) => {
				description = definition.description ?? "";
			},
		} as unknown as ExtensionAPI;

		subagentExtension(pi);

		expect(description).toContain(".omk/agents");
		expect(description).not.toContain(".pi");
	});
});
