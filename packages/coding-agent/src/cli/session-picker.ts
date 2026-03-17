import { ProcessTerminal, TUI } from "@oh-my-pi/pi-tui";
import { SessionSelectorComponent } from "../modes/components/session-selector";
import type { SessionInfo } from "../session/session-manager";
import { FileSessionStorage } from "../session/session-storage";

/** Show TUI session selector and return selected session path or null if cancelled */
export async function selectSession(sessions: SessionInfo[]): Promise<string | null> {
	const { promise, resolve } = Promise.withResolvers<string | null>();
	const ui = new TUI(new ProcessTerminal());
	let resolved = false;
	const storage = new FileSessionStorage();

	const showSelector = () => {
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
			async (session: SessionInfo) => {
				// Delete handler - SessionList will show confirmation internally
				await storage.deleteSessionWithArtifacts(session.path);
				return true;
			},
		);
		return selector;
	};

	const selector = showSelector();
	selector.setOnRequestRender(() => ui.requestRender());
	ui.addChild(selector);
	ui.setFocus(selector);
	ui.start();
	return promise;
}
