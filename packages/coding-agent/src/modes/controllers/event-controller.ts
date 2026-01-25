import { Loader, Text } from "@oh-my-pi/pi-tui";
import { AssistantMessageComponent } from "../../modes/components/assistant-message";
import { ReadToolGroupComponent } from "../../modes/components/read-tool-group";
import { TodoReminderComponent } from "../../modes/components/todo-reminder";
import { ToolExecutionComponent } from "../../modes/components/tool-execution";
import { TtsrNotificationComponent } from "../../modes/components/ttsr-notification";
import { getSymbolTheme, theme } from "../../modes/theme/theme";
import type { InteractiveModeContext, TodoItem } from "../../modes/types";
import type { AgentSessionEvent } from "../../session/agent-session";
import type { ExitPlanModeDetails } from "../../tools";
import { detectNotificationProtocol, isNotificationSuppressed, sendNotification } from "../../utils/terminal-notify";

export class EventController {
	private lastReadGroup: ReadToolGroupComponent | undefined = undefined;
	private lastThinkingCount = 0;
	private renderedCustomMessages = new Set<string>();

	constructor(private ctx: InteractiveModeContext) {}

	private resetReadGroup(): void {
		this.lastReadGroup = undefined;
	}

	private getReadGroup(): ReadToolGroupComponent {
		if (!this.lastReadGroup) {
			this.ctx.chatContainer.addChild(new Text("", 0, 0));
			const group = new ReadToolGroupComponent();
			group.setExpanded(this.ctx.toolOutputExpanded);
			this.ctx.chatContainer.addChild(group);
			this.lastReadGroup = group;
		}
		return this.lastReadGroup;
	}

	subscribeToAgent(): void {
		this.ctx.unsubscribe = this.ctx.session.subscribe(async (event: AgentSessionEvent) => {
			await this.handleEvent(event);
		});
	}

