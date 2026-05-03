import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { afterEach, describe, expect, it } from "vitest";
import { JsonlSessionTreeStorage, loadJsonlSessionInfo } from "../../src/harness/session/jsonl-session-storage.js";
import { InMemorySessionTreeStorage } from "../../src/harness/session/memory-session-storage.js";
import { DefaultSessionTree } from "../../src/harness/session/session-tree.js";
import type { MessageEntry, SessionInfo, SessionTreeStorage } from "../../src/harness/types.js";

function createUserMessage(text: string): AgentMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	};
}

function createAssistantMessage(text: string): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

const tempDirs: string[] = [];

function createTempDir(): string {
	const dir = join(tmpdir(), `pi-agent-session-tree-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop()!;
		if (existsSync(dir)) {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

async function runSessionTreeSuite(
	name: string,
	createStorage: () => SessionTreeStorage | Promise<SessionTreeStorage>,
	inspect?: () => void,
) {
	describe(name, () => {
		it("appends messages and builds context in order", async () => {
			const tree = new DefaultSessionTree(await createStorage());
			await tree.appendMessage(createUserMessage("one"));
			await tree.appendMessage(createAssistantMessage("two"));
			const context = await tree.buildContext();
			expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
		});

		it("tracks model and thinking level changes", async () => {
			const tree = new DefaultSessionTree(await createStorage());
			await tree.appendMessage(createUserMessage("one"));
			await tree.appendModelChange("openai", "gpt-4.1");
			await tree.appendThinkingLevelChange("high");
			const context = await tree.buildContext();
			expect(context.thinkingLevel).toBe("high");
			expect(context.model).toEqual({ provider: "openai", modelId: "gpt-4.1" });
		});

		it("supports branching by moving the leaf and appending a new branch", async () => {
			const tree = new DefaultSessionTree(await createStorage());
			const user1 = await tree.appendMessage(createUserMessage("one"));
			const assistant1 = await tree.appendMessage(createAssistantMessage("two"));
			await tree.appendMessage(createUserMessage("three"));
			await tree.moveTo(user1);
			await tree.appendMessage(createAssistantMessage("branched"));
			const branch = await tree.getBranch();
			expect(branch.map((entry) => entry.id)).toContain(user1);
			expect(branch.map((entry) => entry.id)).not.toContain(assistant1);
			const context = await tree.buildContext();
			expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
		});

		it("supports moving the leaf to root", async () => {
			const tree = new DefaultSessionTree(await createStorage());
			await tree.appendMessage(createUserMessage("one"));
			await tree.moveTo(null);
			expect(await tree.getLeafId()).toBeNull();
			expect((await tree.buildContext()).messages).toEqual([]);
		});

		it("reconstructs compaction summaries in context", async () => {
			const tree = new DefaultSessionTree(await createStorage());
			await tree.appendMessage(createUserMessage("one"));
			await tree.appendMessage(createAssistantMessage("two"));
			const user2 = await tree.appendMessage(createUserMessage("three"));
			await tree.appendMessage(createAssistantMessage("four"));
			await tree.appendCompaction("summary", user2, 1234);
			await tree.appendMessage(createUserMessage("five"));
			const context = await tree.buildContext();
			expect(context.messages[0]?.role).toBe("compactionSummary");
			expect(context.messages).toHaveLength(4);
		});

		it("supports branch summary entries in context", async () => {
			const tree = new DefaultSessionTree(await createStorage());
			const user1 = await tree.appendMessage(createUserMessage("one"));
			await tree.appendBranchSummary(user1, "summary text");
			const context = await tree.buildContext();
			expect(context.messages[1]?.role).toBe("branchSummary");
		});

		it("supports custom message entries in context", async () => {
			const tree = new DefaultSessionTree(await createStorage());
			await tree.appendMessage(createUserMessage("one"));
			await tree.appendCustomMessageEntry("custom", "hello", true, { ok: true });
			const context = await tree.buildContext();
			expect(context.messages[1]?.role).toBe("custom");
		});

		it("supports labels and session info entries without affecting context", async () => {
			const tree = new DefaultSessionTree(await createStorage());
			const user1 = await tree.appendMessage(createUserMessage("one"));
			await tree.appendLabelChange(user1, "checkpoint");
			await tree.appendSessionInfo("name");
			const entries = await tree.getEntries();
			expect(entries.some((entry) => entry.type === "label")).toBe(true);
			expect(entries.some((entry) => entry.type === "session_info")).toBe(true);
			expect(await tree.getLabel(user1)).toBe("checkpoint");
			expect(await tree.getSessionName()).toBe("name");
			expect((await tree.buildContext()).messages).toHaveLength(1);
		});

		it("persists leaf changes and appended entries via storage", async () => {
			const storage = await createStorage();
			const tree = new DefaultSessionTree(storage);
			const user1 = await tree.appendMessage(createUserMessage("one"));
			await tree.appendMessage(createAssistantMessage("two"));
			await tree.appendLabelChange(user1, "checkpoint");
			await tree.appendSessionInfo("name");
			await tree.moveTo(user1);
			await tree.appendMessage(createAssistantMessage("branched"));
			const tree2 = new DefaultSessionTree(storage);
			const context = await tree2.buildContext();
			expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
			expect(await tree2.getLabel(user1)).toBe("checkpoint");
			expect(await tree2.getSessionName()).toBe("name");
			inspect?.();
		});
	});
}

describe("InMemorySessionTreeStorage", () => {
	it("returns configured session info", async () => {
		const sessionInfo: SessionInfo = { id: "session-1", createdAt: "2026-01-01T00:00:00.000Z" };
		const storage = new InMemorySessionTreeStorage({ sessionInfo });
		expect(await storage.getSessionInfo()).toEqual(sessionInfo);
	});

	it("copies initial entries and tracks leaf independently", async () => {
		const entry: MessageEntry = {
			type: "message",
			id: "entry-1",
			parentId: null,
			timestamp: "2026-01-01T00:00:00.000Z",
			message: createUserMessage("one"),
		};
		const initialEntries = [entry];
		const storage = new InMemorySessionTreeStorage({ entries: initialEntries });
		initialEntries.push({ ...entry, id: "entry-2" });
		expect((await storage.getEntries()).map((storedEntry) => storedEntry.id)).toEqual(["entry-1"]);
		expect(await storage.getLeafId()).toBe("entry-1");
		await storage.setLeafId(null);
		expect(await storage.getLeafId()).toBeNull();
	});

	it("rejects invalid leaf ids", async () => {
		const storage = new InMemorySessionTreeStorage();
		await expect(storage.setLeafId("missing")).rejects.toThrow("Entry missing not found");
		expect(() => new InMemorySessionTreeStorage({ leafId: "missing" })).toThrow("Entry missing not found");
	});

	it("walks paths to root", async () => {
		const root: MessageEntry = {
			type: "message",
			id: "root",
			parentId: null,
			timestamp: "2026-01-01T00:00:00.000Z",
			message: createUserMessage("root"),
		};
		const child: MessageEntry = {
			...root,
			id: "child",
			parentId: "root",
			message: createAssistantMessage("child"),
		};
		const storage = new InMemorySessionTreeStorage({ entries: [root, child] });
		expect((await storage.getPathToRoot("child")).map((entry) => entry.id)).toEqual(["root", "child"]);
		expect(await storage.getPathToRoot(null)).toEqual([]);
	});
});

runSessionTreeSuite("SessionTree with in-memory storage", () => new InMemorySessionTreeStorage());

describe("JsonlSessionTreeStorage", () => {
	it("throws for missing files when opening", async () => {
		const dir = createTempDir();
		const filePath = join(dir, "session.jsonl");
		await expect(JsonlSessionTreeStorage.open(filePath)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("writes the header before the first appended entry", async () => {
		const dir = createTempDir();
		const filePath = join(dir, "session.jsonl");
		const storage = await JsonlSessionTreeStorage.create(filePath, { cwd: dir, sessionId: "session-1" });
		expect(existsSync(filePath)).toBe(false);
		expect(await storage.getLeafId()).toBeNull();
		expect(await storage.getEntries()).toEqual([]);
		await storage.appendEntry({
			type: "message",
			id: "user-1",
			parentId: null,
			timestamp: "2026-01-01T00:00:00.000Z",
			message: createUserMessage("one"),
		});
		expect(existsSync(filePath)).toBe(true);
		const lines = readFileSync(filePath, "utf8").trim().split("\n");
		expect(JSON.parse(lines[0]!).type).toBe("session");
		expect(JSON.parse(lines[1]!).id).toBe("user-1");
		expect(lines).toHaveLength(2);
	});

	it("throws for malformed session headers", async () => {
		const dir = createTempDir();
		const filePath = join(dir, "session.jsonl");
		writeFileSync(filePath, "not json\n");
		await expect(JsonlSessionTreeStorage.open(filePath)).rejects.toThrow("first line is not a valid session header");
	});

	it("ignores malformed entry lines", async () => {
		const dir = createTempDir();
		const filePath = join(dir, "session.jsonl");
		const header = {
			type: "session",
			version: 3,
			id: "session-1",
			timestamp: "2026-01-01T00:00:00.000Z",
			cwd: dir,
		};
		const entry: MessageEntry = {
			type: "message",
			id: "entry-1",
			parentId: null,
			timestamp: "2026-01-01T00:00:00.000Z",
			message: createUserMessage("one"),
		};
		writeFileSync(filePath, `${JSON.stringify(header)}\nnot json\n${JSON.stringify(entry)}\n`);
		const storage = await JsonlSessionTreeStorage.open(filePath);
		expect((await storage.getEntries()).map((loadedEntry) => loadedEntry.id)).toEqual(["entry-1"]);
		expect(await storage.getLeafId()).toBe("entry-1");
	});

	it("creates and reads session info from the header", async () => {
		const dir = createTempDir();
		const filePath = join(dir, "session.jsonl");
		const storage = await JsonlSessionTreeStorage.create(filePath, {
			cwd: dir,
			sessionId: "session-1",
			parentSessionPath: "/tmp/parent.jsonl",
		});
		const info = await storage.getSessionInfo();
		expect(info).toMatchObject({
			id: "session-1",
			cwd: dir,
			path: filePath,
			parentSessionPath: "/tmp/parent.jsonl",
		});
		expect(existsSync(filePath)).toBe(false);
		await storage.appendEntry({
			type: "message",
			id: "user-1",
			parentId: null,
			timestamp: "2026-01-01T00:00:00.000Z",
			message: createUserMessage("one"),
		});
		expect(await loadJsonlSessionInfo(filePath)).toEqual(info);
	});

	it("loads existing entries and reconstructs leaf", async () => {
		const dir = createTempDir();
		const filePath = join(dir, "session.jsonl");
		const storage = await JsonlSessionTreeStorage.create(filePath, { cwd: dir, sessionId: "session-1" });
		const root: MessageEntry = {
			type: "message",
			id: "root",
			parentId: null,
			timestamp: "2026-01-01T00:00:00.000Z",
			message: createUserMessage("root"),
		};
		const child: MessageEntry = {
			...root,
			id: "child",
			parentId: "root",
			message: createAssistantMessage("child"),
		};
		await storage.appendEntry(root);
		await storage.appendEntry(child);
		const loaded = await JsonlSessionTreeStorage.open(filePath);
		expect(await loaded.getLeafId()).toBe("child");
		expect((await loaded.getEntries()).map((entry) => entry.id)).toEqual(["root", "child"]);
		expect((await loaded.getPathToRoot("child")).map((entry) => entry.id)).toEqual(["root", "child"]);
	});

	it("reads session info from only the first JSONL line", async () => {
		const dir = createTempDir();
		const filePath = join(dir, "session.jsonl");
		const header = {
			type: "session",
			version: 3,
			id: "session-1",
			timestamp: "2026-01-01T00:00:00.000Z",
			cwd: dir,
		};
		const malformedSecondLine = "{".repeat(10000);
		writeFileSync(filePath, `${JSON.stringify(header)}\n${malformedSecondLine}\n`);
		expect(await loadJsonlSessionInfo(filePath)).toEqual({
			id: "session-1",
			createdAt: "2026-01-01T00:00:00.000Z",
			cwd: dir,
			path: filePath,
			parentSessionPath: undefined,
		});
	});
});

runSessionTreeSuite(
	"SessionTree with JSONL storage",
	async () => {
		const dir = createTempDir();
		return await JsonlSessionTreeStorage.create(join(dir, "session.jsonl"), { cwd: dir, sessionId: "session-1" });
	},
	() => {
		const dir = tempDirs[tempDirs.length - 1]!;
		const filePath = join(dir, "session.jsonl");
		const lines = readFileSync(filePath, "utf8").trim().split("\n");
		expect(lines.length).toBeGreaterThan(1);
		const header = JSON.parse(lines[0]!);
		expect(header.type).toBe("session");
		expect(header.version).toBe(3);
		for (const line of lines.slice(1)) {
			const entry = JSON.parse(line);
			expect(entry.type).not.toBe("entry");
			expect(entry.type).not.toBe("leaf");
			expect(typeof entry.id).toBe("string");
		}
	},
);
