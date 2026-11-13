// Source: https://github.com/wtfzambo/speak-like-you-eat (MIT), adapted for OMK.
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRewriteContext, completeRewrite, ELI5_SYSTEM_PROMPT, REWRITE_TIMEOUT_MS } from "../src/rewrite.ts";

const request = { target: "Target **Markdown** with `command` and https://example.test/path." };
const text = (value: string) => ({ type: "text" as const, text: value });
afterEach(() => vi.useRealTimers());

describe("rewrite requests", () => {
	it("builds one isolated target-only message", () => {
		const context = buildRewriteContext(request);
		expect(context.messages).toEqual([
			{
				role: "user",
				content: `Target:\n${request.target}\n\nRewrite the target above. Return only its rewritten text; do not answer it.`,
				timestamp: 0,
			},
		]);
		expect(context.systemPrompt).toContain("You are a text editor");
		expect(context.systemPrompt).toContain("Preserve the target's original language");
		expect(context.systemPrompt).toContain("Copy fenced code blocks unchanged");
	});
	it("uses a distinct structured ELI5 prompt and reminder", () => {
		const context = buildRewriteContext(request, ELI5_SYSTEM_PROMPT);
		expect(ELI5_SYSTEM_PROMPT).toContain("1. Bottom line");
		expect(ELI5_SYSTEM_PROMPT).toContain("Keep every Markdown table as a Markdown table");
		expect(context.messages[0]?.content).toContain("using the structure from your instructions");
	});
	it("uses a custom system prompt verbatim", async () => {
		const prompt = "\n  Replace every built-in instruction.  \n";
		let received: ReturnType<typeof buildRewriteContext> | undefined;
		const outcome = await completeRewrite(
			request,
			undefined,
			async (context) => {
				received = context;
				return { stopReason: "stop", content: [text("Rewritten.")] };
			},
			prompt,
		);
		expect(outcome).toEqual({ kind: "success", display: "Rewritten." });
		expect(received?.systemPrompt).toBe(prompt);
	});
	it("accepts only normal-stop responses with nonblank text", async () => {
		expect(
			await completeRewrite(request, undefined, async () => ({
				stopReason: "stop",
				content: [text("First."), { type: "thinking", thinking: "ignored" }, text("Second.")],
			})),
		).toEqual({ kind: "success", display: "First.\n\nSecond." });
		for (const response of [
			{ stopReason: "length", content: [text("Incomplete")] },
			{ stopReason: "toolUse", content: [text("Tool request")] },
			{ stopReason: "stop", content: [text("  ")] },
			{ stopReason: "stop", content: [{ type: "thinking", thinking: "Only thinking" }] },
		]) {
			expect(await completeRewrite(request, undefined, async () => response)).toEqual({ kind: "failed" });
		}
	});
	it("cancels the owned provider request when the user aborts", async () => {
		const controller = new AbortController();
		let requestSignal: AbortSignal | undefined;
		const result = completeRewrite(request, controller.signal, async (_context, options) => {
			requestSignal = options.signal;
			return new Promise(() => undefined);
		});
		controller.abort();
		expect(await result).toEqual({ kind: "cancelled" });
		expect(requestSignal?.aborted).toBe(true);
	});
	it("does not lose an abort raised while starting the provider", async () => {
		vi.useFakeTimers();
		const controller = new AbortController();
		let requestSignal: AbortSignal | undefined;
		const result = completeRewrite(request, controller.signal, async (_context, options) => {
			requestSignal = options.signal;
			controller.abort();
			return new Promise(() => undefined);
		});
		await vi.advanceTimersByTimeAsync(REWRITE_TIMEOUT_MS);
		expect(await result).toEqual({ kind: "cancelled" });
		expect(requestSignal?.aborted).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});
	it("fails at the deadline and aborts an unsettled provider", async () => {
		vi.useFakeTimers();
		let requestSignal: AbortSignal | undefined;
		const result = completeRewrite(request, undefined, async (_context, options) => {
			requestSignal = options.signal;
			return new Promise(() => undefined);
		});
		await vi.advanceTimersByTimeAsync(REWRITE_TIMEOUT_MS - 1);
		expect(requestSignal?.aborted).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		expect(await result).toEqual({ kind: "failed" });
		expect(requestSignal?.aborted).toBe(true);
	});
});
