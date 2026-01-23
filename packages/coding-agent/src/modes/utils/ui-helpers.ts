import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import type { AssistantMessage, Message } from "@oh-my-pi/pi-ai";
import { Spacer, Text, TruncatedText } from "@oh-my-pi/pi-tui";
import { AssistantMessageComponent } from "$c/modes/components/assistant-message";
import { BashExecutionComponent } from "$c/modes/components/bash-execution";
import { BranchSummaryMessageComponent } from "$c/modes/components/branch-summary-message";
import { CompactionSummaryMessageComponent } from "$c/modes/components/compaction-summary-message";
import { CustomMessageComponent } from "$c/modes/components/custom-message";
import { DynamicBorder } from "$c/modes/components/dynamic-border";
import { PythonExecutionComponent } from "$c/modes/components/python-execution";
import { ReadToolGroupComponent } from "$c/modes/components/read-tool-group";
import { ToolExecutionComponent } from "$c/modes/components/tool-execution";
import { UserMessageComponent } from "$c/modes/components/user-message";
import { theme } from "$c/modes/theme/theme";
import type { CompactionQueuedMessage, InteractiveModeContext } from "$c/modes/types";
import type { CustomMessage } from "$c/session/messages";
import type { SessionContext } from "$c/session/session-manager";

type TextBlock = { type: "text"; text: string };

type QueuedMessages = {
	steering: string[];
	followUp: string[];
};

export class UiHelpers {
	constructor(private ctx: InteractiveModeContext) {}

	/** Extract text content from a user message */
	getUserMessageText(message: Message): string {
		if (message.role !== "user") return "";
		const textBlocks =
			typeof message.content === "string"
				? [{ type: "text", text: message.content }]
				: message.content.filter((content): content is TextBlock => content.type === "text");
		return textBlocks.map((block) => block.text).join("");
	}

	/**
	 * Show a status message in the chat.
	 *
	 * If multiple status messages are emitted back-to-back (without anything else being added to the chat),
	 * we update the previous status line instead of appending new ones to avoid log spam.
	 */
	showStatus(message: string, options?: { dim?: boolean }): void {
		if (this.ctx.isBackgrounded) {
			return;
		}
		const children = this.ctx.chatContainer.children;
		const last = children.length > 0 ? children[children.length - 1] : undefined;
		const secondLast = children.length > 1 ? children[children.length - 2] : undefined;
		const useDim = options?.dim ?? true;
		const rendered = useDim ? theme.fg("dim", message) : message;

		if (last && secondLast && last === this.ctx.lastStatusText && secondLast === this.ctx.lastStatusSpacer) {
			this.ctx.lastStatusText.setText(rendered);
			this.ctx.ui.requestRender();
			return;
		}

		const spacer = new Spacer(1);
		const text = new Text(rendered, 1, 0);
		this.ctx.chatContainer.addChild(spacer);
		this.ctx.chatContainer.addChild(text);
		this.ctx.lastStatusSpacer = spacer;
		this.ctx.lastStatusText = text;
		this.ctx.ui.requestRender();
	}

