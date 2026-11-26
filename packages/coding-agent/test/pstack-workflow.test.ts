import { describe, expect, it } from "vitest";
import { createEventBus } from "../src/core/event-bus.ts";
import { createExtensionRuntime, loadExtensionFromFactory } from "../src/core/extensions/loader.ts";
import type { CommandRunner } from "../src/core/git-branch-manager.ts";
import { createPstackWorkflowExtension } from "../src/core/pstack-workflow-extension.ts";

function makeFakeRunner(): {
	runner: CommandRunner;
	calls: Array<{ file: string; args: readonly string[] }>;
} {
	let currentBranch = "main";
	const calls: Array<{ file: string; args: readonly string[] }> = [];
	const runner: CommandRunner = async (file, args) => {
		calls.push({ file, args });
		if (file === "git" && args[0] === "rev-parse" && args[1] === "--show-toplevel") {
			return { exitCode: 0, stdout: "/repo\n", stderr: "" };
		}
		if (file === "git" && args[0] === "symbolic-ref") {
			return { exitCode: 0, stdout: `${currentBranch}\n`, stderr: "" };
		}
		if (file === "git" && args[0] === "status") return { exitCode: 0, stdout: "", stderr: "" };
		if (file === "git" && args[0] === "for-each-ref") {
			return { exitCode: 0, stdout: `*\t${currentBranch}\t\t\n \tfeat/other\t\t\n`, stderr: "" };
		}
		if (file === "git" && args[0] === "worktree" && args[1] === "list") {
			return { exitCode: 0, stdout: `worktree /repo\nHEAD abc\nbranch refs/heads/${currentBranch}\n\n`, stderr: "" };
		}
		if (file === "git" && args[0] === "show-ref") return { exitCode: 1, stdout: "", stderr: "" };
		if (file === "git" && args[0] === "switch") {
			currentBranch = args[1] === "-c" ? (args[2] ?? currentBranch) : (args[1] ?? currentBranch);
			return { exitCode: 0, stdout: "", stderr: "" };
		}
		if (file === "herdr" && args[0] === "pane" && args[1] === "split") {
			return { exitCode: 0, stdout: '{"result":{"pane":{"pane_id":"pane-77"}}}', stderr: "" };
		}
		return { exitCode: 0, stdout: "", stderr: "" };
	};
	return { runner, calls };
}

async function setupHarness(
	env: NodeJS.ProcessEnv = {},
	initialEntries: Array<{ type: string; customType?: string; data?: unknown }> = [],
) {
	const runtime = createExtensionRuntime();
	let activeTools = ["read", "bash", "edit", "write", "grep", "todo"];
	const sentMessages: Array<{ customType: string; content: string }> = [];
	const entries = [...initialEntries];
	runtime.getActiveTools = () => [...activeTools];
	runtime.setActiveTools = (tools) => {
		activeTools = [...tools];
	};
	runtime.sendMessage = (msg) => {
		sentMessages.push({ customType: msg.customType, content: String(msg.content) });
	};
	runtime.appendEntry = (customType, data) => {
		entries.push({ type: "custom", customType, data });
	};

	const statuses = new Map<string, string | undefined>();
	const widgets = new Map<string, string[] | undefined>();
	const notifications: Array<{ msg: string; level?: string }> = [];
	let nextSelect: string | undefined;
	let nextInput: string | undefined;
	let selectCalls = 0;
	let lastEditorInitial: string | undefined;

	const ctx = {
		cwd: "/repo",
		hasUI: true,
		mode: "tui",
		sessionManager: { getEntries: () => entries, getCwd: () => "/repo" },
		ui: {
			setStatus: (key: string, text: string | undefined) => statuses.set(key, text),
			setWidget: (key: string, content: string[] | undefined) => widgets.set(key, content),
			notify: (msg: string, level?: string) => notifications.push({ msg, level }),
			select: async () => {
				selectCalls += 1;
				return nextSelect;
			},
			input: async () => nextInput,
			editor: async (_title: string, initial?: string) => {
				lastEditorInitial = initial;
				return undefined;
			},
			confirm: async () => true,
			theme: {
				fg: (_color: string, text: string) => text,
				bold: (text: string) => text,
				strikethrough: (text: string) => text,
			},
		},
	};

	const fake = makeFakeRunner();
	const ext = await loadExtensionFromFactory(
		createPstackWorkflowExtension({ runner: fake.runner, env }),
		"/repo",
		createEventBus(),
		runtime,
		"<builtin:pstack-workflow>",
	);

	return {
		ext,
		ctx,
		statuses,
		widgets,
		notifications,
		sentMessages,
		entries,
		calls: fake.calls,
		getActiveTools: () => activeTools,
		setNextSelect: (value: string | undefined) => {
			nextSelect = value;
		},
		setNextInput: (value: string | undefined) => {
			nextInput = value;
		},
		getSelectCalls: () => selectCalls,
		getLastEditorInitial: () => lastEditorInitial,
		fire: async (name: string, event: unknown) => {
			let last: unknown;
			for (const h of ext.handlers.get(name) ?? []) last = await h(event as never, ctx as never);
			return last;
		},
	};
}

