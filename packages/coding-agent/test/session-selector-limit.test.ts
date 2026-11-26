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
});