	addMessageToChat(message: AgentMessage, options?: { populateHistory?: boolean }): void {
		switch (message.role) {
			case "bashExecution": {
				const component = new BashExecutionComponent(message.command, this.ctx.ui, message.excludeFromContext);
				if (message.output) {
					component.appendOutput(message.output);
				}
				component.setComplete(message.exitCode, message.cancelled, {
					truncation: message.meta?.truncation,
				});
				this.ctx.chatContainer.addChild(component);
				break;
			}
			case "pythonExecution": {
				const component = new PythonExecutionComponent(message.code, this.ctx.ui, message.excludeFromContext);
				if (message.output) {
					component.appendOutput(message.output);
				}
				component.setComplete(message.exitCode, message.cancelled, {
					truncation: message.meta?.truncation,
				});
				this.ctx.chatContainer.addChild(component);
				break;
			}
			case "hookMessage":
			case "custom": {
				if (message.display) {
					const renderer = this.ctx.session.extensionRunner?.getMessageRenderer(message.customType);
					// Both HookMessage and CustomMessage have the same structure, cast for compatibility
					this.ctx.chatContainer.addChild(new CustomMessageComponent(message as CustomMessage<unknown>, renderer));
				}
				break;
			}
			case "compactionSummary": {
				this.ctx.chatContainer.addChild(new Spacer(1));
				const component = new CompactionSummaryMessageComponent(message);
				component.setExpanded(this.ctx.toolOutputExpanded);
				this.ctx.chatContainer.addChild(component);
				break;
			}
			case "branchSummary": {
				this.ctx.chatContainer.addChild(new Spacer(1));
				const component = new BranchSummaryMessageComponent(message);
				component.setExpanded(this.ctx.toolOutputExpanded);
				this.ctx.chatContainer.addChild(component);
				break;
			}
			case "fileMention": {
				// Render compact file mention display
				for (const file of message.files) {
					const text = `${theme.fg("dim", `${theme.tree.last} `)}${theme.fg("muted", "Read")} ${theme.fg(
						"accent",
						file.path,
					)} ${theme.fg("dim", `(${file.lineCount} lines)`)}`;
					this.ctx.chatContainer.addChild(new Text(text, 0, 0));
				}
				break;
			}
			case "user": {
				const textContent = this.ctx.getUserMessageText(message);
				if (textContent) {
					const userComponent = new UserMessageComponent(textContent);
					this.ctx.chatContainer.addChild(userComponent);
					if (options?.populateHistory) {
						this.ctx.editor.addToHistory(textContent);
					}
				}
				break;
			}
			case "assistant": {
				const assistantComponent = new AssistantMessageComponent(message, this.ctx.hideThinkingBlock);
				this.ctx.chatContainer.addChild(assistantComponent);
				break;
			}
			case "toolResult": {
				// Tool results are rendered inline with tool calls, handled separately
				break;
			}
			default: {
				const _exhaustive: never = message;
			}
		}
	}

	/**
	 * Render session context to chat. Used for initial load and rebuild after compaction.
	 * @param sessionContext Session context to render
	 * @param options.updateFooter Update footer state
	 * @param options.populateHistory Add user messages to editor history
	 */
	renderSessionContext(
		sessionContext: SessionContext,
		options: { updateFooter?: boolean; populateHistory?: boolean } = {},
	): void {
		this.ctx.pendingTools.clear();

		if (options.updateFooter) {
			this.ctx.statusLine.invalidate();
			this.ctx.updateEditorBorderColor();
		}

		let readGroup: ReadToolGroupComponent | null = null;
		for (const message of sessionContext.messages) {
			// Assistant messages need special handling for tool calls
			if (message.role === "assistant") {
				this.ctx.addMessageToChat(message);
				readGroup = null;
				const hasErrorStop = message.stopReason === "aborted" || message.stopReason === "error";
				const errorMessage = hasErrorStop
					? message.stopReason === "aborted"
						? (() => {
								const retryAttempt = this.ctx.session.retryAttempt;
								return retryAttempt > 0
									? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
									: "Operation aborted";
							})()
						: message.errorMessage || "Error"
					: null;

				// Render tool call components
				for (const content of message.content) {
					if (content.type !== "toolCall") continue;

					if (content.name === "read") {
						if (!readGroup) {
							readGroup = new ReadToolGroupComponent();
							readGroup.setExpanded(this.ctx.toolOutputExpanded);
							this.ctx.chatContainer.addChild(readGroup);
						}
						readGroup.updateArgs(content.arguments, content.id);
						if (hasErrorStop && errorMessage) {
							readGroup.updateResult(
								{ content: [{ type: "text", text: errorMessage }], isError: true },
								false,
								content.id,
							);
						} else {
							this.ctx.pendingTools.set(content.id, readGroup);
						}
						continue;
					}

					readGroup = null;
					const tool = this.ctx.session.getToolByName(content.name);
					const component = new ToolExecutionComponent(
						content.name,
						content.arguments,
						{
							showImages: this.ctx.settingsManager.getShowImages(),
							editFuzzyThreshold: this.ctx.settingsManager.getEditFuzzyThreshold(),
							editAllowFuzzy: this.ctx.settingsManager.getEditFuzzyMatch(),
						},
						tool,
						this.ctx.ui,
						this.ctx.sessionManager.getCwd(),
					);
					component.setExpanded(this.ctx.toolOutputExpanded);
					this.ctx.chatContainer.addChild(component);

					if (hasErrorStop && errorMessage) {
						component.updateResult(
							{ content: [{ type: "text", text: errorMessage }], isError: true },
							false,
							content.id,
						);
					} else {
						this.ctx.pendingTools.set(content.id, component);
					}
				}
			} else if (message.role === "toolResult") {
				// Match tool results to pending tool components
				const component = this.ctx.pendingTools.get(message.toolCallId);
				if (component) {
					component.updateResult(message, false, message.toolCallId);
					this.ctx.pendingTools.delete(message.toolCallId);
				}
			} else {
				// All other messages use standard rendering
				this.ctx.addMessageToChat(message, options);
			}
		}

		this.ctx.pendingTools.clear();
		this.ctx.ui.requestRender();
	}

