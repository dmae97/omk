import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ImageContent } from "omk-ai";
import { TUI } from "omk-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { CustomEditor } from "../src/modes/interactive/components/custom-editor.ts";
import { InteractiveMode, type InteractivePromptPayload } from "../src/modes/interactive/interactive-mode.ts";
import { PromptAttachmentDraft } from "../src/modes/interactive/prompt-attachment-draft.ts";
import { getEditorTheme, initTheme } from "../src/modes/interactive/theme/theme.ts";

const clipboard = vi.hoisted(() => vi.fn());
vi.mock("../src/utils/clipboard-image.ts", () => ({ readClipboardImage: clipboard }));

const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6v6EAAAAASUVORK5CYII=",
	"base64",
);
let root: string;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "omk-image-input-"));
	initTheme("dark");
	clipboard.mockReset();
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

function invoke(name: string, context: object): void {
	const method: unknown = Reflect.get(InteractiveMode.prototype, name);
	if (typeof method !== "function") throw new Error(`Missing method ${name}`);
	method.call(context);
}

function scenario() {
	const ui = new TUI(new VirtualTerminal(100, 30));
	const editor = new CustomEditor(ui, getEditorTheme(), new KeybindingsManager());
	let settled: (() => void) | undefined;
	const attachmentDraft = new PromptAttachmentDraft({
		cwd: () => root,
		changed: () => {
			if (!attachmentDraft.busy) settled?.();
		},
		status: () => {},
		warning: () => {},
	});
	const prompt = vi.fn(
		async (_text: string, _options?: { images?: ImageContent[]; streamingBehavior?: string }) => {},
	);
	const context = {
		defaultEditor: editor,
		editor,
		attachmentDraft,
		ui,
		session: { isCompacting: false, isStreaming: false, isBashRunning: false, prompt },
		pendingPromptPayloads: [] as InteractivePromptPayload[],
		showWarning: vi.fn(),
		showStatus: vi.fn(),
		flushPendingBashComponents: () => {},
		updatePendingMessagesDisplay: () => {},
		isVisionCapable: () => true,
		materializeDraftImages: (ids: readonly string[]) => attachmentDraft.materialize(ids),
		consumeDraftAttachments: (ids: readonly string[]) => attachmentDraft.consume(ids),
	};
	invoke("setupEditorSubmitHandler", context);
	editor.onPaste = (text) => attachmentDraft.paste(text);
	editor.onPasteImage = () => void attachmentDraft.clipboard();
	return {
		context,
		editor,
		attachmentDraft,
		prompt,
		shortcut: (key: string) =>
			new Promise<void>((resolve) => {
				settled = resolve;
				editor.handleInput(key);
			}),
		dropped: (paste: string) =>
			new Promise<void>((resolve) => {
				settled = resolve;
				editor.handleInput(`\x1b[200~${paste}\x1b[201~`);
			}),
	};
}

