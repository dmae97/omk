import { WindowedContainer } from "omk-tui";
import { disposeComponent } from "../interactive-tool-result.ts";

/**
 * Chat transcript container. Extends WindowedContainer so finished messages
 * above the live-line budget freeze into a prefix buffer and drop render caches.
 * Default budget (~120 rows) covers a few viewports without threading terminal
 * size through interactive-mode.ts (module-size baseline).
 */
export class ChatContainer extends WindowedContainer {
	dispose(): void {
		for (const child of this.children) disposeComponent(child);
	}

	override clear(): void {
		this.dispose();
		super.clear();
	}
}
