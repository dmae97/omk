/**
 * TUI session selector for --resume flag
 */

import { ProcessTerminal, TUI } from "@oh-my-pi/pi-tui";
import { SessionSelectorComponent } from "$c/modes/components/session-selector";
import type { SessionInfo } from "$c/session/session-manager";

/** Show TUI session selector and return selected session path or null if cancelled */
export async function selectSession(sessions: SessionInfo[]): Promise<string | null> {
	const { promise, resolve } = Promise.withResolvers<string | null>();
	const ui = new TUI(new ProcessTerminal());
	let resolved = false;
	const selector = new SessionSelectorComponent(
		sessions,
		(path: string) => {
			if (!resolved) {
				resolved = true;
				ui.stop();
				resolve(path);
			}
		},
		() => {
			if (!resolved) {
				resolved = true;
				ui.stop();
				resolve(null);
			}
		},
		() => {
			if (!resolved) {
				resolved = true;
				ui.stop();
				process.exit(0);
			}
		},
	);

	ui.addChild(selector);
	ui.setFocus(selector.getSessionList());
	ui.start();
	return promise;
}