	renderInitialMessages(): void {
		// Get aligned messages and entries from session context
		const context = this.ctx.sessionManager.buildSessionContext();
		this.ctx.renderSessionContext(context, {
			updateFooter: true,
			populateHistory: true,
		});

		// Show compaction info if session was compacted
		const allEntries = this.ctx.sessionManager.getEntries();
		let compactionCount = 0;
		for (const entry of allEntries) {
			if (entry.type === "compaction") {
				compactionCount++;
			}
		}
		if (compactionCount > 0) {
			const times = compactionCount === 1 ? "1 time" : `${compactionCount} times`;
			this.ctx.showStatus(`Session compacted ${times}`);
		}
	}

	clearEditor(): void {
		if (this.ctx.isBackgrounded) {
			return;
		}
		this.ctx.editor.setText("");
		this.ctx.pendingImages = [];
		this.ctx.ui.requestRender();
	}

	showError(errorMessage: string): void {
		if (this.ctx.isBackgrounded) {
			process.stderr.write(`Error: ${errorMessage}\n`);
			return;
		}
		this.ctx.chatContainer.addChild(new Spacer(1));
		this.ctx.chatContainer.addChild(new Text(theme.fg("error", `Error: ${errorMessage}`), 1, 0));
		this.ctx.ui.requestRender();
	}

	showWarning(warningMessage: string): void {
		if (this.ctx.isBackgrounded) {
			process.stderr.write(`Warning: ${warningMessage}\n`);
			return;
		}
		this.ctx.chatContainer.addChild(new Spacer(1));
		this.ctx.chatContainer.addChild(new Text(theme.fg("warning", `Warning: ${warningMessage}`), 1, 0));
		this.ctx.ui.requestRender();
	}

	showNewVersionNotification(newVersion: string): void {
		this.ctx.chatContainer.addChild(new Spacer(1));
		this.ctx.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
		this.ctx.chatContainer.addChild(
			new Text(
				theme.bold(theme.fg("warning", "Update Available")) +
					"\n" +
					theme.fg("muted", `New version ${newVersion} is available. Run: `) +
					theme.fg("accent", "omp update"),
				1,
				0,
			),
		);
		this.ctx.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
		this.ctx.ui.requestRender();
	}

	updatePendingMessagesDisplay(): void {
		this.ctx.pendingMessagesContainer.clear();
		const queuedMessages = this.ctx.session.getQueuedMessages() as QueuedMessages;

		const steeringMessages: Array<{ message: string; label: string }> = [];
		for (const message of queuedMessages.steering) {
			steeringMessages.push({ message, label: "Steer" });
		}
		for (const entry of this.ctx.compactionQueuedMessages as CompactionQueuedMessage[]) {
			if (entry.mode === "steer") {
				steeringMessages.push({ message: entry.text, label: "Steer" });
			}
		}

		const followUpMessages: Array<{ message: string; label: string }> = [];
		for (const message of queuedMessages.followUp) {
			followUpMessages.push({ message, label: "Follow-up" });
		}
		for (const entry of this.ctx.compactionQueuedMessages as CompactionQueuedMessage[]) {
			if (entry.mode === "followUp") {
				followUpMessages.push({ message: entry.text, label: "Follow-up" });
			}
		}

		const allMessages = [...steeringMessages, ...followUpMessages];
		if (allMessages.length > 0) {
			this.ctx.pendingMessagesContainer.addChild(new Spacer(1));
			for (const entry of allMessages) {
				const queuedText = theme.fg("dim", `${entry.label}: ${entry.message}`);
				this.ctx.pendingMessagesContainer.addChild(new TruncatedText(queuedText, 1, 0));
			}
			const dequeueKey = this.ctx.keybindings.getDisplayString("dequeue") || "Alt+Up";
			const hintText = theme.fg("dim", `${theme.tree.hook} ${dequeueKey} to edit`);
			this.ctx.pendingMessagesContainer.addChild(new TruncatedText(hintText, 1, 0));
		}
	}