describe("terminal prompt image input", () => {
	it.each(["\x16", "\x1bv"])("attaches a screenshot from shortcut %j without changing prompt text", async (key) => {
		clipboard.mockResolvedValue({ bytes: PNG, mimeType: "image/png" });
		const { editor, attachmentDraft, shortcut } = scenario();
		editor.setText("screenshot question");
		await shortcut(key);
		expect(editor.getText()).toBe("screenshot question");
		expect(attachmentDraft.materialize(attachmentDraft.ids)).toEqual([
			{ type: "image", mimeType: "image/png", data: PNG.toString("base64") },
		]);
	});
	it("checks the image clipboard when the terminal forwards an empty paste frame", async () => {
		clipboard.mockResolvedValue({ bytes: PNG, mimeType: "image/png" });
		const { editor, attachmentDraft } = scenario();
		editor.setText("keep this text");
		editor.handleInput("\x1b[200~");
		editor.handleInput("\x1b[201~");
		await vi.waitFor(() => expect(attachmentDraft.materialize(attachmentDraft.ids)).toHaveLength(1));
		expect(editor.getText()).toBe("keep this text");
	});
	it("drops an image into an existing prompt and submits a text-plus-image payload", async () => {
		const file = join(root, "한글 screenshot.png");
		await writeFile(file, PNG);
		const { context, editor, dropped } = scenario();
		editor.setText("Explain this screenshot");
		await dropped(`'${file}'`);
		expect(editor.getText()).toBe("Explain this screenshot");
		editor.handleInput("\r");
		const payload = context.pendingPromptPayloads[0];
		expect(payload.text).toBe("Explain this screenshot");
		expect(payload.images).toEqual([{ type: "image", mimeType: "image/png", data: PNG.toString("base64") }]);
	});
	it("submits an image-only prompt and preserves the attachment until acceptance", async () => {
		await writeFile(join(root, "screen.png"), PNG);
		const { context, editor, attachmentDraft } = scenario();
		await attachmentDraft.command("add screen.png");
		editor.handleInput("\r");
		expect(context.pendingPromptPayloads[0].text).toBe("");
		expect(context.pendingPromptPayloads[0].images).toHaveLength(1);
		expect(attachmentDraft.ids).toHaveLength(1);
	});
	it("keeps prompt text and images when the selected model lacks vision", async () => {
		await writeFile(join(root, "screen.png"), PNG);
		const { context, editor, attachmentDraft } = scenario();
		await attachmentDraft.command("add screen.png");
		context.isVisionCapable = () => false;
		editor.setText("keep my question");
		editor.handleInput("\r");
		expect(editor.getText()).toBe("keep my question");
		expect(attachmentDraft.ids).toHaveLength(1);
		expect(context.pendingPromptPayloads).toEqual([]);
	});
	it("blocks submit while a file drop loads instead of losing the question", async () => {
		const file = join(root, "screen.png");
		await writeFile(file, PNG);
		const { context, editor, dropped } = scenario();
		editor.setText("wait for image");
		const loading = dropped(file);
		editor.handleInput("\r");
		expect(editor.getText()).toBe("wait for image");
		expect(context.pendingPromptPayloads).toEqual([]);
		await loading;
	});
	it("retains rejected steering text and images without an unhandled submit rejection", async () => {
		await writeFile(join(root, "screen.png"), PNG);
		const { context, editor, attachmentDraft, prompt } = scenario();
		await attachmentDraft.command("add screen.png");
		context.session.isStreaming = true;
		prompt.mockRejectedValueOnce(new Error("provider rejected image"));
		editor.setText("retry this");
		await editor.onSubmit?.("retry this");
		expect(editor.getText()).toBe("retry this");
		expect(attachmentDraft.ids).toHaveLength(1);
	});
	it("queues follow-up images and consumes them only after queue acceptance", async () => {
		await writeFile(join(root, "screen.png"), PNG);
		const { context, editor, attachmentDraft, prompt } = scenario();
		await attachmentDraft.command("add screen.png");
		context.session.isStreaming = true;
		editor.setText("next screenshot");
		const method: unknown = Reflect.get(InteractiveMode.prototype, "handleFollowUp");
		if (typeof method !== "function") throw new Error("Missing follow-up handler");
		await method.call(context);
		expect(prompt).toHaveBeenCalledWith("next screenshot", {
			streamingBehavior: "followUp",
			images: [{ type: "image", mimeType: "image/png", data: PNG.toString("base64") }],
		});
		expect(attachmentDraft.ids).toEqual([]);
	});
	it("does not execute app shortcuts contained in a split bracketed paste", () => {
		const { editor } = scenario();
		const paste = vi.fn();
		editor.onPasteImage = paste;
		editor.handleInput("\x1b[200~text");
		editor.handleInput("\x16");
		editor.handleInput("\x1b[201~");
		expect(paste).not.toHaveBeenCalled();
		expect(editor.getText()).toBe("text");
	});
});
