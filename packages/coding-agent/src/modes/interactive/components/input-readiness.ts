import { type Component, truncateToWidth } from "omk-tui";
import { theme } from "../theme/theme.ts";

/** Local input wait only: says nothing about provider connectivity or verification. */
export class InputReadinessComponent implements Component {
	private readonly isWaitingForInput: () => boolean;

	constructor(isWaitingForInput: () => boolean) {
		this.isWaitingForInput = isWaitingForInput;
	}

	render(width: number): string[] {
		return [this.isWaitingForInput() ? theme.fg("dim", truncateToWidth("INPUT READY", width, "")) : ""];
	}

	invalidate(): void {}
}
