import { describe, expect, it } from "vitest";
import { CompletionSoundService } from "../src/core/completion-sound.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";

describe("long-session memory bounds", () => {
	it("bounds CompletionSoundService playedRunIds across hundreds of runs while still deduplicating recent runs", async () => {
		let bells = 0;
		const service = new CompletionSoundService({
			getSettings: () => ({ enabled: true }),
			surface: () => ({ isTui: true, isTty: true, isCi: false }),
			candidates: () => [{ backend: "terminal-bell", argv: [] }],
			io: {
				writeBell: () => {
					bells += 1;
					return true;
				},
				spawnBackend: async () => ({ ok: true }),
			},
			env: {},
		});

		for (let i = 0; i < 400; i++) {
			await service.handleSettled({ promptRunId: `run-${i}`, outcome: "completed", durationMs: 10_000 } as never);
		}
		expect(bells).toBe(400);

		// Recent run must still be deduplicated.
		const dup = await service.handleSettled({
			promptRunId: "run-399",
			outcome: "completed",
			durationMs: 10_000,
		} as never);
		expect(dup.diagnostic).toBe("already_played");
		expect(bells).toBe(400);

		// Internal dedupe set must stay bounded.
		const played = (service as unknown as { playedRunIds: Set<string> }).playedRunIds;
		expect(played.size).toBeLessThanOrEqual(256);
	});

	it("shares cached built-in tool definitions per cwd and releases render caches on ToolExecutionComponent", () => {
		const fakeTui = { requestRender() {}, terminal: { rows: 40, columns: 120 } } as never;
		const a = new ToolExecutionComponent(
			"read",
			"c1",
			{ path: "a.ts" },
			{ showImages: false },
			undefined,
			fakeTui,
			"/tmp",
		);
		const b = new ToolExecutionComponent(
			"read",
			"c2",
			{ path: "b.ts" },
			{ showImages: false },
			undefined,
			fakeTui,
			"/tmp",
		);
		a.updateResult({ content: [{ type: "text", text: "line 1\nline 2" }], isError: false }, false);
		a.render(80);

		const defA = (a as unknown as { builtInToolDefinition?: unknown }).builtInToolDefinition;
		const defB = (b as unknown as { builtInToolDefinition?: unknown }).builtInToolDefinition;
		expect(defA).toBe(defB);

		// After releaseRenderCache(), nested render caches must be cleared.
		a.releaseRenderCache();
		const contentBox = (a as unknown as { contentBox: { cache?: unknown } }).contentBox;
		const contentText = (a as unknown as { contentText: { cachedLines?: unknown } }).contentText;
		expect(contentBox.cache).toBeUndefined();
		expect(contentText.cachedLines).toBeUndefined();
	});

	it("returns defensive copies from SessionManager.getEntries while staying in sync with appends", () => {
		const sm = SessionManager.inMemory("/tmp");
		sm.appendMessage({ role: "user", content: "first", timestamp: 1 });
		const first = sm.getEntries();
		expect(first).toHaveLength(1);
		first.pop();
		expect(sm.getEntries()).toHaveLength(1);
		sm.appendMessage({ role: "user", content: "second", timestamp: 2 });
		expect(sm.getEntries()).toHaveLength(2);
	});
});
