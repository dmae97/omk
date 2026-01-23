import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { Container, getCapabilities, Markdown, Spacer, Text } from "@oh-my-pi/pi-tui";
import { hasPendingMermaid, prerenderMermaid } from "$c/modes/theme/mermaid-cache";
import { getMarkdownTheme, theme } from "$c/modes/theme/theme";

/**
 * Component that renders a complete assistant message
 */
export class AssistantMessageComponent extends Container {
	private contentContainer: Container;
	private hideThinkingBlock: boolean;
	private lastMessage?: AssistantMessage;
	private prerenderInFlight = false;

	constructor(message?: AssistantMessage, hideThinkingBlock = false) {
		super();

		this.hideThinkingBlock = hideThinkingBlock;

		// Container for text/thinking content
		this.contentContainer = new Container();
		this.addChild(this.contentContainer);

		if (message) {
			this.updateContent(message);
		}
	}

	override invalidate(): void {
		super.invalidate();
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setHideThinkingBlock(hide: boolean): void {
		this.hideThinkingBlock = hide;
	}

	private triggerMermaidPrerender(message: AssistantMessage): void {
		const caps = getCapabilities();
		if (!caps.images || this.prerenderInFlight) return;

		// Check if any text content has pending mermaid blocks
		const hasPending = message.content.some((c) => c.type === "text" && c.text.trim() && hasPendingMermaid(c.text));
		if (!hasPending) return;

		this.prerenderInFlight = true;

		// Fire off background prerender
		(async () => {
			for (const content of message.content) {
				if (content.type === "text" && content.text.trim() && hasPendingMermaid(content.text)) {
					await prerenderMermaid(content.text);
				}
			}
			this.prerenderInFlight = false;
			// Invalidate to re-render with cached images
			this.invalidate();
		})();
	}

	updateContent(message: AssistantMessage): void {
		this.lastMessage = message;

		// Clear content container
		this.contentContainer.clear();

		// Trigger background mermaid pre-rendering if needed
		this.triggerMermaidPrerender(message);

		const hasVisibleContent = message.content.some(
			(c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()),
		);

		if (hasVisibleContent) {
			this.contentContainer.addChild(new Spacer(1));
		}

		// Render content in order
		for (let i = 0; i < message.content.length; i++) {
			const content = message.content[i];
			if (content.type === "text" && content.text.trim()) {
				// Assistant text messages with no background - trim the text
				// Set paddingY=0 to avoid extra spacing before tool executions
				this.contentContainer.addChild(new Markdown(content.text.trim(), 1, 0, getMarkdownTheme()));
			} else if (content.type === "thinking" && content.thinking.trim()) {
				// Check if there's text content after this thinking block
				const hasTextAfter = message.content.slice(i + 1).some((c) => c.type === "text" && c.text.trim());

				if (this.hideThinkingBlock) {
					// Show static "Thinking..." label when hidden
					this.contentContainer.addChild(new Text(theme.italic(theme.fg("thinkingText", "Thinking...")), 1, 0));
					if (hasTextAfter) {
						this.contentContainer.addChild(new Spacer(1));
					}
				} else {
					// Thinking traces in thinkingText color, italic
					this.contentContainer.addChild(
						new Markdown(content.thinking.trim(), 1, 0, getMarkdownTheme(), {
							color: (text: string) => theme.fg("thinkingText", text),
							italic: true,
						}),
					);
					this.contentContainer.addChild(new Spacer(1));
				}
			}
		}

		// Check if aborted - show after partial content
		// But only if there are no tool calls (tool execution components will show the error)
		const hasToolCalls = message.content.some((c) => c.type === "toolCall");
		if (!hasToolCalls) {
			if (message.stopReason === "aborted") {
				const abortMessage =
					message.errorMessage && message.errorMessage !== "Request was aborted"
						? message.errorMessage
						: "Operation aborted";
				if (hasVisibleContent) {
					this.contentContainer.addChild(new Spacer(1));
				} else {
					this.contentContainer.addChild(new Spacer(1));
				}
				this.contentContainer.addChild(new Text(theme.fg("error", abortMessage), 1, 0));
			} else if (message.stopReason === "error") {
				const errorMsg = message.errorMessage || "Unknown error";
				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(new Text(theme.fg("error", `Error: ${errorMsg}`), 1, 0));
			}
		}
	}
}
