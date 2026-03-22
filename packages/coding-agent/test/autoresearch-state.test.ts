import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Snowflake } from "@oh-my-pi/pi-utils";
import { isAutoresearchShCommand } from "../src/autoresearch/helpers";
import { createAutoresearchExtension } from "../src/autoresearch/index";
import { reconstructStateFromJsonl } from "../src/autoresearch/state";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	RegisteredCommand,
	SessionStartEvent,
	SessionSwitchEvent,
} from "../src/extensibility/extensions";

function makeTempDir(): string {
	const dir = path.join(os.tmpdir(), `pi-autoresearch-test-${Snowflake.next()}`);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

describe("autoresearch state reconstruction", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("reconstructs the latest segment and current metric definitions from autoresearch.jsonl", () => {
		const dir = makeTempDir();
		tempDirs.push(dir);
		const jsonlPath = path.join(dir, "autoresearch.jsonl");
		fs.writeFileSync(
			jsonlPath,
			[
				JSON.stringify({
					type: "config",
					name: "First",
					metricName: "runtime_ms",
					metricUnit: "ms",
					bestDirection: "lower",
				}),
				JSON.stringify({
					commit: "aaaaaaa",
					metric: 100,
					metrics: { memory_mb: 32 },
					status: "keep",
					description: "baseline",
					timestamp: 1,
				}),
				JSON.stringify({
					commit: "bbbbbbb",
					metric: 90,
					metrics: { memory_mb: 30 },
					status: "keep",
					description: "improved",
					timestamp: 2,
				}),
				JSON.stringify({
					type: "config",
					name: "Second",
					metricName: "throughput",
					metricUnit: "",
					bestDirection: "higher",
				}),
				JSON.stringify({
					commit: "ccccccc",
					metric: 1200,
					metrics: { latency_ms: 15 },
					status: "keep",
					description: "new baseline",
					timestamp: 3,
				}),
				JSON.stringify({
					commit: "ddddddd",
					metric: 1320,
					metrics: { latency_ms: 18 },
					status: "discard",
					description: "regressed latency",
					timestamp: 4,
				}),
			].join("\n"),
		);

		const reconstructed = reconstructStateFromJsonl(dir);
		const state = reconstructed.state;

		expect(reconstructed.hasLog).toBe(true);
		expect(state.name).toBe("Second");
		expect(state.metricName).toBe("throughput");
		expect(state.bestDirection).toBe("higher");
		expect(state.currentSegment).toBe(1);
		expect(state.bestMetric).toBe(1200);
		expect(state.results).toHaveLength(4);
		expect(state.results.filter(result => result.segment === 1)).toHaveLength(2);
		expect(state.secondaryMetrics).toEqual([{ name: "latency_ms", unit: "ms" }]);
	});
});

describe("autoresearch command guard", () => {
	it("accepts autoresearch.sh through common wrappers", () => {
		expect(isAutoresearchShCommand("bash autoresearch.sh")).toBe(true);
		expect(isAutoresearchShCommand("FOO=bar time bash ./autoresearch.sh --quick")).toBe(true);
		expect(isAutoresearchShCommand("nice -n 10 /tmp/project/autoresearch.sh")).toBe(true);
	});

	it("rejects commands where autoresearch.sh is not the first real command", () => {
		expect(isAutoresearchShCommand("python script.py && ./autoresearch.sh")).toBe(false);
		expect(isAutoresearchShCommand("echo hi; autoresearch.sh")).toBe(false);
		expect(isAutoresearchShCommand("bash -lc 'autoresearch.sh'")).toBe(false);
	});
});

interface AutoresearchCommandHarness {
	command: RegisteredCommand;
	ctx: ExtensionCommandContext;
	sentMessages: string[];
	inputCalls: Array<{ title: string; placeholder: string | undefined }>;
	notifications: Array<{ message: string; type: "info" | "warning" | "error" | undefined }>;
}

