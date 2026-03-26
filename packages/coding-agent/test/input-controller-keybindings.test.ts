import { describe, expect, it, mock, vi } from "bun:test";
import type { InteractiveModeContext } from "../src/modes/types";

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

type FakeEditor = {
	onEscape?: () => void;
	shouldBypassAutocompleteOnEscape?: () => boolean;
	onClear?: () => void;
	onExit?: () => void;
	onSuspend?: () => void;
	onCycleThinkingLevel?: () => void;
	onCycleModelForward?: () => void;
	onCycleModelBackward?: () => void;
	onSelectModelTemporary?: () => void;
	onSelectModel?: () => void;
	onHistorySearch?: () => void;
	onShowHotkeys?: () => void;
	onPasteImage?: () => Promise<boolean>;
	onCopyPrompt?: () => void;
	onExpandTools?: () => void;
	onToggleThinking?: () => void;
	onExternalEditor?: () => void;
	onDequeue?: () => void;
	onChange?: (text: string) => void;
	setText(text: string): void;
	getText(): string;
	addToHistory(text: string): void;
	setActionKeys(action: string, keys: string[]): void;
	setCustomKeyHandler(key: string, handler: () => void): void;
	clearCustomKeyHandlers(): void;
};

async function createContext() {
	const { InputController } = await import("../src/modes/controllers/input-controller");
	let editorText = "";
	const keyMap: Record<string, string[]> = {
		"app.model.selectTemporary": ["ctrl+y"],
		"app.model.select": ["ctrl+l"],
	};
	const setActionKeys = vi.fn();
	const showModelSelector = vi.fn();
	const editor: FakeEditor = {
		setText(text: string) {
			editorText = text;
		},
		getText() {
			return editorText;
		},
		addToHistory: vi.fn(),
		setActionKeys,
		setCustomKeyHandler: vi.fn(),
		clearCustomKeyHandlers: vi.fn(),
	};
	const ctx = {
		editor: editor as unknown as InteractiveModeContext["editor"],
		ui: {} as InteractiveModeContext["ui"],
		loadingAnimation: undefined,
		autoCompactionLoader: undefined,
		retryLoader: undefined,
		autoCompactionEscapeHandler: undefined,
		retryEscapeHandler: undefined,
		session: {
			isStreaming: false,
			isCompacting: false,
			isGeneratingHandoff: false,
			isBashRunning: false,
			isPythonRunning: false,
			extensionRunner: undefined,
		} as InteractiveModeContext["session"],
		keybindings: {
			getKeys(action: string) {
				return keyMap[action] ? [...keyMap[action]] : [];
			},
		} as InteractiveModeContext["keybindings"],
		pendingImages: [],
		isBashMode: false,
		isPythonMode: false,
		handleHotkeysCommand: vi.fn(),
		handlePlanModeCommand: vi.fn(),
		handleClearCommand: vi.fn(),
		showTreeSelector: vi.fn(),
		showUserMessageSelector: vi.fn(),
		showSessionSelector: vi.fn(),
		handleSTTToggle: vi.fn(),
		showDebugSelector: vi.fn(),
		showHistorySearch: vi.fn(),
		toggleThinkingBlockVisibility: vi.fn(),
		showModelSelector,
		updateEditorBorderColor: vi.fn(),
		hasActiveBtw: vi.fn(() => false),
	} as unknown as InteractiveModeContext;

	return {
		InputController,
		ctx,
		editor,
		spies: {
			setActionKeys,
			showModelSelector,
		},
	};
}

describe("InputController keybinding setup", () => {
	it("registers temporary and persisted model selector actions separately", async () => {
		const { InputController, ctx, editor, spies } = await createContext();
		const controller = new InputController(ctx);

		controller.setupKeyHandlers();

		expect(spies.setActionKeys).toHaveBeenCalledWith("app.model.selectTemporary", ["ctrl+y"]);
		expect(spies.setActionKeys).toHaveBeenCalledWith("app.model.select", ["ctrl+l"]);
		expect(editor.onSelectModelTemporary).toBeDefined();
		expect(editor.onSelectModel).toBeDefined();
		expect(editor.onSelectModelTemporary).not.toBe(editor.onSelectModel);

		editor.onSelectModelTemporary?.();
		editor.onSelectModel?.();

		expect(spies.showModelSelector).toHaveBeenNthCalledWith(1, { temporaryOnly: true });
		expect(spies.showModelSelector).toHaveBeenNthCalledWith(2);
	});
});