	async handleEvent(event: AgentSessionEvent): Promise<void> {
		if (!this.ctx.isInitialized) {
			await this.ctx.init();
		}

		this.ctx.statusLine.invalidate();
		this.ctx.updateEditorTopBorder();

		switch (event.type) {
			case "agent_start":
				if (this.ctx.retryEscapeHandler) {
					this.ctx.editor.onEscape = this.ctx.retryEscapeHandler;
					this.ctx.retryEscapeHandler = undefined;
				}
				if (this.ctx.retryLoader) {
					this.ctx.retryLoader.stop();
					this.ctx.retryLoader = undefined;
					this.ctx.statusContainer.clear();
				}
				if (this.ctx.loadingAnimation) {
					this.ctx.loadingAnimation.stop();
				}
				this.ctx.statusContainer.clear();
				this.ctx.loadingAnimation = new Loader(
					this.ctx.ui,
					spinner => theme.fg("accent", spinner),
					text => theme.fg("muted", text),
					`Working${theme.format.ellipsis} (esc to interrupt)`,
					getSymbolTheme().spinnerFrames,
				);
				this.ctx.statusContainer.addChild(this.ctx.loadingAnimation);
				this.ctx.applyPendingWorkingMessage();
				this.ctx.ui.requestRender();
				break;

			case "message_start":
				if (event.message.role === "hookMessage" || event.message.role === "custom") {
					const signature = `${event.message.role}:${event.message.customType}:${event.message.timestamp}`;
					if (this.renderedCustomMessages.has(signature)) {
						break;
					}
					this.renderedCustomMessages.add(signature);
					this.resetReadGroup();
					this.ctx.addMessageToChat(event.message);
					this.ctx.ui.requestRender();
				} else if (event.message.role === "user") {
					this.resetReadGroup();
					this.ctx.addMessageToChat(event.message);
					this.ctx.editor.setText("");
					this.ctx.updatePendingMessagesDisplay();
					this.ctx.ui.requestRender();
				} else if (event.message.role === "fileMention") {
					this.resetReadGroup();
					this.ctx.addMessageToChat(event.message);
					this.ctx.ui.requestRender();
				} else if (event.message.role === "assistant") {
					this.lastThinkingCount = 0;
					this.ctx.streamingComponent = new AssistantMessageComponent(undefined, this.ctx.hideThinkingBlock);
					this.ctx.streamingMessage = event.message;
					this.ctx.chatContainer.addChild(this.ctx.streamingComponent);
					this.ctx.streamingComponent.updateContent(this.ctx.streamingMessage);
					this.ctx.ui.requestRender();
				}
				break;

			case "message_update":
				if (this.ctx.streamingComponent && event.message.role === "assistant") {
					this.ctx.streamingMessage = event.message;
					this.ctx.streamingComponent.updateContent(this.ctx.streamingMessage);

					const thinkingCount = this.ctx.streamingMessage.content.filter(
						content => content.type === "thinking" && content.thinking.trim(),
					).length;
					if (thinkingCount > this.lastThinkingCount) {
						this.resetReadGroup();
						this.lastThinkingCount = thinkingCount;
					}

					for (const content of this.ctx.streamingMessage.content) {
						if (content.type !== "toolCall") continue;

						if (!this.ctx.pendingTools.has(content.id)) {
							if (content.name === "read") {
								const group = this.getReadGroup();
								group.updateArgs(content.arguments, content.id);
								this.ctx.pendingTools.set(content.id, group);
								continue;
							}

							this.resetReadGroup();
							this.ctx.chatContainer.addChild(new Text("", 0, 0));
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
							this.ctx.pendingTools.set(content.id, component);
						} else {
							const component = this.ctx.pendingTools.get(content.id);
							if (component) {
								component.updateArgs(content.arguments, content.id);
							}
						}
					}
					this.ctx.ui.requestRender();
				}
				break;

			case "message_end":
				if (event.message.role === "user") break;
				if (this.ctx.streamingComponent && event.message.role === "assistant") {
					this.ctx.streamingMessage = event.message;
					let errorMessage: string | undefined;
					if (this.ctx.streamingMessage.stopReason === "aborted" && !this.ctx.session.isTtsrAbortPending) {
						const retryAttempt = this.ctx.session.retryAttempt;
						errorMessage =
							retryAttempt > 0
								? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
								: "Operation aborted";
						this.ctx.streamingMessage.errorMessage = errorMessage;
					}
					if (this.ctx.session.isTtsrAbortPending && this.ctx.streamingMessage.stopReason === "aborted") {
						const msgWithoutAbort = { ...this.ctx.streamingMessage, stopReason: "stop" as const };
						this.ctx.streamingComponent.updateContent(msgWithoutAbort);
					} else {
						this.ctx.streamingComponent.updateContent(this.ctx.streamingMessage);
					}

					if (
						this.ctx.streamingMessage.stopReason !== "aborted" &&
						this.ctx.streamingMessage.stopReason !== "error"
					) {
						for (const [toolCallId, component] of this.ctx.pendingTools.entries()) {
							component.setArgsComplete(toolCallId);
						}
					}
					this.ctx.streamingComponent = undefined;
					this.ctx.streamingMessage = undefined;
					this.ctx.statusLine.invalidate();
					this.ctx.updateEditorTopBorder();
				}
				this.ctx.ui.requestRender();
				break;

			case "tool_execution_start": {
				if (!this.ctx.pendingTools.has(event.toolCallId)) {
					if (event.toolName === "read") {
						const group = this.getReadGroup();
						group.updateArgs(event.args, event.toolCallId);
						this.ctx.pendingTools.set(event.toolCallId, group);
						this.ctx.ui.requestRender();
						break;
					}

					this.resetReadGroup();
					const tool = this.ctx.session.getToolByName(event.toolName);
					const component = new ToolExecutionComponent(
						event.toolName,
						event.args,
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
					this.ctx.pendingTools.set(event.toolCallId, component);
					this.ctx.ui.requestRender();
				}
				break;
			}

			case "tool_execution_update": {
				const component = this.ctx.pendingTools.get(event.toolCallId);
				if (component) {
					component.updateResult({ ...event.partialResult, isError: false }, true, event.toolCallId);
					this.ctx.ui.requestRender();
				}
				break;
			}

			case "tool_execution_end": {
				const component = this.ctx.pendingTools.get(event.toolCallId);
				if (component) {
					component.updateResult({ ...event.result, isError: event.isError }, false, event.toolCallId);
					this.ctx.pendingTools.delete(event.toolCallId);
					this.ctx.ui.requestRender();
				}
				// Update todo display when todo_write tool completes
				if (event.toolName === "todo_write" && !event.isError) {
					const details = event.result.details as { todos?: TodoItem[] } | undefined;
					if (details?.todos) {
						this.ctx.setTodos(details.todos);
					}
				}
				if (event.toolName === "enter_plan_mode" && !event.isError) {
					const details = event.result.details as import("../../tools").EnterPlanModeDetails | undefined;
					if (details) {
						await this.ctx.handleEnterPlanModeTool(details);
					}
				}
				if (event.toolName === "exit_plan_mode" && !event.isError) {
					const details = event.result.details as ExitPlanModeDetails | undefined;
					if (details) {
						await this.ctx.handleExitPlanModeTool(details);
					}
				}
				break;
			}

			case "agent_end":
				if (this.ctx.loadingAnimation) {
					this.ctx.loadingAnimation.stop();
					this.ctx.loadingAnimation = undefined;
					this.ctx.statusContainer.clear();
				}
				if (this.ctx.streamingComponent) {
					this.ctx.chatContainer.removeChild(this.ctx.streamingComponent);
					this.ctx.streamingComponent = undefined;
					this.ctx.streamingMessage = undefined;
				}
				this.ctx.pendingTools.clear();
				this.ctx.ui.requestRender();
				this.sendCompletionNotification();
				break;

			case "auto_compaction_start": {
				this.ctx.autoCompactionEscapeHandler = this.ctx.editor.onEscape;
				this.ctx.editor.onEscape = () => {
					this.ctx.session.abortCompaction();
				};
				this.ctx.statusContainer.clear();
				const reasonText = event.reason === "overflow" ? "Context overflow detected, " : "";
				this.ctx.autoCompactionLoader = new Loader(
					this.ctx.ui,
					spinner => theme.fg("accent", spinner),
					text => theme.fg("muted", text),
					`${reasonText}Auto-compacting${theme.format.ellipsis} (esc to cancel)`,
					getSymbolTheme().spinnerFrames,
				);
				this.ctx.statusContainer.addChild(this.ctx.autoCompactionLoader);
				this.ctx.ui.requestRender();
				break;
			}

			case "auto_compaction_end": {
				if (this.ctx.autoCompactionEscapeHandler) {
					this.ctx.editor.onEscape = this.ctx.autoCompactionEscapeHandler;
					this.ctx.autoCompactionEscapeHandler = undefined;
				}
				if (this.ctx.autoCompactionLoader) {
					this.ctx.autoCompactionLoader.stop();
					this.ctx.autoCompactionLoader = undefined;
					this.ctx.statusContainer.clear();
				}
				if (event.aborted) {
					this.ctx.showStatus("Auto-compaction cancelled");
				} else if (event.result) {
					this.ctx.chatContainer.clear();
					this.ctx.rebuildChatFromMessages();
					this.ctx.addMessageToChat({
						role: "compactionSummary",
						tokensBefore: event.result.tokensBefore,
						summary: event.result.summary,
						timestamp: Date.now(),
					});
					this.ctx.statusLine.invalidate();
					this.ctx.updateEditorTopBorder();
				} else {
					this.ctx.showWarning("Auto-compaction failed; continuing without compaction");
				}
				await this.ctx.flushCompactionQueue({ willRetry: event.willRetry });
				this.ctx.ui.requestRender();
				break;
			}

			case "auto_retry_start": {
				this.ctx.retryEscapeHandler = this.ctx.editor.onEscape;
				this.ctx.editor.onEscape = () => {
					this.ctx.session.abortRetry();
				};
				this.ctx.statusContainer.clear();
				const delaySeconds = Math.round(event.delayMs / 1000);
				this.ctx.retryLoader = new Loader(
					this.ctx.ui,
					spinner => theme.fg("warning", spinner),
					text => theme.fg("muted", text),
					`Retrying (${event.attempt}/${event.maxAttempts}) in ${delaySeconds}s${theme.format.ellipsis} (esc to cancel)`,
					getSymbolTheme().spinnerFrames,
				);
				this.ctx.statusContainer.addChild(this.ctx.retryLoader);
				this.ctx.ui.requestRender();
				break;
			}

			case "auto_retry_end": {
				if (this.ctx.retryEscapeHandler) {
					this.ctx.editor.onEscape = this.ctx.retryEscapeHandler;
					this.ctx.retryEscapeHandler = undefined;
				}
				if (this.ctx.retryLoader) {
					this.ctx.retryLoader.stop();
					this.ctx.retryLoader = undefined;
					this.ctx.statusContainer.clear();
				}
				if (!event.success) {
					this.ctx.showError(
						`Retry failed after ${event.attempt} attempts: ${event.finalError || "Unknown error"}`,
					);
				}
				this.ctx.ui.requestRender();
				break;
			}

			case "ttsr_triggered": {
				const component = new TtsrNotificationComponent(event.rules);
				component.setExpanded(this.ctx.toolOutputExpanded);
				this.ctx.chatContainer.addChild(component);
				this.ctx.ui.requestRender();
				break;
			}

			case "todo_reminder": {
				const component = new TodoReminderComponent(event.todos, event.attempt, event.maxAttempts);
				this.ctx.chatContainer.addChild(component);
				this.ctx.ui.requestRender();
				break;
			}
		}
	}

	sendCompletionNotification(): void {
		if (this.ctx.isBackgrounded === false) return;
		if (isNotificationSuppressed()) return;
		const method = this.ctx.settingsManager.getNotificationOnComplete();
		if (method === "off") return;
		const protocol = method === "auto" ? detectNotificationProtocol() : method;
		const title = this.ctx.sessionManager.getSessionTitle();
		const message = title ? `${title}: Complete` : "Complete";
		sendNotification(protocol, message);
	}

	async handleBackgroundEvent(event: AgentSessionEvent): Promise<void> {
		if (event.type !== "agent_end") {
			return;
		}
		if (this.ctx.session.queuedMessageCount > 0 || this.ctx.session.isStreaming) {
			return;
		}
		this.sendCompletionNotification();
		await this.ctx.shutdown();
	}
}