function createAutoresearchCommandHarness(cwd: string, inputResult: string | undefined): AutoresearchCommandHarness {
	const sentMessages: string[] = [];
	const inputCalls: Array<{ title: string; placeholder: string | undefined }> = [];
	const notifications: Array<{ message: string; type: "info" | "warning" | "error" | undefined }> = [];
	let command: RegisteredCommand | undefined;

	const api = {
		appendEntry(_customType: string, _data?: unknown): void {},
		on(): void {},
		registerCommand(name: string, options: Omit<RegisteredCommand, "name">): void {
			command = { name, ...options };
		},
		registerShortcut(): void {},
		registerTool(): void {},
		getActiveTools(): string[] {
			return [];
		},
		setActiveTools: async (_toolNames: string[]): Promise<void> => {},
		sendUserMessage(content: string | unknown[]): void {
			if (typeof content !== "string") {
				throw new Error("Expected autoresearch command to send plain text");
			}
			sentMessages.push(content);
		},
	} as unknown as ExtensionAPI;
	createAutoresearchExtension(api);
	if (!command) throw new Error("Expected autoresearch command to register");

	const ctx = {
		abort(): void {},
		branch: async () => ({ cancelled: false }),
		compact: async () => {},
		cwd,
		getContextUsage: () => undefined,
		hasUI: false,
		isIdle: () => true,
		model: undefined,
		modelRegistry: {},
		newSession: async () => ({ cancelled: false }),
		reload: async () => {},
		sessionManager: {
			getEntries: () => [],
			getSessionId: () => "session-1",
		},
		switchSession: async () => ({ cancelled: false }),
		navigateTree: async () => ({ cancelled: false }),
		ui: {
			confirm: async () => false,
			custom: async () => undefined,
			input: async (title: string, placeholder?: string) => {
				inputCalls.push({ title, placeholder });
				return inputResult;
			},
			notify(message: string, type?: "info" | "warning" | "error"): void {
				notifications.push({ message, type });
			},
			onTerminalInput: () => () => {},
			select: async () => undefined,
			setFooter(): void {},
			setHeader(): void {},
			setStatus(): void {},
			setTitle(): void {},
			setWidget(): void {},
			setWorkingMessage(): void {},
		},
		waitForIdle: async () => {},
	} as unknown as ExtensionCommandContext;

	return { command, ctx, sentMessages, inputCalls, notifications };
}

interface AutoresearchLifecycleHarness {
	sessionStartHandler: ((event: SessionStartEvent, ctx: ExtensionContext) => Promise<void> | void) | undefined;
	sessionSwitchHandler: ((event: SessionSwitchEvent, ctx: ExtensionContext) => Promise<void> | void) | undefined;
	ctx: ExtensionContext;
	setActiveToolsCalls: string[][];
}

function createAutoresearchLifecycleHarness(options: {
	activeTools: string[];
	controlEntries?: Array<{ type: "custom"; customType: string; data?: unknown }>;
}): AutoresearchLifecycleHarness {
	const handlers = new Map<string, (...args: unknown[]) => Promise<void> | void>();
	const activeTools = [...options.activeTools];
	const setActiveToolsCalls: string[][] = [];

	const api = {
		appendEntry(_customType: string, _data?: unknown): void {},
		on(event: string, handler: (...args: unknown[]) => Promise<void> | void): void {
			handlers.set(event, handler);
		},
		registerCommand(): void {},
		registerShortcut(): void {},
		registerTool(): void {},
		getActiveTools(): string[] {
			return [...activeTools];
		},
		async setActiveTools(toolNames: string[]): Promise<void> {
			setActiveToolsCalls.push([...toolNames]);
			activeTools.splice(0, activeTools.length, ...toolNames);
		},
		sendUserMessage(): void {},
	} as unknown as ExtensionAPI;
	createAutoresearchExtension(api);

	const ctx = {
		abort(): void {},
		compact: async () => {},
		cwd: makeTempDir(),
		getContextUsage: () => undefined,
		hasUI: false,
		hasPendingMessages: () => false,
		isIdle: () => true,
		model: undefined,
		modelRegistry: {},
		sessionManager: {
			getEntries: () => options.controlEntries ?? [],
			getSessionId: () => "session-1",
		},
		shutdown: async () => {},
		ui: {
			confirm: async () => false,
			custom: async () => undefined,
			editor: async () => undefined,
			getEditorText: () => "",
			input: async () => undefined,
			notify(): void {},
			onTerminalInput: () => () => {},
			select: async () => undefined,
			setEditorComponent(): void {},
			setEditorText(): void {},
			setFooter(): void {},
			setHeader(): void {},
			setStatus(): void {},
			setTheme: async () => false,
			setTitle(): void {},
			setToolsExpanded(): void {},
			setWidget(): void {},
			setWorkingMessage(): void {},
		},
	} as unknown as ExtensionContext;

	return {
		sessionStartHandler: handlers.get("session_start") as
			| ((event: SessionStartEvent, ctx: ExtensionContext) => Promise<void> | void)
			| undefined,
		sessionSwitchHandler: handlers.get("session_switch") as
			| ((event: SessionSwitchEvent, ctx: ExtensionContext) => Promise<void> | void)
			| undefined,
		ctx,
		setActiveToolsCalls,
	};
}

