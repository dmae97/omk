import { Container } from "omk-tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const reload = Reflect.get(InteractiveMode.prototype, "handleReloadCommand");
if (typeof reload !== "function") throw new Error("Missing reload adapter");
function context() {
	const editor = {};
	return {
		session: {
			isStreaming: false,
			isCompacting: false,
			reload: vi.fn(async () => {}),
			resourceLoader: { getThemes: () => ({ themes: [] }) },
			extensionRunner: {},
			modelRegistry: { getError: () => undefined },
		},
		settingsManager: {
			getHttpIdleTimeoutMs: () => 0,
			getHideThinkingBlock: () => false,
			getTheme: () => undefined,
			getEditorPaddingX: () => 1,
			getAutocompleteMaxVisible: () => 5,
			getShowHardwareCursor: () => false,
			getClearOnShrink: () => false,
		},
		keybindings: { reload: vi.fn() },
		ui: { setFocus: vi.fn(), requestRender: vi.fn(), setShowHardwareCursor: vi.fn(), setClearOnShrink: vi.fn() },
		editor,
		defaultEditor: { setPaddingX: vi.fn(), setAutocompleteMaxVisible: vi.fn() },
		editorContainer: new Container(),
		resetExtensionUI: vi.fn(),
		setupAutocompleteProvider: vi.fn(),
		setupExtensionShortcuts: vi.fn(),
		rebuildChatFromMessages: vi.fn(),
		showLoadedResources: vi.fn(),
		showWarning: vi.fn(),
		showError: vi.fn(),
		showStatus: vi.fn(),
		lastResourceReloadAt: undefined as string | undefined,
	};
}
beforeAll(() => initTheme("dark"));
describe("reload core boundary", () => {
	it("reports resource reload success without claiming core modules were updated", async () => {
		const ctx = context();
		await reload.call(ctx);
		expect(ctx.session.reload).toHaveBeenCalledOnce();
		expect(ctx.showStatus).toHaveBeenCalledWith(expect.stringContaining("Core code is unchanged"));
		expect(ctx.showStatus).toHaveBeenCalledWith(expect.stringContaining("restart OMK"));
		expect(ctx.lastResourceReloadAt).toBeDefined();
	});
	it.each(["isStreaming", "isCompacting"] as const)("does not reload or report success while %s", async (flag) => {
		const ctx = context();
		ctx.session[flag] = true;
		await reload.call(ctx);
		expect(ctx.session.reload).not.toHaveBeenCalled();
		expect(ctx.showStatus).not.toHaveBeenCalled();
		expect(ctx.showWarning).toHaveBeenCalledOnce();
	});
	it("does not report success on failure and restores the prior editor", async () => {
		const ctx = context();
		ctx.session.reload.mockRejectedValueOnce(new Error("reload test failure"));
		await reload.call(ctx);
		expect(ctx.showStatus).not.toHaveBeenCalled();
		expect(ctx.lastResourceReloadAt).toBeUndefined();
		expect(ctx.ui.setFocus).toHaveBeenLastCalledWith(ctx.editor);
		expect(ctx.showError).toHaveBeenCalledWith("Reload failed: reload test failure");
	});
});
