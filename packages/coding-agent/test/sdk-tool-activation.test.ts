import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getBundledModel } from "@oh-my-pi/pi-ai";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { createAgentSession, type ExtensionFactory } from "@oh-my-pi/pi-coding-agent/sdk";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { Snowflake } from "@oh-my-pi/pi-utils";
import { Type } from "@sinclair/typebox";

const toolActivationExtension: ExtensionFactory = pi => {
	pi.registerTool({
		name: "default_inactive_tool",
		label: "Default Inactive Tool",
		description: "Tool hidden from the initial active set unless explicitly requested.",
		parameters: Type.Object({}),
		defaultInactive: true,
		async execute() {
			return { content: [{ type: "text", text: "inactive" }] };
		},
	});
	pi.registerTool({
		name: "default_active_tool",
		label: "Default Active Tool",
		description: "Tool included in the initial active set.",
		parameters: Type.Object({}),
		async execute() {
			return { content: [{ type: "text", text: "active" }] };
		},
	});
};

describe("createAgentSession defaultInactive tool activation", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const tempDir of tempDirs.splice(0)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("excludes defaultInactive extension tools from the initial active set unless explicitly requested", async () => {
		const tempDir = path.join(os.tmpdir(), `pi-sdk-tool-activation-${Snowflake.next()}`);
		tempDirs.push(tempDir);
		fs.mkdirSync(tempDir, { recursive: true });

		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated(),
			model: getBundledModel("openai", "gpt-4o-mini"),
			disableExtensionDiscovery: true,
			extensions: [toolActivationExtension],
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableMCP: false,
			enableLsp: false,
		});

		try {
			expect(session.getAllToolNames()).toEqual(
				expect.arrayContaining(["default_active_tool", "default_inactive_tool"]),
			);
			expect(session.getActiveToolNames()).toContain("default_active_tool");
			expect(session.getActiveToolNames()).not.toContain("default_inactive_tool");
			expect(session.systemPrompt).toContain("default_active_tool");
			expect(session.systemPrompt).not.toContain("default_inactive_tool");
		} finally {
			await session.dispose();
		}
	});

	it("allows explicitly requested defaultInactive extension tools into the initial active set", async () => {
		const tempDir = path.join(os.tmpdir(), `pi-sdk-tool-activation-${Snowflake.next()}`);
		tempDirs.push(tempDir);
		fs.mkdirSync(tempDir, { recursive: true });

		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated(),
			model: getBundledModel("openai", "gpt-4o-mini"),
			disableExtensionDiscovery: true,
			extensions: [toolActivationExtension],
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableMCP: false,
			enableLsp: false,
			toolNames: ["read", "default_inactive_tool"],
		});

		try {
			expect(session.getActiveToolNames()).toEqual(
				expect.arrayContaining(["read", "default_active_tool", "default_inactive_tool"]),
			);
			expect(session.systemPrompt).toContain("default_inactive_tool");
		} finally {
			await session.dispose();
		}
	});
});
