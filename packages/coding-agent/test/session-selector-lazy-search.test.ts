import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setKeybindings } from "omk-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SessionSelectorComponent } from "../src/modes/interactive/components/session-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

let root: string;
let dir: string;
const message = (text: string) =>
	JSON.stringify({
		type: "message",
		timestamp: new Date(2000).toISOString(),
		message: { role: "user", content: text, timestamp: 2000 },
	});
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "omk-lazy-search-"));
	dir = join(root, "sessions");
	mkdirSync(dir);
	initTheme("dark");
	setKeybindings(new KeybindingsManager());
	for (const id of ["a", "b"])
		writeFileSync(
			join(dir, `${id}.jsonl`),
			`${JSON.stringify({ type: "session", version: 3, id, cwd: root, timestamp: new Date(1000).toISOString() })}\n${message(`first ${id}`)}\n`,
		);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
async function selector() {
	const entries = await SessionManager.list(root, dir, undefined, { metadataOnly: true });
	const repaint = vi.fn();
	const view = new SessionSelectorComponent(
		async () => entries,
		async () => entries,
		() => {},
		() => {},
		() => {},
		repaint,
	);
	await vi.waitFor(() => expect(view.getSessionList().getSelectedSessionPath()).toBeDefined());
	return { view, entries, repaint };
}

describe("metadata-backed session picker", () => {
	it("searches later messages without retaining text in the picker catalog", async () => {
		appendFileSync(join(dir, "b.jsonl"), `${message("later needlephrase target")}\n`);
		const { view, entries } = await selector();
		view.getSessionList().handleInput('"needlephrase target"');
		await vi.waitFor(() => expect(view.getSessionList().getSelectedSessionPath()).toBe(join(dir, "b.jsonl")));
		expect(entries.every((entry) => !("allMessagesText" in entry))).toBe(true);
		view.handleInput("\x1b");
	});

	it("searches current file data after append and rejects incomplete trailing entries", async () => {
		const { view } = await selector();
		appendFileSync(join(dir, "b.jsonl"), `${message("freshappend")}\n{"type":"message","message":`);
		view.getSessionList().handleInput("re:freshappend");
		await vi.waitFor(() => expect(view.getSessionList().getSelectedSessionPath()).toBe(join(dir, "b.jsonl")));
		view.getSessionList().handleInput("\x15");
		view.getSessionList().handleInput("re:unseenpartial");
		await vi.waitFor(() => expect(view.render(100).join("\n")).not.toContain("Searching"));
		expect(view.getSessionList().getSelectedSessionPath()).toBeUndefined();
		view.handleInput("\x1b");
	});
});
