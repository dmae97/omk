import { describe, expect, it } from "vitest";
import { getModel } from "../src/models.ts";
import { streamOpenAICodexMoa } from "../src/providers/openai-codex-moa.ts";
import { drainBoundedAdviser, MoaAdvisorError } from "../src/providers/openai-codex-moa-stream-limits.ts";
import type { AssistantMessage, AssistantMessageEvent, Context, StreamFunction, Usage } from "../src/types.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";

const context: Context = {
	messages: [{ role: "user", content: "Analyze this.", timestamp: 0 }],
};

function usage(input: number, output: number): Usage {
	return {
		input,
		output,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: input + output,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function message(
	model: string,
	input: number,
	output: number,
	stopReason: "stop" | "error",
	text = `${model} analysis`,
): AssistantMessage {
	return {
		role: "assistant",
		content: stopReason === "stop" ? [{ type: "text", text }] : [],
		api: "openai-codex-responses",
		provider: "openai-codex",
		model,
		usage: usage(input, output),
		stopReason,
		errorMessage: stopReason === "error" ? "private upstream detail" : undefined,
		timestamp: 0,
	};
}

function terminalStream(event: AssistantMessageEvent): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();
	queueMicrotask(() => stream.push(event));
	return stream;
}

describe("GPT-5.6 MoA usage", () => {
	it("preserves reported usage from a failed adviser", async () => {
		let calls = 0;
		const streamConcrete: StreamFunction<"openai-codex-responses"> = (model) => {
			calls++;
			if (calls === 1) {
				return terminalStream({ type: "done", reason: "stop", message: message(model.id, 1, 1, "stop") });
			}
			return terminalStream({ type: "error", reason: "error", error: message(model.id, 3, 2, "error") });
		};

		const result = await streamOpenAICodexMoa({
			model: getModel("openai-codex", "gpt-5.6-moa"),
			context,
			options: undefined,
			streamConcrete,
		}).result();

		expect(calls).toBe(2);
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toBe("MoA adviser failed");
		expect(result.usage).toMatchObject({ input: 4, output: 3, totalTokens: 7 });
	});

	it("settles the first adviser when the second stream throws synchronously", async () => {
		let calls = 0;
		let firstAborted = false;
		const streamConcrete: StreamFunction<"openai-codex-responses"> = (model, _context, options) => {
			calls++;
			if (calls === 2) throw new Error("synchronous setup failure");
			const stream = new AssistantMessageEventStream();
			options?.signal?.addEventListener("abort", () => {
				firstAborted = true;
				stream.push({ type: "error", reason: "aborted", error: message(model.id, 0, 0, "error") });
			});
			return stream;
		};

		const result = await streamOpenAICodexMoa({
			model: getModel("openai-codex", "gpt-5.6-moa"),
			context,
			options: undefined,
			streamConcrete,
		}).result();

		expect(calls).toBe(2);
		expect(firstAborted).toBe(true);
		expect(result.stopReason).toBe("error");
	});

	it("caps a terminal-only adviser message", async () => {
		const result = await drainBoundedAdviser(
			terminalStream({
				type: "done",
				reason: "stop",
				message: message("gpt-5.6-sol", 1, 1, "stop", "A".repeat(70000)),
			}),
			new AbortController(),
		);
		const text = result.content.find((content) => content.type === "text");

		expect(text?.text).toHaveLength(64000);
		expect(result.stopReason).toBe("length");
	});

	it("caps an adviser error terminal before propagating it", async () => {
		const failed = {
			...message("gpt-5.6-sol", 3, 2, "error"),
			content: [
				{ type: "text" as const, text: "E".repeat(70000) },
				{ type: "toolCall" as const, id: "call_1", name: "read", arguments: { path: "secret" } },
			],
		};

		try {
			await drainBoundedAdviser(
				terminalStream({ type: "error", reason: "error", error: failed }),
				new AbortController(),
			);
			expect.unreachable("Expected adviser failure");
		} catch (cause) {
			expect(cause).toBeInstanceOf(MoaAdvisorError);
			const adviser = (cause as MoaAdvisorError).assistantMessage;
			const text = adviser?.content.find((content) => content.type === "text");
			expect(text?.text).toHaveLength(64000);
			expect(adviser?.usage.totalTokens).toBe(5);
		}
	});

	it("rejects an adviser stream that ends without a terminal event", async () => {
		const stream = new AssistantMessageEventStream();
		queueMicrotask(() => stream.end());

		await expect(drainBoundedAdviser(stream, new AbortController())).rejects.toThrow("MoA adviser failed");
	});

	it("caps a terminal-only synthesis message", async () => {
		let calls = 0;
		const streamConcrete: StreamFunction<"openai-codex-responses"> = (model) => {
			calls++;
			const text = calls === 3 ? "S".repeat(130000) : "analysis";
			return terminalStream({
				type: "done",
				reason: "stop",
				message: message(model.id, 1, 1, "stop", text),
			});
		};

		const result = await streamOpenAICodexMoa({
			model: getModel("openai-codex", "gpt-5.6-moa"),
			context,
			options: undefined,
			streamConcrete,
		}).result();
		const text = result.content.find((content) => content.type === "text");

		expect(text?.text).toHaveLength(128000);
		expect(result.stopReason).toBe("length");
		expect(result.usage.totalTokens).toBe(6);
	});

	it("removes oversized synthesis error content while preserving usage", async () => {
		let calls = 0;
		const streamConcrete: StreamFunction<"openai-codex-responses"> = (model) => {
			calls++;
			if (calls < 3) {
				return terminalStream({ type: "done", reason: "stop", message: message(model.id, 1, 1, "stop") });
			}
			return terminalStream({
				type: "error",
				reason: "error",
				error: { ...message(model.id, 3, 2, "error"), content: [{ type: "text", text: "E".repeat(130000) }] },
			});
		};

		const result = await streamOpenAICodexMoa({
			model: getModel("openai-codex", "gpt-5.6-moa"),
			context,
			options: undefined,
			streamConcrete,
		}).result();

		expect(result.content).toEqual([]);
		expect(result.errorMessage).toBe("MoA synthesis failed");
		expect(result.usage).toMatchObject({ input: 5, output: 4, totalTokens: 9 });
	});

	it("preserves synthesis usage when a tool-call response fails closed", async () => {
		let calls = 0;
		const streamConcrete: StreamFunction<"openai-codex-responses"> = (model) => {
			calls++;
			if (calls < 3) {
				return terminalStream({ type: "done", reason: "stop", message: message(model.id, 1, 1, "stop") });
			}
			return terminalStream({
				type: "error",
				reason: "error",
				error: {
					...message(model.id, 4, 3, "error"),
					content: [{ type: "toolCall", id: "call_1", name: "read", arguments: { path: "secret" } }],
				},
			});
		};

		const result = await streamOpenAICodexMoa({
			model: getModel("openai-codex", "gpt-5.6-moa"),
			context,
			options: undefined,
			streamConcrete,
		}).result();

		expect(result.content).toEqual([]);
		expect(result.errorMessage).toBe("MoA synthesis failed");
		expect(result.usage).toMatchObject({ input: 6, output: 5, totalTokens: 11 });
	});
});
