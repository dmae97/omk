import { Container } from "omk-tui";
import { disposeComponent } from "../interactive-tool-result.ts";

/** Chat projections own async display work, not the underlying session execution. */
export class ChatContainer extends Container {
	dispose(): void {
		for (const child of this.children) disposeComponent(child);
	}

	override clear(): void {
		this.dispose();
		super.clear();
	}
}
