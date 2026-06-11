import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NodeExecutionEnv } from "../../src/harness/env/nodejs.ts";
import { JsonlSessionStorage } from "../../src/harness/session/jsonl-storage.ts";
import type { MessageEntry } from "../../src/harness/types.ts";
import { createTempDir, createUserMessage } from "../harness/session-test-utils.ts";

function makeHeader(cwd: string): string {
	return JSON.stringify({
		type: "session",
		version: 3,
		id: "session-1",
		timestamp: "2026-01-01T00:00:00.000Z",
		cwd,
	});
}

function makeEntry(id: string, parentId: string | null): MessageEntry {
	return {
		type: "message",
		id,
		parentId,
		timestamp: "2026-01-01T00:00:00.000Z",
		message: createUserMessage(id),
	};
}

describe("JsonlSessionStorage torn trailing line recovery", () => {
	it("opens a session whose final line is a torn partial append", async () => {
		const dir = createTempDir();
		const env = new NodeExecutionEnv({ cwd: dir });
		const filePath = join(dir, "session.jsonl");
		const root = makeEntry("root", null);
		const child = makeEntry("child", "root");
		// Simulate a crash mid-append: the last line is a truncated JSON entry
		// without a trailing newline.
		writeFileSync(
			filePath,
			`${makeHeader(dir)}\n${JSON.stringify(root)}\n${JSON.stringify(child)}\n{"type":"message","id":"torn`,
		);
		const storage = await JsonlSessionStorage.open(env, filePath);
		expect((await storage.getEntries()).map((entry) => entry.id)).toEqual(["root", "child"]);
		expect(await storage.getLeafId()).toBe("child");
	});

	it("does not concatenate a new entry onto the torn line on append", async () => {
		const dir = createTempDir();
		const env = new NodeExecutionEnv({ cwd: dir });
		const filePath = join(dir, "session.jsonl");
		const root = makeEntry("root", null);
		writeFileSync(filePath, `${makeHeader(dir)}\n${JSON.stringify(root)}\n{"type":"message","id":"torn`);
		const storage = await JsonlSessionStorage.open(env, filePath);
		await storage.appendEntry(makeEntry("next", "root"));
		// Every line in the repaired file must be valid JSON again.
		const lines = readFileSync(filePath, "utf8").trim().split("\n");
		expect(lines.map((line) => JSON.parse(line).id)).toEqual(["session-1", "root", "next"]);
		const reloaded = await JsonlSessionStorage.open(env, filePath);
		expect((await reloaded.getEntries()).map((entry) => entry.id)).toEqual(["root", "next"]);
		expect(await reloaded.getLeafId()).toBe("next");
	});

	it("repairs a missing final newline before appending a valid tail entry", async () => {
		const dir = createTempDir();
		const env = new NodeExecutionEnv({ cwd: dir });
		const filePath = join(dir, "session.jsonl");
		const root = makeEntry("root", null);
		// The final entry is complete JSON but the trailing newline byte was lost.
		writeFileSync(filePath, `${makeHeader(dir)}\n${JSON.stringify(root)}`);
		const storage = await JsonlSessionStorage.open(env, filePath);
		expect((await storage.getEntries()).map((entry) => entry.id)).toEqual(["root"]);
		await storage.appendEntry(makeEntry("next", "root"));
		const reloaded = await JsonlSessionStorage.open(env, filePath);
		expect((await reloaded.getEntries()).map((entry) => entry.id)).toEqual(["root", "next"]);
	});

	it("still rejects malformed lines in the middle of the file", async () => {
		const dir = createTempDir();
		const env = new NodeExecutionEnv({ cwd: dir });
		const filePath = join(dir, "session.jsonl");
		const root = makeEntry("root", null);
		writeFileSync(filePath, `${makeHeader(dir)}\nnot json\n${JSON.stringify(root)}\n`);
		await expect(JsonlSessionStorage.open(env, filePath)).rejects.toMatchObject({ code: "invalid_entry" });
	});
});
