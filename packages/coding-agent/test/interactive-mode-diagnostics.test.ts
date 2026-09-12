import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { Container } from "omk-tui";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { classifySessionTermination } from "../src/core/session-termination.ts";
import type { SessionTermination } from "../src/core/session-termination-types.ts";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const debug = Reflect.get(InteractiveMode.prototype, "handleDebugCommand");
const showTermination = Reflect.get(InteractiveMode.prototype, "showSessionTermination");
const setupSubmit = Reflect.get(InteractiveMode.prototype, "setupEditorSubmitHandler");
if (typeof debug !== "function" || typeof showTermination !== "function" || typeof setupSubmit !== "function") {
	throw new Error("Missing interactive command adapters");
}
const roots: string[] = [];
const canary = "PRIVATE_TRANSCRIPT_CANARY";
function output(container: Container): string {
	return stripVTControlCharacters(container.render(120).join("\n"));
}
function context() {
	return {
		chatContainer: new Container(),
		ui: { terminal: { columns: 120, rows: 40 }, render: vi.fn(() => [canary]), requestRender: vi.fn() },
		session: { messages: [{ role: "user", content: canary }], isStreaming: false, isCompacting: false },
		showError: vi.fn(),
		lastRenderedTermination: undefined as SessionTermination | undefined,
		toolOutputExpanded: false,
	};
}
function failure(runId = "run-1") {
	return classifySessionTermination({
		sessionId: "session-1",
		runId,
		timestamp: "2026-09-12T00:00:00.000Z",
		source: "observed",
		message: "Provider unavailable",
		cause: { area: "provider", code: "network" },
		sideEffects: "possible",
	});
}

beforeAll(() => initTheme("dark"));
afterEach(() => {
	vi.unstubAllEnvs();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("TUI diagnostics public adapters", () => {
	it("previews diagnostics without saving private transcript or rendering the conversation", () => {
		const root = mkdtempSync(join(tmpdir(), "omk-diagnostics-adapter-"));
		roots.push(root);
		vi.stubEnv("OMK_CODING_AGENT_DIR", root);
		const ctx = context();
		debug.call(ctx);
		expect(readdirSync(root)).toEqual([]);
		expect(ctx.ui.render).not.toHaveBeenCalled();
		expect(output(ctx.chatContainer)).toContain("OMK diagnostics");
		expect(output(ctx.chatContainer)).toContain("/debug save");
		expect(output(ctx.chatContainer)).not.toContain(canary);
	});

	it("makes diagnostics discoverable as a built-in command", () => {
		expect(BUILTIN_SLASH_COMMANDS.some((command) => command.name === "debug")).toBe(true);
	});

	it("routes debug subcommands locally rather than queueing them for the model", async () => {
		const ctx = {
			defaultEditor: { onSubmit: undefined as ((text: string) => Promise<void>) | undefined },
			editor: { setText: vi.fn(), addToHistory: vi.fn() },
			session: { isStreaming: false, isCompacting: false },
			pendingPromptPayloads: [],
			flushPendingBashComponents: vi.fn(),
			handleDebugCommand: vi.fn(),
		};
		setupSubmit.call(ctx);
		await ctx.defaultEditor.onSubmit?.("/debug save");
		expect(ctx.handleDebugCommand).toHaveBeenCalledWith("save");
		expect(ctx.pendingPromptPayloads).toEqual([]);
	});

	it("renders cause, impact and next action before expandable technical details", () => {
		const ctx = context();
		const termination = failure();
		showTermination.call(ctx, termination);
		expect(ctx.showError).not.toHaveBeenCalled();
		const text = output(ctx.chatContainer);
		expect(text).toContain("Provider connection failed");
		expect(text).toContain("Cause:");
		expect(text).toContain("Impact:");
		expect(text).toContain("Next:");
		expect(text).toContain("/debug");
		expect(text).not.toContain("kind=provider_network");
	});

	it("coalesces duplicate delivery but keeps separate failed attempts", () => {
		const ctx = context();
		const termination = failure();
		showTermination.call(ctx, termination);
		const count = ctx.chatContainer.children.length;
		expect(count).toBeGreaterThan(0);
		showTermination.call(ctx, { ...termination });
		expect(ctx.chatContainer.children).toHaveLength(count);
		showTermination.call(ctx, failure("run-2"));
		expect(ctx.chatContainer.children.length).toBeGreaterThan(count);
	});
});
