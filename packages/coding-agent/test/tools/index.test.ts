import { describe, expect, it } from "bun:test";
import { type SettingPath, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { createTools, HIDDEN_TOOLS, type ToolSession } from "@oh-my-pi/pi-coding-agent/tools";

Bun.env.PI_PYTHON_SKIP_CHECK = "1";

function createTestSession(overrides: Partial<ToolSession> = {}): ToolSession {
	return {
		cwd: "/tmp/test",
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated(),
		...overrides,
	};
}

function createSettingsWithOverrides(overrides: Partial<Record<SettingPath, unknown>> = {}): Settings {
	return Settings.isolated({
		"lsp.formatOnWrite": true,
		"bashInterceptor.enabled": true,
		...overrides,
	});
}

describe("createTools", () => {
	it("creates all builtin tools by default", async () => {
		const session = createTestSession();
		const tools = await createTools(session);
		const names = tools.map(t => t.name);

		// Core tools should always be present
		expect(names).toContain("python");
		expect(names).toContain("bash");
		expect(names).toContain("read");
		expect(names).toContain("edit");
		expect(names).toContain("write");
		expect(names).toContain("grep");
		expect(names).toContain("find");
		expect(names).toContain("lsp");
		expect(names).toContain("notebook");
		expect(names).toContain("task");
		expect(names).toContain("todo_write");
		expect(names).toContain("fetch");
		expect(names).toContain("web_search");
		expect(names).toContain("exit_plan_mode");
	});

	it("includes bash and python when python mode is both", async () => {
		const session = createTestSession({
			settings: createSettingsWithOverrides({
				"python.toolMode": "both",
				"python.kernelMode": "session",
			}),
		});
		const tools = await createTools(session);
		const names = tools.map(t => t.name);

		expect(names).toContain("bash");
		expect(names).toContain("python");
	});

	it("includes bash only when python mode is bash-only", async () => {
		const session = createTestSession({
			settings: createSettingsWithOverrides({
				"python.toolMode": "bash-only",
				"python.kernelMode": "session",
			}),
		});
		const tools = await createTools(session);
		const names = tools.map(t => t.name);

		expect(names).toContain("bash");
		expect(names).not.toContain("python");
	});

	it("excludes lsp tool when session disables LSP", async () => {
		const session = createTestSession({ enableLsp: false });
		const tools = await createTools(session, ["read", "lsp", "write"]);
		const names = tools.map(t => t.name);

		expect(names).toEqual(["read", "write", "exit_plan_mode"]);
	});

	it("excludes lsp tool when disabled", async () => {
		const session = createTestSession({ enableLsp: false });
		const tools = await createTools(session);
		const names = tools.map(t => t.name);

		expect(names).not.toContain("lsp");
	});

	it("respects requested tool subset", async () => {
		const session = createTestSession();
		const tools = await createTools(session, ["read", "write"]);
		const names = tools.map(t => t.name);

		expect(names).toEqual(["read", "write", "exit_plan_mode"]);
	});

	it("includes hidden tools when explicitly requested", async () => {
		const session = createTestSession();
		const tools = await createTools(session, ["report_finding"]);
		const names = tools.map(t => t.name);

		expect(names).toEqual(["report_finding", "exit_plan_mode"]);
	});

	it("includes submit_result tool when required", async () => {
		const session = createTestSession({ requireSubmitResultTool: true });
		const tools = await createTools(session);
		const names = tools.map(t => t.name);

		expect(names).toContain("submit_result");
	});

	it("excludes ask tool when hasUI is false", async () => {
		const session = createTestSession({ hasUI: false });
		const tools = await createTools(session);
		const names = tools.map(t => t.name);

		expect(names).not.toContain("ask");
	});

	it("includes ask tool when hasUI is true", async () => {
		const session = createTestSession({ hasUI: true });
		const tools = await createTools(session);
		const names = tools.map(t => t.name);

		expect(names).toContain("ask");
	});

	it("HIDDEN_TOOLS contains review tools", () => {
		expect(Object.keys(HIDDEN_TOOLS).sort()).toEqual([
			"exit_plan_mode",
			"report_finding",
			"resolve",
			"submit_result",
		]);
	});
});
