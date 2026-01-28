import { Container, Markdown, Spacer } from "@oh-my-pi/pi-tui";
import { getMarkdownTheme, theme } from "../../modes/theme/theme";

/**
 * Component that renders a user message
 */
export class UserMessageComponent extends Container {
	constructor(text: string, synthetic = false) {
		super();
		const bgColor = (value: string) => theme.bg("userMessageBg", value);
		const color = synthetic
			? (value: string) => theme.fg("dim", value)
			: (value: string) => theme.fg("userMessageText", value);
		this.addChild(new Spacer(1));
		this.addChild(
			new Markdown(text, 1, 1, getMarkdownTheme(), {
				bgColor,
				color,
			}),
		);
	}
}