describe("pstack-workflow extension", () => {
	it("stays inert when idle (G0 hash preservation) and exposes /plan and /branch", async () => {
		const h = await setupHarness();
		expect([...h.ext.commands.keys()].sort()).toEqual(["branch", "plan"]);
		expect([...h.ext.shortcuts.keys()]).toContain("ctrl+alt+p");

		await h.fire("session_start", { reason: "startup" });
		expect(await h.fire("before_agent_start", { prompt: "hello", systemPrompt: "sys" })).toBeUndefined();
		expect(h.statuses.get("plan")).toBeUndefined();
		expect(h.statuses.get("branch")).toContain("main");
	});

	it("enforces read-only planning in /plan, restores tools on execution, and tracks [DONE:n]", async () => {
		const h = await setupHarness();
		await h.fire("session_start", { reason: "startup" });

		await h.ext.commands.get("plan")!.handler("feature add branch ui", h.ctx as never);
		expect(h.getActiveTools()).toEqual(["read", "bash", "grep", "todo"]);
		expect(h.statuses.get("plan")).toContain("plan:feature");

		expect(await h.fire("tool_call", { toolName: "edit", input: {} })).toMatchObject({ block: true });
		expect(await h.fire("tool_call", { toolName: "bash", input: { command: "rm -rf foo" } })).toMatchObject({
			block: true,
		});
		expect(await h.fire("tool_call", { toolName: "bash", input: { command: "git status" } })).toBeUndefined();
		expect(await h.fire("before_agent_start", { prompt: "plan it", systemPrompt: "sys" })).toMatchObject({
			message: { customType: "pstack-plan-context" },
		});

		h.setNextSelect("Execute plan on current branch");
		await h.fire("agent_end", {
			messages: [
				{
					role: "assistant",
					content: [
						{ type: "text", text: "Data Shape: PlanState union\n\nPlan:\n1. Build reducer\n2. Add tests" },
					],
				},
			],
		});

		expect(h.getActiveTools()).toEqual(["read", "bash", "edit", "write", "grep", "todo"]);
		expect(h.statuses.get("plan")).toContain("0/2");
		expect(h.widgets.get("pstack-plan")?.join("\n")).toContain("Build reducer");

		await h.fire("turn_end", {
			message: { role: "assistant", content: [{ type: "text", text: "Done first [DONE:1]" }] },
		});
		expect(h.statuses.get("plan")).toContain("1/2");

		await h.fire("turn_end", {
			message: { role: "assistant", content: [{ type: "text", text: "Done second [DONE:2]" }] },
		});
		await h.fire("agent_end", { messages: [] });
		expect(h.statuses.get("plan")).toBeUndefined();
		expect(h.widgets.get("pstack-plan")).toBeUndefined();
		expect(h.sentMessages.some((m) => m.customType === "pstack-plan-complete")).toBe(true);
	});

	it("switches branches via /branch and opens a Herdr worktree pane after planning when HERDR_ENV=1", async () => {
		const h = await setupHarness({
			HERDR_ENV: "1",
			HERDR_PANE_ID: "pane-1",
			HERDR_SOCKET_PATH: "/tmp/herdr.sock",
		});
		await h.fire("session_start", { reason: "startup" });
		expect(h.statuses.get("branch")).toContain("herdr");

		await h.ext.commands.get("branch")!.handler("switch feat/other", h.ctx as never);
		expect(h.statuses.get("branch")).toContain("feat/other");

		await h.ext.commands.get("plan")!.handler("bug-fix isolate branch", h.ctx as never);
		h.setNextSelect("Create worktree + Herdr pane");
		h.setNextInput("fix/herdr-pane");
		await h.fire("agent_end", {
			messages: [{ role: "assistant", content: [{ type: "text", text: "Plan:\n1. Fix issue" }] }],
		});
		expect(h.calls.some((c) => c.file === "herdr" && c.args[1] === "split")).toBe(true);
		expect(h.notifications.some((n) => n.msg.includes("pane-77"))).toBe(true);
	});

	it("restores persisted planning state on session_start and re-applies read-only tool filter", async () => {
		const h = await setupHarness({}, [
			{
				type: "custom",
				customType: "pstack-plan-state",
				data: {
					phase: "planning",
					playbook: "refactoring",
					goal: "split parser",
					steps: [{ step: 1, text: "Extract parser", done: false }],
					savedTools: ["read", "bash", "edit", "write"],
				},
			},
		]);
		await h.fire("session_start", { reason: "resume" });
		expect(h.getActiveTools()).toEqual(["read", "bash"]);
		expect(h.statuses.get("plan")).toBe("plan:refactoring (ro)");
		expect(h.widgets.get("pstack-plan")?.join("\n")).toContain("Extract parser");
	});

	it("blocks alternate shell/patch tools, suppresses premature modal when 0 steps, pre-fills refine editor, and supports /plan done", async () => {
		const h = await setupHarness();
		await h.fire("session_start", { reason: "startup" });
		await h.ext.commands.get("plan")!.handler("feature harden plan", h.ctx as never);

		expect(await h.fire("tool_call", { toolName: "hypa_shell", input: { command: "rm -rf /tmp/x" } })).toMatchObject({
			block: true,
		});
		expect(await h.fire("tool_call", { toolName: "hypa_shell", input: { command: "rg foo src" } })).toBeUndefined();
		expect(await h.fire("tool_call", { toolName: "lean-ctx__ctx_patch", input: {} })).toMatchObject({ block: true });

		// Clarifying question with 0 steps must not pop up the action modal.
		await h.fire("agent_end", {
			messages: [{ role: "assistant", content: [{ type: "text", text: "Which branch should we target?" }] }],
		});
		expect(h.getSelectCalls()).toBe(0);

		// Once steps exist, Refine plan pre-fills editor with current draft.
		h.setNextSelect("Refine plan");
		await h.fire("agent_end", {
			messages: [
				{
					role: "assistant",
					content: [
						{ type: "text", text: "## Data Shape\nGuardPolicy\n\n## Plan\n1. Tighten guards\n2. Add tests" },
					],
				},
			],
		});
		expect(h.getSelectCalls()).toBe(1);
		expect(h.getLastEditorInitial()).toContain("1. Tighten guards");

		// Execute and manually complete steps via /plan done.
		await h.ext.commands.get("plan")!.handler("run", h.ctx as never);
		expect(h.statuses.get("plan")).toBe("plan:feature 0/2");
		await h.ext.commands.get("plan")!.handler("done 1", h.ctx as never);
		expect(h.statuses.get("plan")).toBe("plan:feature 1/2");
		await h.ext.commands.get("plan")!.handler("done 2", h.ctx as never);
		expect(h.statuses.get("plan")).toBeUndefined();
	});
});
