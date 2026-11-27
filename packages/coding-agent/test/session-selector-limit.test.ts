import { describe, expect, it } from "vitest";
import type { SessionMetadata } from "../src/core/session-manager.ts";
import {
	DEFAULT_RESUME_SESSION_LIMIT,
	limitRecentSessions,
	resolveResumeSessionLimit,
} from "../src/modes/interactive/components/session-selector-loaders.ts";

function makeMeta(index: number, modifiedMs: number): SessionMetadata {
	return {
		path: `/tmp/sessions/s-${index}.jsonl`,
		id: `id-${index}`,
		cwd: "/tmp/repo",
		created: new Date(modifiedMs - 1000),
		modified: new Date(modifiedMs),
		messageCount: 2,
		firstMessage: `session ${index}`,
	};
}

describe("resume session 50-item latest-only limit", () => {
	it("defaults to 50 and caps list to the newest 50 sessions", () => {
		expect(DEFAULT_RESUME_SESSION_LIMIT).toBe(50);
		expect(resolveResumeSessionLimit({})).toBe(50);
		expect(resolveResumeSessionLimit({ OMK_RESUME_MAX_SESSIONS: "25" })).toBe(25);

		const base = Date.UTC(2026, 10, 26, 0, 0, 0);
		const raw = Array.from({ length: 72 }, (_, i) => makeMeta(i, base + i * 1000));
		// Shuffle input order to verify newest-first selection
		const shuffled = [...raw].reverse();
		const capped = limitRecentSessions(shuffled, 50);
		expect(capped).toHaveLength(50);
		expect(capped[0]?.id).toBe("id-71");
		expect(capped[49]?.id).toBe("id-22");
	});
	it("P1-02: displays initial cap notice and searches/resumes older sessions outside the cap", async () => {
		const { SessionSelectorComponent } = await import("../src/modes/interactive/components/session-selector.ts");
		const { createCappedSessionLoader } = await import(
			"../src/modes/interactive/components/session-selector-loaders.ts"
		);
		const base = Date.UTC(2026, 10, 26, 0, 0, 0);
		const withText = (m: SessionMetadata, extra = "") => ({
			...m,
			allMessagesText: `${m.firstMessage} ${extra}`.trim(),
		});
		const all = [
			withText({ ...makeMeta(0, base + 1000), firstMessage: "ancient-needle-task", name: "Ancient Needle" }),
			withText(makeMeta(1, base + 2000)),
			withText(makeMeta(2, base + 3000)),
			withText(makeMeta(3, base + 4000)),
			withText(makeMeta(4, base + 5000)),
		];
		const currentLoader = createCappedSessionLoader(async () => all, 2);
		const allLoader = createCappedSessionLoader(async () => all, 2);
		let selected: string | undefined;
		const selector = new SessionSelectorComponent(
			currentLoader,
			allLoader,
			(path) => {
				selected = path;
			},
			() => {},
			() => {},
			() => {},
		);
		// Wait for initial load
		await new Promise((resolve) => setTimeout(resolve, 25));
		const initialRender = selector.render(120).join("\n");
		expect(initialRender).toContain("Showing newest 2 of 5 sessions");
		expect(initialRender).not.toContain("ancient-needle-task");

		// Type query targeting an older session outside the initial 2-item cap
		for (const ch of "ancient-needle") selector.handleInput(ch);
		await new Promise((resolve) => setTimeout(resolve, 50));
		const afterSearch = selector.render(120).join("\n");
		expect(afterSearch).toContain("Showing all 5 sessions");
		expect(afterSearch).toContain("Ancient Needle");

		// Press Enter to resume the older session
		selector.handleInput("\r");
		expect(selected).toBe("/tmp/sessions/s-0.jsonl");
		selector.dispose();
	});
});
