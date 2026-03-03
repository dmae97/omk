import { beforeAll, describe, expect, it, vi } from "bun:test";
import type { AgentToolContext } from "@oh-my-pi/pi-agent-core";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { AskTool } from "@oh-my-pi/pi-coding-agent/tools/ask";
import { ToolAbortError } from "@oh-my-pi/pi-coding-agent/tools/tool-errors";

function createSession(overrides: Partial<ToolSession> = {}): ToolSession {
	return {
		cwd: "/tmp/test",
		hasUI: true,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated(),
		...overrides,
	};
}

function createContext(args: {
	select: (
		prompt: string,
		options: string[],
		dialogOptions?: {
			initialIndex?: number;
			timeout?: number;
			signal?: AbortSignal;
			outline?: boolean;
			onTimeout?: () => void;
			onLeft?: () => void;
			onRight?: () => void;
		},
	) => Promise<string | undefined>;
	input?: (
		prompt: string,
		dialogOptions?: {
			timeout?: number;
			signal?: AbortSignal;
			onTimeout?: () => void;
		},
	) => Promise<string | undefined>;
	abort?: () => void;
}): AgentToolContext {
	// AgentToolContext includes many runtime fields; tests only need UI + abort behavior.
	return {
		hasUI: true,
		ui: {
			select: args.select,
			input: (
				prompt: string,
				_placeholder: string | undefined,
				dialogOptions?: {
					timeout?: number;
					signal?: AbortSignal;
					onTimeout?: () => void;
				},
			) => args.input?.(prompt, dialogOptions) ?? Promise.resolve(undefined),
		},
		abort: args.abort ?? (() => {}),
	} as unknown as AgentToolContext;
}

beforeAll(async () => {
	await initTheme(false);
});

