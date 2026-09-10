import type { ImageContent } from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PromptSettledEvent } from "../src/core/prompt-settlement.ts";
import { classifySessionTermination } from "../src/index.ts";
import { runPrintMode } from "../src/modes/print-mode.ts";
import { createAssistantMessage, createRuntimeHost } from "./print-mode-fixtures.ts";

const printIo = vi.hoisted(() => ({ output: [] as string[] }));

vi.mock("../src/core/output-guard.js", () => ({
	flushRawStdout: vi.fn(async () => {}),
	writeRawStdout: (text: string) => printIo.output.push(text),
}));

afterEach(() => {
	printIo.output = [];
	vi.restoreAllMocks();
});

describe("runPrintMode", () => {
	it.each(["text", "json"] as const)(
		"waits for final settlement after a recovered attempt in %s mode",
		async (mode) => {
			const runtimeHost = createRuntimeHost(createAssistantMessage({ text: "recovered" }));
			const transient = classifySessionTermination({
				sessionId: "fixture",
				runId: "retry",
				timestamp: "2026-09-09T00:00:00.000Z",
				source: "observed",
				message: "Temporary network failure.",
				cause: { area: "provider", code: "network" },
				sideEffects: "none",
			});
			runtimeHost.session.subscribe.mockImplementation(
				(
					listener: (
						event: PromptSettledEvent | { type: "session_termination"; termination: typeof transient },
					) => void,
				) => {
					runtimeHost.session.prompt.mockImplementationOnce(async () => {
						listener({ type: "session_termination", termination: transient });
						listener({ type: "prompt_settled", promptRunId: "fixture", outcome: "completed", durationMs: 1 });
					});
					return () => {};
				},
			);
			vi.spyOn(console, "error").mockImplementation(() => {});
			expect(
				await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
					mode,
					initialMessage: "fixture",
				}),
			).toBe(0);
		},
	);

	it.each(["text", "json"] as const)(
		"stops after a failed prompt instead of hiding it with later success in %s mode",
		async (mode) => {
			const runtimeHost = createRuntimeHost(
				createAssistantMessage({ stopReason: "error", errorMessage: "fixture failure" }),
			);
			runtimeHost.session.prompt
				.mockImplementationOnce(async () => {})
				.mockImplementationOnce(async () => {
					runtimeHost.session.state.messages = [createAssistantMessage({ text: "later success" })];
				});
			vi.spyOn(console, "error").mockImplementation(() => {});
			const exitCode = await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
				mode,
				initialMessage: "first",
				messages: ["must not run"],
			});
			expect(exitCode).toBe(1);
			expect(runtimeHost.session.prompt).toHaveBeenCalledTimes(1);
		},
	);

	it.each(["text", "json"] as const)(
		"honors failed settlement despite success-shaped assistant content in %s mode",
		async (mode) => {
			const runtimeHost = createRuntimeHost(createAssistantMessage({ text: "partial result" }));
			runtimeHost.session.subscribe.mockImplementation((listener: (event: PromptSettledEvent) => void) => {
				runtimeHost.session.prompt.mockImplementationOnce(async () => {
					listener({ type: "prompt_settled", promptRunId: "fixture", outcome: "failed", durationMs: 1 });
				});
				return () => {};
			});
			vi.spyOn(console, "error").mockImplementation(() => {});
			const exitCode = await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
				mode,
				initialMessage: "fixture",
			});
			expect(exitCode).toBe(1);
		},
	);

	it("emits session_shutdown in text mode", async () => {
		const runtimeHost = createRuntimeHost(createAssistantMessage({ text: "done" }));
		const { session } = runtimeHost;
		const images: ImageContent[] = [{ type: "image", mimeType: "image/png", data: "abc" }];

		const exitCode = await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
			mode: "text",
			initialMessage: "Say done",
			initialImages: images,
		});

		expect(exitCode).toBe(0);
		expect(session.prompt).toHaveBeenCalledWith("Say done", { images });
		expect(session.extensionRunner.emit).toHaveBeenCalledTimes(1);
		expect(session.extensionRunner.emit).toHaveBeenCalledWith({ type: "session_shutdown", reason: "quit" });
	});

	it("emits session_shutdown in json mode", async () => {
		const runtimeHost = createRuntimeHost(createAssistantMessage({ text: "done" }));
		const { session } = runtimeHost;

		const exitCode = await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
			mode: "json",
			messages: ["hello"],
		});

		expect(exitCode).toBe(0);
		expect(session.prompt).toHaveBeenCalledWith("hello");
		expect(session.extensionRunner.emit).toHaveBeenCalledTimes(1);
		expect(session.extensionRunner.emit).toHaveBeenCalledWith({ type: "session_shutdown", reason: "quit" });
	});

	it("Given provider_auth, When text print fails, Then it renders the typed termination instead of the generic error", async () => {
		const termination = classifySessionTermination({
			sessionId: "session-1",
			runId: "run-auth",
			timestamp: "2026-07-17T00:00:00.000Z",
			source: "observed",
			message: "Authentication expired.",
			cause: { area: "provider", code: "auth" },
			sideEffects: "none",
			provider: "openai",
			model: "gpt-test",
		});
		const runtimeHost = createRuntimeHost(
			createAssistantMessage({ stopReason: "error", errorMessage: "generic failure" }),
			termination,
		);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const exitCode = await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
			mode: "text",
			// Image-only prompt: satisfies the no-prompt guard while keeping promptStarted
			// false so the startup lastTermination is rendered (typed-termination path).
			initialImages: [{ type: "image", mimeType: "image/png", data: "abc" }],
		});

		expect(exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledTimes(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("message=Authentication expired."));
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("kind=provider_auth"));
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("provider/model=openai/gpt-test"));
		expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining("generic failure"));
	});

	it("Given a stale prior termination, When a new prompt rejects, Then text print does not reuse the stale error", async () => {
		const stale = classifySessionTermination({
			sessionId: "session-1",
			runId: "run-stale",
			timestamp: "2026-07-17T00:00:00.000Z",
			source: "observed",
			message: "Old authentication failure.",
			cause: { area: "provider", code: "auth" },
			sideEffects: "none",
		});
		const runtimeHost = createRuntimeHost(createAssistantMessage({ text: "prior response" }), stale);
		runtimeHost.session.prompt.mockRejectedValueOnce(new Error("current prompt failure"));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const exitCode = await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
			mode: "text",
			initialMessage: "new prompt",
		});

		expect(exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith("current prompt failure");
		expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining("run-stale"));
	});

	it.each([
		{ label: "tool_timeout", cause: { area: "tool", code: "timeout" } as const, kind: "tool_timeout" },
		{
			label: "generic internal error fallback",
			cause: { area: "internal", code: "unclassified" } as const,
			kind: "internal_error",
		},
	])("Given $label, When text print fails, Then it renders the current typed termination", async ({ cause, kind }) => {
		const termination = classifySessionTermination({
			sessionId: "session-1",
			runId: `run-${kind}`,
			timestamp: "2026-07-17T00:00:00.000Z",
			source: "observed",
			message: `Diagnostic for ${kind}.`,
			cause,
			sideEffects: "possible",
		});
		const runtimeHost = createRuntimeHost(
			createAssistantMessage({ stopReason: "error", errorMessage: "generic failure" }),
			termination,
		);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
			mode: "text",
			// Image-only prompt: satisfies the no-prompt guard while keeping promptStarted
			// false so the startup lastTermination is rendered (typed-termination path).
			initialImages: [{ type: "image", mimeType: "image/png", data: "abc" }],
		});

		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(`kind=${kind}`));
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(`message=Diagnostic for ${kind}.`));
		expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining("generic failure"));
	});

	it("Given an inferred process_crash, When JSON print starts, Then it emits the typed startup termination", async () => {
		const termination = classifySessionTermination({
			sessionId: "session-1",
			runId: "run-crash",
			timestamp: "2026-07-17T00:00:00.000Z",
			source: "inferred_on_resume",
			message: "The previous process exited without a terminal record.",
			cause: { area: "process", code: "crash" },
			sideEffects: "possible",
		});
		const runtimeHost = createRuntimeHost(createAssistantMessage({ text: "prior response" }), termination);

		await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], { mode: "json" });

		expect(printIo.output.map((line) => JSON.parse(line))).toContainEqual({
			type: "session_termination",
			termination,
		});
	});

	it("emits session_shutdown and returns non-zero on assistant error", async () => {
		const runtimeHost = createRuntimeHost(
			createAssistantMessage({ stopReason: "error", errorMessage: "provider failure" }),
		);
		const { session } = runtimeHost;
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const exitCode = await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
			mode: "text",
			initialMessage: "trigger the assistant error",
		});

		expect(exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith("provider failure");
		expect(session.extensionRunner.emit).toHaveBeenCalledTimes(1);
		expect(session.extensionRunner.emit).toHaveBeenCalledWith({ type: "session_shutdown", reason: "quit" });
	});
});
