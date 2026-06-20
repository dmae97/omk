import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	DEFAULT_SESSION_DIGEST_MAX_CHARS,
	DEFAULT_SESSION_FIRST_MESSAGE_MAX_CHARS,
} from "../src/core/session-digest.ts";
import { SessionManager } from "../src/core/session-manager.ts";

function messageLine(role: "user" | "assistant", content: string, timestamp: number): string {
	return `${JSON.stringify({
		type: "message",
		id: `${role}-${timestamp}`,
		parentId: null,
		timestamp: new Date(timestamp).toISOString(),
		message: { role, content, timestamp },
	})}\n`;
}

describe("session search digest", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "omk-session-digest-"));
		mkdirSync(join(tempDir, "sessions"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	function writeSession(lines: string[]): string {
		const sessionPath = join(tempDir, "sessions", "session.jsonl");
		const header = `${JSON.stringify({
			type: "session",
			version: 3,
			id: "digest-session",
			timestamp: "2026-01-01T00:00:00.000Z",
			cwd: tempDir,
		})}\n`;
		writeFileSync(sessionPath, header + lines.join(""));
		return sessionPath;
	}

	it("bounds allMessagesText for huge sessions while keeping first and recent prompts", async () => {
		writeSession([
			messageLine("user", "FIRSTNEEDLE start", 1),
			messageLine("assistant", "x".repeat(DEFAULT_SESSION_DIGEST_MAX_CHARS * 2), 2),
			messageLine("user", "LASTNEEDLE finish", 3),
		]);

		const sessions = await SessionManager.list(tempDir, join(tempDir, "sessions"));
		expect(sessions).toHaveLength(1);
		const session = sessions[0]!;
		expect(session.allMessagesText.length).toBeLessThanOrEqual(DEFAULT_SESSION_DIGEST_MAX_CHARS);
		expect(session.allMessagesText).toContain("FIRSTNEEDLE");
		expect(session.allMessagesText).toContain("LASTNEEDLE");
	});

	it("preserves legacy joined text for small sessions", async () => {
		writeSession([messageLine("user", "small one", 1), messageLine("assistant", "small two", 2)]);

		const sessions = await SessionManager.list(tempDir, join(tempDir, "sessions"));
		expect(sessions[0]!.allMessagesText).toBe("small one small two");
	});

	it("keeps firstMessage from the first user message", async () => {
		writeSession([messageLine("assistant", "assistant first", 1), messageLine("user", "first user", 2)]);

		const sessions = await SessionManager.list(tempDir, join(tempDir, "sessions"));
		expect(sessions[0]!.firstMessage).toBe("first user");
	});

	it("bounds firstMessage for huge first user prompts", async () => {
		writeSession([
			messageLine("user", `FIRSTTITLE-${"x".repeat(DEFAULT_SESSION_FIRST_MESSAGE_MAX_CHARS * 2)}-TAIL`, 1),
			messageLine("assistant", "response", 2),
		]);

		const sessions = await SessionManager.list(tempDir, join(tempDir, "sessions"));
		const session = sessions[0]!;
		expect(session.firstMessage.length).toBeLessThanOrEqual(DEFAULT_SESSION_FIRST_MESSAGE_MAX_CHARS);
		expect(session.firstMessage).toContain("FIRSTTITLE");
		expect(session.firstMessage).toContain("omk-first-message:truncated");
		expect(session.firstMessage).not.toContain("-TAIL");
	});
});
