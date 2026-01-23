import { Box, Markdown, Spacer, Text } from "@oh-my-pi/pi-tui";
import { getMarkdownTheme, theme } from "$c/modes/theme/theme";
import type { CompactionSummaryMessage } from "$c/session/messages";

/**
 * Component that renders a compaction message with collapsed/expanded state.
 * Uses same background color as hook messages for visual consistency.
 */
export class CompactionSummaryMessageComponent extends Box {
	private expanded = false;
	private message: CompactionSummaryMessage;

	constructor(message: CompactionSummaryMessage) {
		super(1, 1, (t) => theme.bg("customMessageBg", t));
		this.message = message;
		this.updateDisplay();
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.updateDisplay();
	}

	override invalidate(): void {
		super.invalidate();
		this.updateDisplay();
	}

	private updateDisplay(): void {
		this.clear();

		const tokenStr = this.message.tokensBefore.toLocaleString();
		const label = theme.fg("customMessageLabel", theme.bold("[compaction]"));
		this.addChild(new Text(label, 0, 0));
		this.addChild(new Spacer(1));

		if (this.expanded) {
			const header = `**Compacted from ${tokenStr} tokens**\n\n`;
			this.addChild(
				new Markdown(header + this.message.summary, 0, 0, getMarkdownTheme(), {
					color: (text: string) => theme.fg("customMessageText", text),
				}),
			);
		} else {
			this.addChild(
				new Text(theme.fg("customMessageText", `Compacted from ${tokenStr} tokens (ctrl+o to expand)`), 0, 0),
			);
		}
	}
}
