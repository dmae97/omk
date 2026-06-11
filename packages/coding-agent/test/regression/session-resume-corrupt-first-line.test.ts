import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionManager } from "../../src/core/session-manager.ts";

/**
 * Regression: resuming a session whose first line is corrupt (e.g. a torn
 * header) used to silently truncate the file via _rewriteFile(), destroying
 * every remaining valid entry. Recovery must never destroy user data: the
 * original file content has to be preserved as a `<file>.corrupt-*` backup
 * before the path is rewritten with a fresh header.
 */
describe("session resume with corrupt first line", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `session-corrupt-first-line-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	function findBackups(fileName: string): string[] {
		return readdirSync(tempDir).filter((f) => f.startsWith(`${fileName}.corrupt-`));
	}

	it("preserves original content in a .corrupt backup when the header line is torn", () => {
		const file = join(tempDir, "torn-header.jsonl");
		// Torn header (unparseable JSON) followed by perfectly valid entries.
		const originalContent =
			'{"type":"session","id":"abc","timesta\n' +
			'{"type":"message","id":"1","parentId":null,"timestamp":"2025-01-01T00:00:01Z","message":{"role":"user","content":"important user data","timestamp":1}}\n' +
			'{"type":"message","id":"2","parentId":"1","timestamp":"2025-01-01T00:00:02Z","message":{"role":"assistant","content":"important reply","timestamp":2}}\n';
		writeFileSync(file, originalContent);

		const sm = SessionManager.open(file, tempDir);

		// A fresh session is started at the original path
		expect(sm.getSessionFile()).toBe(file);
		expect(sm.getHeader()?.type).toBe("session");

		// The original bytes must survive in a backup file, untouched
		const backups = findBackups("torn-header.jsonl");
		expect(backups).toHaveLength(1);
		expect(readFileSync(join(tempDir, backups[0]), "utf-8")).toBe(originalContent);

		// The original path now contains only the new valid header
		const lines = readFileSync(file, "utf-8").trim().split("\n").filter(Boolean);
		expect(lines).toHaveLength(1);
		const header = JSON.parse(lines[0]);
		expect(header.type).toBe("session");
		expect(header.id).toBe(sm.getSessionId());
	});

	it("preserves content when the file has entries but no session header", () => {
		const file = join(tempDir, "no-header.jsonl");
		const originalContent =
			'{"type":"message","id":"abc","parentId":"orphaned","timestamp":"2025-01-01T00:00:00Z","message":{"role":"assistant","content":"test"}}\n';
		writeFileSync(file, originalContent);

		const sm = SessionManager.open(file, tempDir);
		expect(sm.getHeader()?.type).toBe("session");

		const backups = findBackups("no-header.jsonl");
		expect(backups).toHaveLength(1);
		expect(readFileSync(join(tempDir, backups[0]), "utf-8")).toBe(originalContent);
	});

	it("does not create a backup for an empty file", () => {
		const file = join(tempDir, "empty.jsonl");
		writeFileSync(file, "");

		const sm = SessionManager.open(file, tempDir);
		expect(sm.getHeader()?.type).toBe("session");
		expect(findBackups("empty.jsonl")).toHaveLength(0);
	});

	it("keeps distinct backups when recovery happens more than once", () => {
		const file = join(tempDir, "repeat.jsonl");
		writeFileSync(file, "garbage one\n");
		SessionManager.open(file, tempDir);

		// Corrupt the recovered file again and reopen
		writeFileSync(file, "garbage two\n");
		SessionManager.open(file, tempDir);

		const backups = findBackups("repeat.jsonl");
		expect(backups).toHaveLength(2);
		const contents = backups.map((f) => readFileSync(join(tempDir, f), "utf-8")).sort();
		expect(contents).toEqual(["garbage one\n", "garbage two\n"]);
	});
});
