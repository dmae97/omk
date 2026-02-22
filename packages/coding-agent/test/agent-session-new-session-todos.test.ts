import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { getBundledModel } from "@oh-my-pi/pi-ai";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { TodoWriteTool } from "@oh-my-pi/pi-coding-agent/tools";
import { Snowflake } from "@oh-my-pi/pi-utils";

/**
 * Regression test: /new (AgentSession.newSession) must fully switch to a new session file
 * before the call resolves.
 *
 * If it doesn't, UI code that reloads todos immediately after /new will read the old
 * session artifact dir and keep showing stale todos.
 */
describe("AgentSession newSession clears todo artifacts", () => {
	let tempDir: string;
	let session: AgentSession;
	let sessionManager: SessionManager;

	beforeEach(async () => {
		tempDir = path.join(os.tmpdir(), `pi-new-session-todos-test-${Snowflake.next()}`);
		fs.mkdirSync(tempDir, { recursive: true });

		sessionManager = SessionManager.create(tempDir);
		const settings = Settings.isolated();
		const authStorage = await AuthStorage.create(path.join(tempDir, "testauth.db"));
		const modelRegistry = new ModelRegistry(authStorage, path.join(tempDir, "models.yml"));

		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) {
			throw new Error("Test model not found in registry");
		}

		const toolSession: ToolSession = {
			cwd: tempDir,
			hasUI: false,
			getSessionFile: () => sessionManager.getSessionFile() ?? null,
			getSessionSpawns: () => "*",
			settings,
		};

		const agent = new Agent({
			getApiKey: () => "test",
			initialState: {
				model,
				systemPrompt: "test",
				tools: [new TodoWriteTool(toolSession)],
			},
		});

		session = new AgentSession({
			agent,
			sessionManager,
			settings,
			modelRegistry,
		});

		// Must subscribe to enable session persistence hooks
		session.subscribe(() => {});
	});

	afterEach(async () => {
		if (session) {
			session.dispose();
		}
		if (tempDir && fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true });
		}
	});

	it("should not carry over todos.json to the new session", async () => {
		const oldSessionFile = session.sessionFile;
		expect(oldSessionFile).toBeDefined();

		const todoTool = new TodoWriteTool({
			cwd: tempDir,
			hasUI: false,
			getSessionFile: () => sessionManager.getSessionFile() ?? null,
			getSessionSpawns: () => "*",
			settings: session.settings,
		});

		await todoTool.execute("1", {
			ops: [{ op: "replace", phases: [{ name: "Tasks", tasks: [{ content: "do the thing" }] }] }],
		});

		const oldTodoPath = path.join(oldSessionFile!.slice(0, -6), "todos.json");
		expect(fs.existsSync(oldTodoPath)).toBe(true);

		await session.newSession();

		const newSessionFile = session.sessionFile;
		expect(newSessionFile).toBeDefined();
		expect(newSessionFile).not.toBe(oldSessionFile);

		const newTodoPath = path.join(newSessionFile!.slice(0, -6), "todos.json");
		expect(fs.existsSync(newTodoPath)).toBe(false);
	});
});