describe("autoresearch command startup", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("asks for intent and sends an initialization prompt when no autoresearch.md exists", async () => {
		const dir = makeTempDir();
		tempDirs.push(dir);
		const harness = createAutoresearchCommandHarness(dir, "reduce edit benchmark runtime variance");

		await harness.command.handler("", harness.ctx);

		expect(harness.inputCalls).toEqual([
			{ title: "Autoresearch Intent", placeholder: "what should autoresearch improve?" },
		]);
		expect(harness.sentMessages).toHaveLength(1);
		expect(harness.sentMessages[0]).toContain("Set up autoresearch for this intent:");
		expect(harness.sentMessages[0]).toContain("reduce edit benchmark runtime variance");
		expect(harness.sentMessages[0]).toContain("Explain briefly what autoresearch will do in this repository");
		expect(harness.notifications).toEqual([]);
	});

	it("resumes from autoresearch.md without asking for intent when notes already exist", async () => {
		const dir = makeTempDir();
		tempDirs.push(dir);
		const autoresearchMdPath = path.join(dir, "autoresearch.md");
		fs.writeFileSync(autoresearchMdPath, "# Autoresearch\n\nExisting notes\n");
		const harness = createAutoresearchCommandHarness(dir, "ignored");

		await harness.command.handler("", harness.ctx);

		expect(harness.inputCalls).toEqual([]);
		expect(harness.sentMessages).toEqual([
			[
				"Resume autoresearch from the attached notes.",
				"",
				`@${autoresearchMdPath}`,
				"",
				"Use the notes as the source of truth for the current direction.",
				"- inspect recent git history for context",
				"- inspect `autoresearch.jsonl` if it exists",
				"- continue the most promising unfinished branch",
				"- keep iterating until interrupted or until the configured iteration cap is reached",
			].join("\n"),
		]);
	});

	it("does not start autoresearch when the intent dialog returns blank input", async () => {
		const dir = makeTempDir();
		tempDirs.push(dir);
		const harness = createAutoresearchCommandHarness(dir, "   ");

		await harness.command.handler("", harness.ctx);

		expect(harness.sentMessages).toEqual([]);
		expect(harness.notifications).toEqual([{ message: "Autoresearch intent is required", type: "info" }]);
	});
});

describe("autoresearch lifecycle tool activation", () => {
	it("activates experiment tools when rehydrating an autoresearch session", async () => {
		const harness = createAutoresearchLifecycleHarness({
			activeTools: ["read", "write"],
			controlEntries: [{ type: "custom", customType: "autoresearch-control", data: { mode: "on", goal: "speed" } }],
		});

		if (!harness.sessionStartHandler) throw new Error("Expected session_start handler");
		await harness.sessionStartHandler({ type: "session_start" }, harness.ctx);

		expect(harness.setActiveToolsCalls).toEqual([
			["read", "write", "init_experiment", "run_experiment", "log_experiment"],
		]);
	});

	it("removes experiment tools when rehydrating a non-autoresearch session", async () => {
		const harness = createAutoresearchLifecycleHarness({
			activeTools: ["read", "init_experiment", "run_experiment", "log_experiment"],
		});

		if (!harness.sessionSwitchHandler) throw new Error("Expected session_switch handler");
		await harness.sessionSwitchHandler(
			{ type: "session_switch", reason: "resume", previousSessionFile: "/tmp/previous.jsonl" },
			harness.ctx,
		);

		expect(harness.setActiveToolsCalls).toEqual([["read"]]);
	});
});
