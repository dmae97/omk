import { describe, expect, it } from "bun:test";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";

describe("SessionManager usage statistics", () => {
	it("accumulates premium requests from assistant messages and task tool results", () => {
		const session = SessionManager.inMemory();

		session.appendMessage({ role: "user", content: "hello", timestamp: 1 });
		session.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "hi" }],
			api: "openai-completions",
			provider: "github-copilot",
			model: "gpt-4o",
			usage: {
				input: 10,
				output: 5,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 15,
				premiumRequests: 1,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: 2,
		});
		session.appendMessage({
			role: "toolResult",
			toolCallId: "task_1",
			toolName: "task",
			content: [{ type: "text", text: "task output" }],
			details: {
				usage: {
					input: 2,
					output: 3,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 5,
					premiumRequests: 2,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			},
			isError: false,
			timestamp: 3,
		});

		const usage = session.getUsageStatistics();
		expect(usage.input).toBe(12);
		expect(usage.output).toBe(8);
		expect(usage.premiumRequests).toBe(3);
	});

	it("preserves fractional premium request multipliers", () => {
		const session = SessionManager.inMemory();

		session.appendMessage({ role: "user", content: "hello", timestamp: 1 });
		session.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "haiku" }],
			api: "anthropic-messages",
			provider: "github-copilot",
			model: "claude-haiku-4.5",
			usage: {
				input: 10,
				output: 5,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 15,
				premiumRequests: 0.33,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: 2,
		});
		session.appendMessage({
			role: "toolResult",
			toolCallId: "task_1",
			toolName: "task",
			content: [{ type: "text", text: "task output" }],
			details: {
				usage: {
					input: 2,
					output: 3,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 5,
					premiumRequests: 3,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			},
			isError: false,
			timestamp: 3,
		});

		const usage = session.getUsageStatistics();
		expect(usage.premiumRequests).toBeCloseTo(3.33, 8);
	});
	it("defaults premium requests to zero when usage payload omits the field", () => {
		const session = SessionManager.inMemory();

		session.appendMessage({ role: "user", content: "hello", timestamp: 1 });
		session.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "hi" }],
			api: "openai-completions",
			provider: "openai",
			model: "gpt-4o",
			usage: {
				input: 10,
				output: 5,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 15,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: 2,
		});

		const usage = session.getUsageStatistics();
		expect(usage.premiumRequests).toBe(0);
	});
});