describe("AskTool cancellation", () => {
	it("aborts the turn when the user cancels selection", async () => {
		const tool = new AskTool(createSession());
		const abort = vi.fn();
		const context = createContext({
			select: async () => undefined,
			abort,
		});

		expect(
			tool.execute(
				"call-1",
				{
					questions: [
						{
							id: "confirm",
							question: "Proceed?",
							options: [{ label: "yes" }, { label: "no" }],
						},
					],
				},
				undefined,
				undefined,
				context,
			),
		).rejects.toBeInstanceOf(ToolAbortError);
		expect(abort).toHaveBeenCalledTimes(1);
	});

	it("still aborts when user explicitly cancels with timeout configured", async () => {
		const tool = new AskTool(
			createSession({
				settings: Settings.isolated({ "ask.timeout": 30 }),
			}),
		);
		const abort = vi.fn();
		const context = createContext({
			select: async () => undefined,
			abort,
		});

		expect(
			tool.execute(
				"call-timeout-cancel",
				{
					questions: [
						{
							id: "confirm",
							question: "Proceed?",
							options: [{ label: "yes" }, { label: "no" }],
						},
					],
				},
				undefined,
				undefined,
				context,
			),
		).rejects.toBeInstanceOf(ToolAbortError);
		expect(abort).toHaveBeenCalledTimes(1);
	});
	it("auto-selects the recommended option on ask timeout", async () => {
		const tool = new AskTool(
			createSession({
				settings: Settings.isolated({ "ask.timeout": 0.001 }),
			}),
		);
		const abort = vi.fn();
		const select = vi.fn(
			async (
				_prompt: string,
				options: string[],
				dialogOptions?: { initialIndex?: number; timeout?: number; onTimeout?: () => void },
			) => {
				const timeout = dialogOptions?.timeout ?? 1;
				await Bun.sleep(timeout + 5);
				dialogOptions?.onTimeout?.();
				return options[dialogOptions?.initialIndex ?? 0];
			},
		);
		const context = createContext({
			select,
			abort,
		});

		const result = await tool.execute(
			"call-2",
			{
				questions: [
					{
						id: "confirm",
						question: "Proceed?",
						options: [{ label: "yes" }, { label: "no" }],
						recommended: 1,
					},
				],
			},
			undefined,
			undefined,
			context,
		);

		expect(result.content[0]?.type).toBe("text");
		if (result.content[0]?.type !== "text") {
			throw new Error("Expected text result");
		}
		expect(result.content[0].text).toContain("User selected: no");
		expect(result.details?.selectedOptions).toEqual(["no"]);
		expect(abort).not.toHaveBeenCalled();
		expect(select).toHaveBeenCalledTimes(1);
		expect(select.mock.calls[0]?.[2]?.initialIndex).toBe(1);
		expect(select.mock.calls[0]?.[2]?.timeout).toBeGreaterThan(0);
	});

	it("auto-selects the first option when timeout elapses without a selected option", async () => {
		const tool = new AskTool(
			createSession({
				settings: Settings.isolated({ "ask.timeout": 0.001 }),
			}),
		);
		const abort = vi.fn();
		const context = createContext({
			select: async (_prompt, _options, dialogOptions) => {
				const timeout = dialogOptions?.timeout ?? 1;
				await Bun.sleep(timeout + 5);
				dialogOptions?.onTimeout?.();
				return undefined;
			},
			abort,
		});

		const result = await tool.execute(
			"call-timeout-none",
			{
				questions: [
					{
						id: "confirm",
						question: "Proceed?",
						options: [{ label: "yes" }, { label: "no" }],
					},
				],
			},
			undefined,
			undefined,
			context,
		);

		expect(result.content[0]?.type).toBe("text");
		if (result.content[0]?.type !== "text") {
			throw new Error("Expected text result");
		}
		expect(result.content[0].text).toContain("User selected: yes");
		expect(result.details?.selectedOptions).toEqual(["yes"]);
		expect(abort).not.toHaveBeenCalled();
	});

	it("does not abort when custom input times out after selecting Other", async () => {
		const tool = new AskTool(
			createSession({
				settings: Settings.isolated({ "ask.timeout": 0.001 }),
			}),
		);
		const abort = vi.fn();
		const input = vi.fn(async (_prompt: string, dialogOptions?: { timeout?: number; onTimeout?: () => void }) => {
			const timeout = dialogOptions?.timeout ?? 1;
			await Bun.sleep(timeout + 5);
			dialogOptions?.onTimeout?.();
			return undefined;
		});
		const context = createContext({
			select: async () => "Other (type your own)",
			input,
			abort,
		});

		const result = await tool.execute(
			"call-timeout-input",
			{
				questions: [
					{
						id: "confirm",
						question: "Proceed?",
						options: [{ label: "yes" }, { label: "no" }],
					},
				],
			},
			undefined,
			undefined,
			context,
		);

		expect(result.content[0]?.type).toBe("text");
		if (result.content[0]?.type !== "text") {
			throw new Error("Expected text result");
		}
		expect(result.content[0].text).toContain("User selected: yes");
		expect(result.details?.selectedOptions).toEqual(["yes"]);
		expect(input).toHaveBeenCalledTimes(1);
		expect(abort).not.toHaveBeenCalled();
	});
	it("does not prompt for custom input when timeout resolves to Other in multi-select", async () => {
		const tool = new AskTool(
			createSession({
				settings: Settings.isolated({ "ask.timeout": 0.001 }),
			}),
		);
		const abort = vi.fn();
		const input = vi.fn(async () => "should-not-be-used");
		const context = createContext({
			select: async (_prompt, _options, dialogOptions) => {
				const timeout = dialogOptions?.timeout ?? 1;
				await Bun.sleep(timeout + 5);
				dialogOptions?.onTimeout?.();
				return "Other (type your own)";
			},
			input,
			abort,
		});

		const result = await tool.execute(
			"call-timeout-other-multi",
			{
				questions: [
					{
						id: "confirm",
						question: "Proceed?",
						options: [{ label: "yes" }, { label: "no" }],
						multi: true,
					},
				],
			},
			undefined,
			undefined,
			context,
		);

		expect(result.content[0]?.type).toBe("text");
		if (result.content[0]?.type !== "text") {
			throw new Error("Expected text result");
		}
		expect(result.content[0].text).toContain("User selected: yes");
		expect(result.details?.selectedOptions).toEqual(["yes"]);
		expect(result.details?.customInput).toBeUndefined();
		expect(input).not.toHaveBeenCalled();
		expect(abort).not.toHaveBeenCalled();
	});
	it("aborts multi-question ask when any question is explicitly cancelled", async () => {
		const tool = new AskTool(createSession());
		const abort = vi.fn();
		const context = createContext({
			select: async prompt => {
				if (prompt.includes("First")) return "one";
				return undefined;
			},
			abort,
		});

		expect(
			tool.execute(
				"call-3",
				{
					questions: [
						{
							id: "first",
							question: "First",
							options: [{ label: "one" }, { label: "two" }],
						},
						{
							id: "second",
							question: "Second",
							options: [{ label: "alpha" }, { label: "beta" }],
						},
					],
				},
				undefined,
				undefined,
				context,
			),
		).rejects.toBeInstanceOf(ToolAbortError);
		expect(abort).toHaveBeenCalledTimes(1);
	});
});

