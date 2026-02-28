import type { AssistantMessage, ImageContent } from "@oh-my-pi/pi-ai";
import { Container, Image, ImageProtocol, Markdown, Spacer, TERMINAL, Text } from "@oh-my-pi/pi-tui";
import { logger } from "@oh-my-pi/pi-utils";
import { hasPendingMermaid, prerenderMermaid } from "../../modes/theme/mermaid-cache";
import { getMarkdownTheme, theme } from "../../modes/theme/theme";

/**
 * Component that renders a complete assistant message
 */
export class AssistantMessageComponent extends Container {
	#contentContainer: Container;
	#lastMessage?: AssistantMessage;
	#prerenderInFlight = false;
	#toolImagesByCallId = new Map<string, ImageContent[]>();

	constructor(
		message?: AssistantMessage,
		private hideThinkingBlock = false,
	) {
		super();

		// Container for text/thinking content
		this.#contentContainer = new Container();
		this.addChild(this.#contentContainer);

		if (message) {
			this.updateContent(message);
		}
	}

	override invalidate(): void {
		super.invalidate();
		if (this.#lastMessage) {
			this.updateContent(this.#lastMessage);
		}
	}

	setHideThinkingBlock(hide: boolean): void {
		this.hideThinkingBlock = hide;
	}

	setToolResultImages(toolCallId: string, images: ImageContent[]): void {
		if (!toolCallId) return;
		const validImages = images.filter(img => img.type === "image" && img.data && img.mimeType);
		if (validImages.length === 0) {
			this.#toolImagesByCallId.delete(toolCallId);
		} else {
			this.#toolImagesByCallId.set(toolCallId, validImages);
		}
		if (this.#lastMessage) {
			this.updateContent(this.#lastMessage);
		}
	}

	#renderToolImages(): void {
		const images = Array.from(this.#toolImagesByCallId.values()).flat();
		if (images.length === 0) return;

		this.#contentContainer.addChild(new Spacer(1));
		for (const image of images) {
			if (
				TERMINAL.imageProtocol &&
				(TERMINAL.imageProtocol !== ImageProtocol.Kitty || image.mimeType === "image/png")
			) {
				this.#contentContainer.addChild(
					new Image(
						image.data,
						image.mimeType,
						{ fallbackColor: (text: string) => theme.fg("toolOutput", text) },
						{ maxWidthCells: 60 },
					),
				);
				continue;
			}
			this.#contentContainer.addChild(new Text(theme.fg("toolOutput", `[Image: ${image.mimeType}]`), 1, 0));
		}
	}
	#triggerMermaidPrerender(message: AssistantMessage): void {
		if (!TERMINAL.imageProtocol || this.#prerenderInFlight) return;

		// Check if any text content has pending mermaid blocks
		const hasPending = message.content.some(c => c.type === "text" && c.text.trim() && hasPendingMermaid(c.text));
		if (!hasPending) return;

		this.#prerenderInFlight = true;

		// Fire off background prerender
		void (async () => {
			try {
				for (const content of message.content) {
					if (content.type === "text" && content.text.trim() && hasPendingMermaid(content.text)) {
						await prerenderMermaid(content.text);
					}
				}
			} catch (error) {
				logger.warn("Background mermaid prerender failed", {
					error: error instanceof Error ? error.message : String(error),
				});
			} finally {
				this.#prerenderInFlight = false;
				// Invalidate to re-render with cached images
				this.invalidate();
			}
		})();
	}

	updateContent(message: AssistantMessage): void {
		this.#lastMessage = message;

		// Clear content container
		this.#contentContainer.clear();

		// Trigger background mermaid pre-rendering if needed
		this.#triggerMermaidPrerender(message);

		const hasVisibleContent = message.content.some(
			c => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()),
		);

		if (hasVisibleContent) {
			this.#contentContainer.addChild(new Spacer(1));
		}

		// Render content in order
		for (let i = 0; i < message.content.length; i++) {
			const content = message.content[i];
			if (content.type === "text" && content.text.trim()) {
				// Assistant text messages with no background - trim the text
				// Set paddingY=0 to avoid extra spacing before tool executions
				this.#contentContainer.addChild(new Markdown(content.text.trim(), 1, 0, getMarkdownTheme()));
			} else if (content.type === "thinking" && content.thinking.trim()) {
				// Add spacing only when another visible assistant content block follows.
				// This avoids a superfluous blank line before separately-rendered tool execution blocks.
				const hasVisibleContentAfter = message.content
					.slice(i + 1)
					.some(c => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()));

				if (this.hideThinkingBlock) {
					// Show static "Thinking..." label when hidden
					this.#contentContainer.addChild(new Text(theme.italic(theme.fg("thinkingText", "Thinking...")), 1, 0));
					if (hasVisibleContentAfter) {
						this.#contentContainer.addChild(new Spacer(1));
					}
				} else {
					// Thinking traces in thinkingText color, italic
					this.#contentContainer.addChild(
						new Markdown(content.thinking.trim(), 1, 0, getMarkdownTheme(), {
							color: (text: string) => theme.fg("thinkingText", text),
							italic: true,
						}),
					);
					if (hasVisibleContentAfter) {
						this.#contentContainer.addChild(new Spacer(1));
					}
				}
			}
		}

		this.#renderToolImages();
		// Check if aborted - show after partial content
		// But only if there are no tool calls (tool execution components will show the error)
		const hasToolCalls = message.content.some(c => c.type === "toolCall");
		if (!hasToolCalls) {
			if (message.stopReason === "aborted") {
				const abortMessage =
					message.errorMessage && message.errorMessage !== "Request was aborted"
						? message.errorMessage
						: "Operation aborted";
				if (hasVisibleContent) {
					this.#contentContainer.addChild(new Spacer(1));
				} else {
					this.#contentContainer.addChild(new Spacer(1));
				}
				this.#contentContainer.addChild(new Text(theme.fg("error", abortMessage), 1, 0));
			} else if (message.stopReason === "error") {
				const errorMsg = message.errorMessage || "Unknown error";
				this.#contentContainer.addChild(new Spacer(1));
				this.#contentContainer.addChild(new Text(theme.fg("error", `Error: ${errorMsg}`), 1, 0));
			}
		}
	}
}
