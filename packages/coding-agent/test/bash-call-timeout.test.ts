import { resolveToolTimeoutMs, runToolCallWithTimeout } from "omk-agent-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BUILTIN_TOOL_TIMEOUTS } from "../src/core/agent-tool-settings.ts";
import { SessionPromptLifecycle } from "../src/core/session-prompt-lifecycle.ts";
import { createBashTool, createBashToolDefinition } from "../src/core/tools/bash.ts";
import { wrapToolDefinition } from "../src/core/tools/tool-definition-wrapper.ts";

const config = { toolTimeouts: DEFAULT_BUILTIN_TOOL_TIMEOUTS };

// Landstrip registers a spread of the built-in definition with its own executor.
function landstripShapedBash() {
	const {
		renderCall: _renderCall,
		renderResult: _renderResult,
		...definition
	} = createBashToolDefinition(process.cwd());
	return wrapToolDefinition({
		...definition,
		label: "bash (extension)",
		execute: async () => ({ content: [{ type: "text" as const, text: "ok" }], details: undefined }),
	});
}

afterEach(() => vi.useRealTimers());

describe("bash call timeout", () => {
	it.each([createBashTool, landstripShapedBash])("honors 600 seconds through the tool wrapper", (create) => {
		const tool = create(process.cwd());
		const timeoutMs = resolveToolTimeoutMs(tool, config, "bash", { command: "true", timeout: 600 });
		expect(timeoutMs).toBeGreaterThan(600_000);
		expect(timeoutMs).toBeLessThanOrEqual(605_000);
	});

	it("preserves the call timeout through AgentSession's ownership wrapper", () => {
		const tool = new SessionPromptLifecycle().wrapTool(landstripShapedBash());
		expect(resolveToolTimeoutMs(tool, config, "bash", { timeout: 600 })).toBe(605_000);
	});

	it.each([undefined, 0, -1, Number.NaN, Infinity, "600"])("retains the default for timeout %s", (timeout) => {
		const tool = createBashTool(process.cwd());
		expect(resolveToolTimeoutMs(tool, config, "bash", { command: "true", timeout })).toBe(300_000);
	});

	it.each([0, 1_000])("keeps an explicit tool timeout %s above the bash argument", (timeoutMs) => {
		const tool = { ...createBashTool(process.cwd()), timeoutMs };
		expect(resolveToolTimeoutMs(tool, config, "bash", { timeout: 600 })).toBe(timeoutMs);
	});

	it("rejects requests that would overflow the executor's Node timer", () => {
		const tool = createBashTool(process.cwd());
		expect(() => resolveToolTimeoutMs(tool, config, "bash", { timeout: Number.MAX_VALUE })).toThrow(/timer range/);
		expect(resolveToolTimeoutMs(tool, config, "bash", { timeout: 2_147_483.647 })).toBe(2_147_483_647);
	});

	it("does not abort a 400-second command at the old 300-second boundary", async () => {
		vi.useFakeTimers();
		const tool = createBashTool(process.cwd(), {
			operations: {
				exec: (_command, _cwd, { signal, timeout }) =>
					new Promise((resolve, reject) => {
						expect(timeout).toBe(600);
						const timer = setTimeout(() => resolve({ exitCode: 0 }), 400_000);
						signal?.addEventListener(
							"abort",
							() => {
								clearTimeout(timer);
								reject(new Error("aborted"));
							},
							{ once: true },
						);
					}),
			},
		});
		const args = { command: "true", timeout: 600 };
		const outcome = runToolCallWithTimeout({
			toolCallId: "long-bash",
			toolName: "bash",
			timeoutMs: resolveToolTimeoutMs(tool, config, "bash", args),
			signal: undefined,
			start: (signal, update) => tool.execute("long-bash", args, signal, update),
			emitUpdate: () => {},
			emitLateSettlement: () => {},
			toErrorResult: (error) => ({ content: [{ type: "text", text: String(error) }], details: undefined }),
		});
		await vi.advanceTimersByTimeAsync(400_000);
		expect((await outcome).isError).toBe(false);
	});
});
