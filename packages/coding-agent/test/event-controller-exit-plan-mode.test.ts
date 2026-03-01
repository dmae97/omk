import { describe, expect, test, vi } from "bun:test";
import { EventController } from "@oh-my-pi/pi-coding-agent/modes/controllers/event-controller";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import type { AgentSessionEvent } from "@oh-my-pi/pi-coding-agent/session/agent-session";

describe("EventController exit_plan_mode handling", () => {
	test("aborts active agent turn before opening plan approval selector", async () => {
		const callOrder: string[] = [];
		const ctx = {
			isInitialized: true,
			statusLine: { invalidate: vi.fn() },
			updateEditorTopBorder: vi.fn(),
			pendingTools: new Map<string, unknown>(),
			session: {
				abort: vi.fn(async () => {
					callOrder.push("abort");
				}),
			},
			handleExitPlanModeTool: vi.fn(async () => {
				callOrder.push("handleExitPlanModeTool");
			}),
		};

		const controller = new EventController(ctx as unknown as InteractiveModeContext);
		const event = {
			type: "tool_execution_end",
			toolCallId: "tool-1",
			toolName: "exit_plan_mode",
			result: {
				content: [{ type: "text", text: "Plan ready for approval." }],
				details: {
					planFilePath: "local://PLAN.md",
					planExists: true,
					title: "TEST_PLAN",
					finalPlanFilePath: "local://TEST_PLAN.md",
				},
			},
			isError: false,
		} satisfies AgentSessionEvent;

		await controller.handleEvent(event);

		expect(ctx.session.abort).toHaveBeenCalledTimes(1);
		expect(ctx.handleExitPlanModeTool).toHaveBeenCalledTimes(1);
		expect(callOrder).toEqual(["abort", "handleExitPlanModeTool"]);
	});
});
