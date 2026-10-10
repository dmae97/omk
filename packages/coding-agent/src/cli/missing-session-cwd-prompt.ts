import type { SessionCwdIssue } from "../core/session-cwd.ts";
import { formatMissingSessionCwdPrompt } from "../core/session-cwd.ts";
import type { SettingsManager } from "../core/settings-manager.ts";

/** Interactive Continue/Cancel prompt when a resumed session's cwd is missing. */
export async function promptForMissingSessionCwd(
	issue: SessionCwdIssue,
	settingsManager: SettingsManager,
): Promise<string | undefined> {
	const [
		{ ProcessTerminal, setKeybindings, TUI },
		{ KeybindingsManager },
		{ ExtensionSelectorComponent },
		{ initTheme },
	] = await Promise.all([
		import("omk-tui"),
		import("../core/keybindings.ts"),
		import("../modes/interactive/components/extension-selector.ts"),
		import("../modes/interactive/theme/theme.ts"),
	]);
	initTheme(settingsManager.getTheme());
	setKeybindings(KeybindingsManager.create());

	return new Promise((resolve) => {
		const ui = new TUI(new ProcessTerminal(), settingsManager.getShowHardwareCursor());
		ui.setClearOnShrink(settingsManager.getClearOnShrink());

		let settled = false;
		const finish = (result: string | undefined) => {
			if (settled) {
				return;
			}
			settled = true;
			ui.stop();
			resolve(result);
		};

		const selector = new ExtensionSelectorComponent(
			formatMissingSessionCwdPrompt(issue),
			["Continue", "Cancel"],
			(option) => finish(option === "Continue" ? issue.fallbackCwd : undefined),
			() => finish(undefined),
			{ tui: ui },
		);
		ui.addChild(selector);
		ui.setFocus(selector);
		ui.start();
	});
}
