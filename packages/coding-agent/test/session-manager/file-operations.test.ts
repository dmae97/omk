import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { findMostRecentSession, loadEntriesFromFile } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { nanoid } from "nanoid";

describe("loadEntriesFromFile", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = path.join(os.tmpdir(), `session-test-${nanoid()}`);
		fs.mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("returns empty array for non-existent file", async () => {
		const entries = await loadEntriesFromFile(path.join(tempDir, "nonexistent.jsonl"));
		expect(entries).toEqual([]);
	});

	it("returns empty array for empty file", async () => {
		const file = path.join(tempDir, "empty.jsonl");
		fs.writeFileSync(file, "");
		expect(await loadEntriesFromFile(file)).toEqual([]);
	});

	it("returns empty array for file without valid session header", async () => {
		const file = path.join(tempDir, "no-header.jsonl");
		fs.writeFileSync(file, '{"type":"message","id":"1"}\n');
		expect(await loadEntriesFromFile(file)).toEqual([]);
	});

	it("returns empty array for malformed JSON", async () => {
		const file = path.join(tempDir, "malformed.jsonl");
		fs.writeFileSync(file, "not json\n");
		expect(await loadEntriesFromFile(file)).toEqual([]);
	});

	it("loads valid session file", async () => {
		const file = path.join(tempDir, "valid.jsonl");
		fs.writeFileSync(
			file,
			'{"type":"session","id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n' +
				'{"type":"message","id":"1","parentId":null,"timestamp":"2025-01-01T00:00:01Z","message":{"role":"user","content":"hi","timestamp":1}}\n',
		);
		const entries = await loadEntriesFromFile(file);
		expect(entries).toHaveLength(2);
		expect(entries[0].type).toBe("session");
		expect(entries[1].type).toBe("message");
	});

	it("skips malformed lines but keeps valid ones", async () => {
		const file = path.join(tempDir, "mixed.jsonl");
		fs.writeFileSync(
			file,
			'{"type":"session","id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n' +
				"not valid json\n" +
				'{"type":"message","id":"1","parentId":null,"timestamp":"2025-01-01T00:00:01Z","message":{"role":"user","content":"hi","timestamp":1}}\n',
		);
		const entries = await loadEntriesFromFile(file);
		expect(entries).toHaveLength(2);
	});
});

describe("findMostRecentSession", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = path.join(os.tmpdir(), `session-test-${nanoid()}`);
		fs.mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("returns null for empty directory", async () => {
		expect(await findMostRecentSession(tempDir)).toBeNull();
	});

	it("returns null for non-existent directory", async () => {
		expect(await findMostRecentSession(path.join(tempDir, "nonexistent"))).toBeNull();
	});

	it("ignores non-jsonl files", async () => {
		fs.writeFileSync(path.join(tempDir, "file.txt"), "hello");
		fs.writeFileSync(path.join(tempDir, "file.json"), "{}");
		expect(await findMostRecentSession(tempDir)).toBeNull();
	});

	it("ignores jsonl files without valid session header", async () => {
		fs.writeFileSync(path.join(tempDir, "invalid.jsonl"), '{"type":"message"}\n');
		expect(await findMostRecentSession(tempDir)).toBeNull();
	});

	it("returns single valid session file", async () => {
		const file = path.join(tempDir, "session.jsonl");
		fs.writeFileSync(file, '{"type":"session","id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n');
		expect(await findMostRecentSession(tempDir)).toBe(file);
	});

	it("returns most recently modified session", async () => {
		const file1 = path.join(tempDir, "older.jsonl");
		const file2 = path.join(tempDir, "newer.jsonl");

		fs.writeFileSync(file1, '{"type":"session","id":"old","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n');
		// Small delay to ensure different mtime
		await new Promise((r) => setTimeout(r, 10));
		fs.writeFileSync(file2, '{"type":"session","id":"new","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n');

		expect(await findMostRecentSession(tempDir)).toBe(file2);
	});

	it("skips invalid files and returns valid one", async () => {
		const invalid = path.join(tempDir, "invalid.jsonl");
		const valid = path.join(tempDir, "valid.jsonl");

		fs.writeFileSync(invalid, '{"type":"not-session"}\n');
		await new Promise((r) => setTimeout(r, 10));
		fs.writeFileSync(valid, '{"type":"session","id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n');

		expect(await findMostRecentSession(tempDir)).toBe(valid);
	});
});
