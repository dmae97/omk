import { describe, expect, it, mock, vi } from "bun:test";
import { defaultEditorTheme } from "../../tui/test/test-themes";

function createPiNativesMock() {
	function parseCtrl(data: string): string | undefined {
		if (data.length !== 1) return undefined;
		const code = data.charCodeAt(0);
		if (code < 1 || code > 26) return undefined;
		return `ctrl+${String.fromCharCode(code + 96)}`;
	}

	function parseKey(data: string): string | undefined {
		if (data === "\x1bp") return "alt+p";
		return parseCtrl(data);
	}

	return {
		Ellipsis: { Left: "left", Center: "center", Right: "right", Omit: "omit" },
		FileType: { File: "file", Dir: "dir" },
		ImageFormat: { Png: "png", Jpeg: "jpeg", WebP: "webp" },
		KeyEventType: { Press: 1, Repeat: 2, Release: 3 },
		SamplingFilter: { Nearest: "nearest" },
		PhotonImage: class PhotonImage {},
		PtySession: class PtySession {},
		Shell: class Shell {},
		astEdit: vi.fn(),
		astGrep: vi.fn(),
		copyToClipboard: vi.fn(),
		detectMacOSAppearance: vi.fn(),
		encodeSixel: vi.fn(),
		executeShell: vi.fn(),
		extractSegments: vi.fn((text: string) => ({
			before: text,
			target: "",
			after: "",
			beforeWidth: text.length,
			targetWidth: 0,
			afterWidth: 0,
		})),
		fuzzyFind: vi.fn(async () => ({ matches: [] })),
		getWorkProfile: vi.fn(async () => ({ cpu: [], memory: [] })),
		glob: vi.fn(async () => ({ matches: [] })),
		grep: vi.fn(async () => ({ matches: [], count: 0, files: [] })),
		hasMatch: vi.fn(() => false),
		highlightCode: vi.fn((code: string) => code),
		htmlToMarkdown: vi.fn((html: string) => html),
		invalidateFsScanCache: vi.fn(),
		matchesKey: vi.fn((data: string, keyId: string) => parseKey(data) === keyId),
		matchesKittySequence: vi.fn(() => false),
		matchesLegacySequence: vi.fn(() => false),
		parseKey: vi.fn((data: string) => parseKey(data)),
		parseKittySequence: vi.fn(() => undefined),
		projfsOverlayProbe: vi.fn(),
		projfsOverlayStart: vi.fn(),
		projfsOverlayStop: vi.fn(),
		readImageFromClipboard: vi.fn(async () => null),
		sanitizeText: (text: string) => text,
		searchContent: vi.fn(async () => ({ matches: [] })),
		sliceWithWidth: vi.fn((text: string) => ({ text, width: text.length })),
		startMacAppearanceObserver: vi.fn(),
		supportsLanguage: vi.fn(() => false),
		truncateToWidth: vi.fn((text: string) => text),
		visibleWidth: vi.fn((text: string) => text.length),
		wrapTextWithAnsi: vi.fn((text: string) => [text]),
	};
}

mock.module("@oh-my-pi/pi-natives", () => createPiNativesMock());

function ctrl(key: string): string {
	return String.fromCharCode(key.toLowerCase().charCodeAt(0) & 31);
}

async function createEditor() {
	const { CustomEditor } = await import("../src/modes/components/custom-editor");
	return new CustomEditor(defaultEditorTheme);
}

describe("CustomEditor temporary model selector keybinding", () => {
	it("triggers the temporary selector from a remapped action key instead of Alt+P", async () => {
		const editor = await createEditor();
		const onSelectModelTemporary = vi.fn();
		editor.onSelectModelTemporary = onSelectModelTemporary;
		editor.setActionKeys("app.model.selectTemporary", ["ctrl+y"]);

		editor.handleInput(ctrl("y"));
		expect(onSelectModelTemporary).toHaveBeenCalledTimes(1);

		editor.handleInput("\x1bp");
		expect(onSelectModelTemporary).toHaveBeenCalledTimes(1);
	});

	it("removes the default Alt+P shortcut when the action is disabled", async () => {
		const editor = await createEditor();
		const onSelectModelTemporary = vi.fn();
		editor.onSelectModelTemporary = onSelectModelTemporary;

		editor.handleInput("\x1bp");
		expect(onSelectModelTemporary).toHaveBeenCalledTimes(1);

		editor.setActionKeys("app.model.selectTemporary", []);
		editor.handleInput("\x1bp");
		expect(onSelectModelTemporary).toHaveBeenCalledTimes(1);
	});
});
