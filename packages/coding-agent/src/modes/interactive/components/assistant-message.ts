import type { AssistantMessage } from "omk-ai";
import { Container, Markdown, type MarkdownTheme, nextRenderGeneration, Spacer, Text } from "omk-tui";
import { getMarkdownTheme, theme } from "../theme/theme.ts";

type ContentViewKind = "text" | "thinking" | "hidden-thinking";
interface ContentView {
	kind: ContentViewKind;
	/** Source text used for change detection so unchanged blocks skip setText. */
	text: string;
	component: Markdown | Text;
}

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

/**
 * Component that renders a complete assistant message
 */
export class AssistantMessageComponent extends Container {
	private contentContainer: Container;
	private hideThinkingBlock: boolean;
	private markdownTheme: MarkdownTheme;
	private hiddenThinkingLabel: string;
	private lastMessage?: AssistantMessage;
	private hasToolCalls = false;
	private readonly contentViews = new Map<number, ContentView>();
	/**
	 * Spec 026 R1: a message created empty for `message_start` is live until its
	 * `message_end` (or the `agent_end` backstop) calls `markRenderSettled()`.
	 * A message passed to the constructor (history, resume) is already final.
	 */
	private renderSettled: boolean;
	/** Spec 026 R2: +1 per `updateContent`, i.e. per received snapshot. */
	private contentRevision = 0;
	private contentGeneration = 0;

	constructor(
		message?: AssistantMessage,
		hideThinkingBlock = false,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
		hiddenThinkingLabel = "Thinking...",
	) {
		super();

		this.hideThinkingBlock = hideThinkingBlock;
		this.markdownTheme = markdownTheme;
		this.hiddenThinkingLabel = hiddenThinkingLabel;
		this.renderSettled = message !== undefined;

		// Container for text/thinking content
		this.contentContainer = new Container();
		this.addChild(this.contentContainer);

		if (message) {
			this.updateContent(message);
		}
	}

	isRenderSettled(): boolean {
		return this.renderSettled;
	}

	markRenderSettled(): void {
		if (this.renderSettled) return;
		this.renderSettled = true;
		this.contentGeneration = nextRenderGeneration();
	}

	override getRenderGeneration(): number {
		return Math.max(super.getRenderGeneration(), this.contentGeneration);
	}

	/** The snapshot most recently passed to `updateContent` (never compared by identity). */
	getMessage(): AssistantMessage | undefined {
		return this.lastMessage;
	}

	getContentRevision(): number {
		return this.contentRevision;
	}

	override invalidate(): void {
		super.invalidate();
		// Theme changes also invalidate pre-styled labels and Markdown style prefixes.
		this.contentViews.clear();
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setHideThinkingBlock(hide: boolean): void {
		this.hideThinkingBlock = hide;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setHiddenThinkingLabel(label: string): void {
		this.hiddenThinkingLabel = label;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	override render(width: number): string[] {
		const lines = super.render(width);
		if (this.hasToolCalls || lines.length === 0) {
			return lines;
		}

		lines[0] = OSC133_ZONE_START + lines[0];
		lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
		return lines;
	}

	private contentView(index: number, kind: ContentViewKind, text: string): Markdown | Text {
		const previous = this.contentViews.get(index);
		const display = kind === "hidden-thinking" ? theme.italic(theme.fg("thinkingText", text)) : text;
		if (previous?.kind === kind) {
			// Only call setText when the block text actually changed so streaming updates
			// leave finished Markdown instances and their render caches untouched.
			if (previous.text !== text) {
				previous.component.setText(display);
				previous.text = text;
			}
			return previous.component;
		}
		const component =
			kind === "hidden-thinking"
				? new Text(display, 1, 0)
				: new Markdown(
						display,
						1,
						0,
						this.markdownTheme,
						kind === "thinking"
							? { color: (value: string) => theme.fg("thinkingText", value), italic: true }
							: undefined,
					);
		this.contentViews.set(index, { kind, text, component });
		return component;
	}

	updateContent(message: AssistantMessage): void {
		// Every message_update delivers a new frozen snapshot: swap the reference and
		// bump the generation unconditionally instead of diffing object identity.
		this.lastMessage = message;
		this.contentRevision += 1;
		this.contentGeneration = nextRenderGeneration();

		// Clear content container
		this.contentContainer.clear();

		const hasVisibleContent = message.content.some(
			(c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()),
		);

		if (hasVisibleContent) {
			this.contentContainer.addChild(new Spacer(1));
		}

		const usedViews = new Set<number>();
		const visibleAfter = new Array<boolean>(message.content.length);
		let laterVisible = false;
		for (let i = message.content.length - 1; i >= 0; i--) {
			visibleAfter[i] = laterVisible;
			const part = message.content[i];
			laterVisible ||=
				(part.type === "text" && part.text.trim().length > 0) ||
				(part.type === "thinking" && part.thinking.trim().length > 0);
		}

		// Keep unchanged block render caches without relying on message identity.
		for (let i = 0; i < message.content.length; i++) {
			const content = message.content[i];
			if (content.type === "text" && content.text.trim()) {
				usedViews.add(i);
				this.contentContainer.addChild(this.contentView(i, "text", content.text.trim()));
			} else if (content.type === "thinking" && content.thinking.trim()) {
				usedViews.add(i);
				this.contentContainer.addChild(
					this.contentView(
						i,
						this.hideThinkingBlock ? "hidden-thinking" : "thinking",
						this.hideThinkingBlock ? this.hiddenThinkingLabel : content.thinking.trim(),
					),
				);
				// Tool execution blocks are rendered separately and need no trailing spacer.
				if (visibleAfter[i]) this.contentContainer.addChild(new Spacer(1));
			}
		}
		for (const index of this.contentViews.keys()) {
			if (!usedViews.has(index)) this.contentViews.delete(index);
		}

		// Check if aborted - show after partial content
		// But only if there are no tool calls (tool execution components will show the error)
		const hasToolCalls = message.content.some((c) => c.type === "toolCall");
		this.hasToolCalls = hasToolCalls;
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
