import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage } from "omk-ai";
import { Container, visibleWidth } from "omk-tui";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SessionMemoryStatus } from "../src/core/session-memory.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";
import { createHarness } from "./suite/harness.ts";

const handle = Reflect.get(InteractiveMode.prototype, "handleSessionCommand");
if (typeof handle !== "function") throw new Error("missing session command");
beforeAll(() => initTheme("omk-neon-control"));
afterEach(() => vi.unstubAllEnvs());

describe("TUI session memory status", () => {
	it.each(["disabled", "empty", "ready", "unavailable", "budget-omitted"] as const)(
		"renders %s without exposing record content or enabling recall",
		async (state) => {
			const h = await createHarness();
			try {
				const status: SessionMemoryStatus = {
					state,
					eligible: 3,
					omitted: 2,
					budgetTokens: 128,
					projectedTokens: 1024,
				};
				const chatContainer = new Container();
				const requestRender = vi.fn();
				const statusRead = vi.fn(() => status);
				handle.call({
					session: {
						getSessionStats: () => h.session.getSessionStats(),
						get memoryStatus() {
							return statusRead();
						},
					},
					sessionManager: h.session.sessionManager,
					chatContainer,
					ui: { requestRender },
				});
				for (const width of [40, 80, 120]) {
					const lines = chatContainer.render(width);
					const text = stripAnsi(lines.join("\n"));
					expect(text).toContain(`Memory: ${state}`);
					expect(text).toContain("eligible=3");
					expect(text).toContain("omitted=2");
					expect(text).not.toContain("source quote");
					expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
				}
				expect(statusRead).toHaveBeenCalledTimes(1);
				expect(requestRender).toHaveBeenCalledTimes(1);
				expect(h.session.memoryStatus.state).toBe("disabled");
			} finally {
				await h.session.close();
				h.cleanup();
			}
		},
	);
	it.skipIf(process.platform === "win32")(
		"reads live AgentSession recall and revocation status through the actual session command",
		async () => {
			vi.stubEnv("OMK_VERIFIED_MEMORY", "1");
			vi.stubEnv("OMK_CONTEXT_GOVERNOR", "1");
			vi.stubEnv("OMK_MEMORY_SELECTION", "v2");
			const h = await createHarness({ persistSession: true });
			try {
				writeFileSync(join(h.tempDir, "facts.txt"), "alpha storage source quote");
				const admitted = await h.session.rememberSource({ path: "facts.txt", startLine: 1, endLine: 1 });
				if (admitted.verdict !== "accept") throw new Error("fixture admission");
				h.setResponses([fauxAssistantMessage("offline one"), fauxAssistantMessage("offline two")]);
				for (const state of ["ready", "empty"] as const) {
					await h.session.prompt("alpha storage");
					const chatContainer = new Container();
					handle.call({
						session: h.session,
						sessionManager: h.session.sessionManager,
						chatContainer,
						ui: { requestRender: vi.fn() },
					});
					const text = stripAnsi(chatContainer.render(120).join("\n"));
					expect(text).toContain(`Memory: ${state}`);
					expect(text).not.toContain("alpha storage source quote");
					expect(JSON.stringify(h.session.messages)).not.toContain("alpha storage source quote");
					await h.session.forgetMemory(admitted.recordId);
				}
			} finally {
				await h.session.close();
				h.cleanup();
			}
		},
	);
});