	queueCompactionMessage(text: string, mode: "steer" | "followUp"): void {
		this.ctx.compactionQueuedMessages.push({ text, mode } as CompactionQueuedMessage);
		this.ctx.editor.addToHistory(text);
		this.ctx.editor.setText("");
		this.ctx.updatePendingMessagesDisplay();
		this.ctx.showStatus("Queued message for after compaction");
	}

	isKnownSlashCommand(text: string): boolean {
		if (!text.startsWith("/")) return false;
		const spaceIndex = text.indexOf(" ");
		const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
		if (!commandName) return false;

		if (this.ctx.session.extensionRunner?.getCommand(commandName)) {
			return true;
		}

		for (const command of this.ctx.session.customCommands) {
			if (command.command.name === commandName) {
				return true;
			}
		}

		return this.ctx.fileSlashCommands.has(commandName);
	}

	async flushCompactionQueue(options?: { willRetry?: boolean }): Promise<void> {
		if (this.ctx.compactionQueuedMessages.length === 0) {
			return;
		}

		const queuedMessages = [...(this.ctx.compactionQueuedMessages as CompactionQueuedMessage[])];
		this.ctx.compactionQueuedMessages = [] as CompactionQueuedMessage[];
		this.ctx.updatePendingMessagesDisplay();

		const restoreQueue = (error: unknown) => {
			this.ctx.session.clearQueue();
			this.ctx.compactionQueuedMessages = queuedMessages;
			this.ctx.updatePendingMessagesDisplay();
			this.ctx.showError(
				`Failed to send queued message${queuedMessages.length > 1 ? "s" : ""}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		};

		try {
			if (options?.willRetry) {
				for (const message of queuedMessages) {
					if (this.ctx.isKnownSlashCommand(message.text)) {
						await this.ctx.session.prompt(message.text);
					} else if (message.mode === "followUp") {
						await this.ctx.session.followUp(message.text);
					} else {
						await this.ctx.session.steer(message.text);
					}
				}
				this.ctx.updatePendingMessagesDisplay();
				return;
			}

			let firstPromptIndex = -1;
			for (let i = 0; i < queuedMessages.length; i++) {
				if (!this.ctx.isKnownSlashCommand(queuedMessages[i].text)) {
					firstPromptIndex = i;
					break;
				}
			}
			if (firstPromptIndex === -1) {
				for (const message of queuedMessages) {
					await this.ctx.session.prompt(message.text);
				}
				return;
			}

			const preCommands = queuedMessages.slice(0, firstPromptIndex);
			const firstPrompt = queuedMessages[firstPromptIndex];
			const rest = queuedMessages.slice(firstPromptIndex + 1);

			for (const message of preCommands) {
				await this.ctx.session.prompt(message.text);
			}

			const promptPromise = this.ctx.session.prompt(firstPrompt.text).catch((error: unknown) => {
				restoreQueue(error);
			});

			for (const message of rest) {
				if (this.ctx.isKnownSlashCommand(message.text)) {
					await this.ctx.session.prompt(message.text);
				} else if (message.mode === "followUp") {
					await this.ctx.session.followUp(message.text);
				} else {
					await this.ctx.session.steer(message.text);
				}
			}
			this.ctx.updatePendingMessagesDisplay();
			void promptPromise;
		} catch (error) {
			restoreQueue(error);
		}
	}

	/** Move pending bash components from pending area to chat */
	flushPendingBashComponents(): void {
		for (const component of this.ctx.pendingBashComponents) {
			this.ctx.pendingMessagesContainer.removeChild(component);
			this.ctx.chatContainer.addChild(component);
		}
		this.ctx.pendingBashComponents = [];
		for (const component of this.ctx.pendingPythonComponents) {
			this.ctx.pendingMessagesContainer.removeChild(component);
			this.ctx.chatContainer.addChild(component);
		}
		this.ctx.pendingPythonComponents = [];
	}

	findLastAssistantMessage(): AssistantMessage | undefined {
		for (let i = this.ctx.session.messages.length - 1; i >= 0; i--) {
			const message = this.ctx.session.messages[i];
			if (message?.role === "assistant") {
				return message as AssistantMessage;
			}
		}
		return undefined;
	}

	extractAssistantText(message: AssistantMessage): string {
		let text = "";
		for (const content of message.content) {
			if (content.type === "text") {
				text += content.text;
			}
		}
		return text.trim();
	}
}
