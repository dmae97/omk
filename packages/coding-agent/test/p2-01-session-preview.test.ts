import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { readSessionInfo } from "../src/core/session-listing.ts";
import { SessionSelectorComponent } from "../src/modes/interactive/components/session-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const tempDirs: string[] = [];

beforeAll(() => {
	initTheme("dark", false);
});

afterEach(() => {
	while (tempDirs.length > 0) {
		const d = tempDirs.pop();
		if (d) rmSync(d, { recursive: true, force: true });
	}
});

describe("P2-01: session selector last-task and branch preview", () => {
	it("distinguishes two sessions with identical names and first prompts via last user request and branch/fork info", async () => {
		const dir = mkdtempSync(join(tmpdir(), "omk-p201-preview-"));
		tempDirs.push(dir);
		const s1Path = join(dir, "2026-11-27T01-00-00-000Z_s1.jsonl");
		const s2Path = join(dir, "2026-11-27T02-00-00-000Z_s2.jsonl");

		const writeSession = (filePath: string, lines: unknown[]) =>
			writeFileSync(filePath, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`, "utf8");

		// Session 1: linear, last request about billing refactor
		writeSession(s1Path, [
			{ type: "session", version: 3, id: "s1", timestamp: "2026-11-27T01:00:00.000Z", cwd: dir },
			{ type: "session_info", id: "n1", parentId: null, timestamp: "2026-11-27T01:00:01.000Z", name: "Fix auth" },
			{
				type: "message",
				id: "m1",
				parentId: "n1",
				timestamp: "2026-11-27T01:00:02.000Z",
				message: { role: "user", content: "Inspect auth middleware", timestamp: 1795700001000 },
			},
			{
				type: "message",
				id: "m2",
				parentId: "m1",
				timestamp: "2026-11-27T01:05:00.000Z",
				message: { role: "user", content: "Finalize Stripe webhook idempotency test", timestamp: 1795700300000 },
			},
		]);

		// Session 2: same name & first prompt, forked from s1 with 2 internal branches, last request about OAuth PKCE
		writeSession(s2Path, [
			{
				type: "session",
				version: 3,
				id: "s2",
				timestamp: "2026-11-27T02:00:00.000Z",
				cwd: dir,
				parentSession: s1Path,
			},
			{ type: "session_info", id: "n2", parentId: null, timestamp: "2026-11-27T02:00:01.000Z", name: "Fix auth" },
			{
				type: "message",
				id: "m1",
				parentId: "n2",
				timestamp: "2026-11-27T02:00:02.000Z",
				message: { role: "user", content: "Inspect auth middleware", timestamp: 1795703601000 },
			},
			{
				type: "message",
				id: "m2a",
				parentId: "m1",
				timestamp: "2026-11-27T02:01:00.000Z",
				message: { role: "user", content: "Try cookie session path", timestamp: 1795703660000 },
			},
			{
				type: "message",
				id: "m2b",
				parentId: "m1",
				timestamp: "2026-11-27T02:02:00.000Z",
				message: { role: "user", content: "Switch to OAuth PKCE refresh token flow", timestamp: 1795703720000 },
			},
		]);

		const info1 = await readSessionInfo(s1Path, { metadataOnly: true });
		const info2 = await readSessionInfo(s2Path, { metadataOnly: true });
		expect(info1?.lastUserMessage).toContain("Stripe webhook idempotency");
		expect(info1?.branchCount).toBe(1);
		expect(info2?.lastUserMessage).toContain("OAuth PKCE refresh token flow");
		expect(info2?.branchCount).toBe(2);

		const selector = new SessionSelectorComponent(
			async () => [info1!, info2!],
			async () => [info1!, info2!],
			() => {},
			() => {},
			() => {},
			() => {},
		);
		await new Promise((r) => setTimeout(r, 30));

		// First highlighted session preview shows Session 1's last user request
		const view1 = stripAnsi(selector.render(120).join("\n"));
		expect(view1).toContain("Stripe webhook idempotency");

		// Move selection down to Session 2 -> preview shows Session 2's last request + 2 branches + fork parent
		selector.handleInput("\x1b[B");
		const view2 = stripAnsi(selector.render(120).join("\n"));
		expect(view2).toContain("OAuth PKCE refresh token flow");
		expect(view2).toMatch(/2 branch|branches:\s*2/i);
		expect(view2).toMatch(/fork/i);
	});
});