describe("AskTool multi-question navigation", () => {
	const questions = [
		{
			id: "first",
			question: "First?",
			options: [{ label: "one" }, { label: "two" }],
		},
		{
			id: "second",
			question: "Second?",
			options: [{ label: "alpha" }, { label: "beta" }],
		},
		{
			id: "third",
			question: "Third?",
			options: [{ label: "red" }, { label: "blue" }],
		},
	];

	it("keeps back unavailable on the first question and supports returning from later questions", async () => {
		const tool = new AskTool(createSession());
		const firstQuestionOptions: string[][] = [];
		let firstVisits = 0;
		let secondVisits = 0;
		const context = createContext({
			select: async (prompt, options, dialogOptions) => {
				if (prompt.includes("First?")) {
					firstQuestionOptions.push(options);
					firstVisits += 1;
					if (firstVisits === 1) return "one";
					dialogOptions?.onRight?.();
					return undefined;
				}
				if (prompt.includes("Second?")) {
					secondVisits += 1;
					if (secondVisits === 1) {
						dialogOptions?.onLeft?.();
						return undefined;
					}
					return "alpha";
				}
				dialogOptions?.onRight?.();
				return undefined;
			},
		});

		const result = await tool.execute("call-nav-1", { questions }, undefined, undefined, context);
		expect(result.details?.results?.[0]?.selectedOptions).toEqual(["one"]);
		expect(result.details?.results?.[1]?.selectedOptions).toEqual(["alpha"]);
		expect(firstQuestionOptions[0]).not.toContain("← Back");
		expect(firstQuestionOptions[1]).not.toContain("← Back");
	});

	it("allows forward action on the last question", async () => {
		const tool = new AskTool(createSession());
		const context = createContext({
			select: async (prompt, _options, dialogOptions) => {
				if (prompt.includes("First?")) return "one";
				if (prompt.includes("Second?")) return "alpha";
				dialogOptions?.onRight?.();
				return undefined;
			},
		});

		const result = await tool.execute("call-nav-2", { questions }, undefined, undefined, context);
		expect(result.details?.results?.[2]?.selectedOptions).toEqual([]);
		expect(result.details?.results?.[2]?.customInput).toBeUndefined();
	});

	it("persists state when changing an earlier answer and continuing", async () => {
		const tool = new AskTool(createSession());
		let firstVisits = 0;
		let secondVisits = 0;
		let thirdVisits = 0;
		const context = createContext({
			select: async (prompt, _options, dialogOptions) => {
				if (prompt.includes("First?")) {
					firstVisits += 1;
					if (firstVisits === 1) return "one";
					return "two";
				}
				if (prompt.includes("Second?")) {
					secondVisits += 1;
					if (secondVisits === 1) return "alpha";
					if (secondVisits === 2) {
						dialogOptions?.onLeft?.();
						return undefined;
					}
					dialogOptions?.onRight?.();
					return undefined;
				}
				if (prompt.includes("Third?")) {
					thirdVisits += 1;
					if (thirdVisits === 1) {
						dialogOptions?.onLeft?.();
						return undefined;
					}
					dialogOptions?.onRight?.();
					return undefined;
				}
				return undefined;
			},
		});

		const result = await tool.execute("call-nav-3", { questions }, undefined, undefined, context);
		expect(result.details?.results?.[0]?.selectedOptions).toEqual(["two"]);
		expect(result.details?.results?.[1]?.selectedOptions).toEqual(["alpha"]);
	});

	it("handles timeout with navigation and allows revisiting timed-out questions", async () => {
		const tool = new AskTool(
			createSession({
				settings: Settings.isolated({ "ask.timeout": 0.001 }),
			}),
		);
		let secondVisits = 0;
		let thirdVisits = 0;
		const context = createContext({
			select: async (prompt, _options, dialogOptions) => {
				if (prompt.includes("First?")) return "one";
				if (prompt.includes("Second?")) {
					secondVisits += 1;
					if (secondVisits === 1) {
						await Bun.sleep(5);
						dialogOptions?.onTimeout?.();
						return undefined;
					}
					return "beta";
				}
				if (prompt.includes("Third?")) {
					thirdVisits += 1;
					if (thirdVisits === 1) {
						dialogOptions?.onLeft?.();
						return undefined;
					}
					dialogOptions?.onRight?.();
					return undefined;
				}
				return undefined;
			},
		});

		const result = await tool.execute("call-nav-4", { questions }, undefined, undefined, context);
		expect(result.details?.results?.[0]?.selectedOptions).toEqual(["one"]);
		expect(result.details?.results?.[1]?.selectedOptions).toEqual(["beta"]);
		expect(result.details?.results?.[2]?.selectedOptions).toEqual([]);
	});
});
