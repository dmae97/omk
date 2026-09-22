import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSessionInfo } from "../src/core/session-listing.ts";
import { SessionManager } from "../src/core/session-manager.ts";

let root: string;
let dir: string;
const message = (text: string, timestamp: number, role = "user") =>
	JSON.stringify({
		type: "message",
		id: `m${timestamp}`,
		parentId: null,
		timestamp: new Date(timestamp).toISOString(),
		message: { role, content: [{ type: "text", text }], timestamp },
	});
function session(name: string, cwd = root) {
	const path = join(dir, `${name}.jsonl`);
	writeFileSync(
		path,
		`${JSON.stringify({ type: "session", version: 3, id: name, cwd, timestamp: new Date(1000).toISOString() })}\n${message("first prompt", 2000)}\n`,
	);
	return path;
}
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "omk-session-metadata-"));
	dir = join(root, "sessions");
	mkdirSync(dir);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("session metadata listing", () => {
	it("omits retained full text only when explicitly requested and keeps legacy API results", async () => {
		for (let i = 0; i < 4; i++) {
			const path = session(`s${i}`);
			for (let j = 0; j < 20; j++)
				appendFileSync(path, `${message(`tail-${i}-${j} ${"x".repeat(4096)}`, 3000 + j, "assistant")}\n`);
		}
		const full = await SessionManager.list(root, dir);
		const metadata = await SessionManager.list(root, dir, undefined, { metadataOnly: true });
		expect(metadata.every((info) => !("allMessagesText" in info))).toBe(true);
		expect(metadata).toEqual(full.map(({ allMessagesText: _text, ...info }) => info));
		expect(metadata).toHaveLength(4);
		expect(full.every((info) => info.allMessagesText.includes("tail-"))).toBe(true);
		expect(JSON.stringify(metadata).length).toBeLessThan(JSON.stringify(full).length / 20);
	});

	it("preserves cwd filtering, all-scope ordering, progress and malformed-tail behavior", async () => {
		const path = session("here");
		session("other", join(root, "elsewhere"));
		appendFileSync(path, `${message("latest text", 4000, "assistant")}\n{"unfinished":`);
		const progress: number[] = [];
		const local = await SessionManager.list(root, dir, (loaded) => progress.push(loaded), { metadataOnly: true });
		expect(local.map((info) => info.id)).toEqual(["here"]);
		expect(local[0].messageCount).toBe(2);
		expect(local[0].modified.getTime()).toBe(4000);
		expect(progress).toEqual([1, 2]);
		const all = await SessionManager.listAll(dir, undefined, { metadataOnly: true });
		expect(all.map((info) => info.id)).toEqual(["here", "other"]);
		expect(all.every((info) => !("allMessagesText" in info))).toBe(true);
	});

	it("handles a large single entry and cancelled reads without publishing partial text", async () => {
		const path = session("large");
		appendFileSync(path, `${message(`${"한글".repeat(100_000)} last-token`, 3000, "assistant")}\n`);
		const info = await readSessionInfo(path);
		expect(info?.allMessagesText.endsWith("last-token")).toBe(true);
		const metadata = await readSessionInfo(path, { metadataOnly: true });
		expect(metadata?.messageCount).toBe(2);
		expect(metadata && "allMessagesText" in metadata).toBe(false);
		const controller = new AbortController();
		const pending = readSessionInfo(path, { signal: controller.signal });
		controller.abort();
		expect(await pending).toBeNull();
	});

	it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
		"reports an unreadable source as unavailable",
		async () => {
			const path = session("denied");
			chmodSync(path, 0o000);
			try {
				expect(await readSessionInfo(path)).toBeNull();
			} finally {
				chmodSync(path, 0o600);
			}
		},
	);

	it("reads appended content and renamed metadata from the source rather than a sidecar", async () => {
		const path = session("source");
		const before = await SessionManager.list(root, dir, undefined, { metadataOnly: true });
		appendFileSync(
			path,
			`${JSON.stringify({ type: "session_info", name: "renamed" })}\n${message("appended", 5000)}\n`,
		);
		writeFileSync(`${path}.index`, "not a valid index");
		const after = await SessionManager.list(root, dir, undefined, { metadataOnly: true });
		expect(after[0].name).toBe("renamed");
		expect(after[0].messageCount).toBe(before[0].messageCount + 1);
		expect((await SessionManager.list(root, dir))[0].allMessagesText).toContain("appended");
	});
});
