import type { Component, TUI } from "@oh-my-pi/pi-tui";
import { Spacer, Text } from "@oh-my-pi/pi-tui";
import type {
	ExtensionActions,
	ExtensionCommandContextActions,
	ExtensionContextActions,
	ExtensionError,
	ExtensionUIContext,
} from "../../../core/extensions/index";
import { KeybindingsManager } from "../../../core/keybindings";
import { logger } from "../../../core/logger";
import { setTerminalTitle } from "../../../core/title-generator";
import { HookEditorComponent } from "../components/hook-editor";
import { HookInputComponent } from "../components/hook-input";
import { HookSelectorComponent } from "../components/hook-selector";
import { getAvailableThemesWithPaths, getThemeByName, setTheme, type Theme, theme } from "../theme/theme";
import type { InteractiveModeContext } from "../types";

export class ExtensionUiController {
	constructor(private ctx: InteractiveModeContext) {}

	/**
	 * Initialize the hook system with TUI-based UI context.
	 */
	async initHooksAndCustomTools(): Promise<void> {
		// Create and set hook & tool UI context
		const uiContext: ExtensionUIContext = {
			select: (title, options, dialogOptions) => this.showHookSelector(title, options, dialogOptions?.initialIndex),
			confirm: (title, message, _dialogOptions) => this.showHookConfirm(title, message),
			input: (title, placeholder, _dialogOptions) => this.showHookInput(title, placeholder),
			notify: (message, type) => this.showHookNotify(message, type),
			setStatus: (key, text) => this.setHookStatus(key, text),
			setWidget: (key, content) => this.setHookWidget(key, content),
			setTitle: (title) => setTerminalTitle(title),
			custom: (factory, _options) => this.showHookCustom(factory),
			setEditorText: (text) => this.ctx.editor.setText(text),
			getEditorText: () => this.ctx.editor.getText(),
			editor: (title, prefill) => this.showHookEditor(title, prefill),
			get theme() {
				return theme;
			},
			getAllThemes: () => getAvailableThemesWithPaths().map((t) => ({ name: t.name, path: t.path })),
			getTheme: (name) => getThemeByName(name),
			setTheme: (themeArg) => {
				if (typeof themeArg === "string") {
					return setTheme(themeArg, true);
				}
				// Theme object passed directly - not supported in current implementation
				return { success: false, error: "Direct theme object not supported" };
			},
			setFooter: () => {},
			setHeader: () => {},
			setEditorComponent: () => {},
		};
		this.ctx.setToolUIContext(uiContext, true);

		const extensionRunner = this.ctx.session.extensionRunner;
		if (!extensionRunner) {
			return; // No hooks loaded
		}

		const actions: ExtensionActions = {
			sendMessage: (message, options) => {
				const wasStreaming = this.ctx.session.isStreaming;
				this.ctx.session
					.sendCustomMessage(message, options)
					.then(() => {
						// For non-streaming cases with display=true, update UI
						// (streaming cases update via message_end event)
						if (!this.ctx.isBackgrounded && !wasStreaming && message.display) {
							this.ctx.rebuildChatFromMessages();
						}
					})
					.catch((err: unknown) => {
						this.ctx.showError(
							`Extension sendMessage failed: ${err instanceof Error ? err.message : String(err)}`,
						);
					});
			},
			sendUserMessage: (content, options) => {
				this.ctx.session.sendUserMessage(content, options).catch((err: unknown) => {
					this.ctx.showError(
						`Extension sendUserMessage failed: ${err instanceof Error ? err.message : String(err)}`,
					);
				});
			},
			appendEntry: (customType, data) => {
				this.ctx.sessionManager.appendCustomEntry(customType, data);
			},
			setLabel: (targetId, label) => {
				this.ctx.sessionManager.appendLabelChange(targetId, label);
			},
			getActiveTools: () => this.ctx.session.getActiveToolNames(),
			getAllTools: () => this.ctx.session.getAllToolNames(),
			setActiveTools: (toolNames) => this.ctx.session.setActiveToolsByName(toolNames),
			setModel: async (model) => {
				const key = await this.ctx.session.modelRegistry.getApiKey(model);
				if (!key) return false;
				await this.ctx.session.setModel(model);
				return true;
			},
			getThinkingLevel: () => this.ctx.session.thinkingLevel,
			setThinkingLevel: (level) => this.ctx.session.setThinkingLevel(level),
		};
		const contextActions: ExtensionContextActions = {
			getModel: () => this.ctx.session.model,
			isIdle: () => !this.ctx.session.isStreaming,
			abort: () => this.ctx.session.abort(),
			hasPendingMessages: () => this.ctx.session.queuedMessageCount > 0,
			shutdown: () => {
				// Signal shutdown request (will be handled by main loop)
			},
			getContextUsage: () => this.ctx.session.getContextUsage(),
			compact: async (instructionsOrOptions) => {
				const instructions = typeof instructionsOrOptions === "string" ? instructionsOrOptions : undefined;
				const options =
					instructionsOrOptions && typeof instructionsOrOptions === "object" ? instructionsOrOptions : undefined;
				await this.ctx.session.compact(instructions, options);
			},
		};
		const commandActions: ExtensionCommandContextActions = {
			getContextUsage: () => this.ctx.session.getContextUsage(),
			waitForIdle: () => this.ctx.session.agent.waitForIdle(),
			newSession: async (options) => {
				// Stop any loading animation
				if (this.ctx.loadingAnimation) {
					this.ctx.loadingAnimation.stop();
					this.ctx.loadingAnimation = undefined;
				}
				this.ctx.statusContainer.clear();

				// Create new session
				const success = await this.ctx.session.newSession({ parentSession: options?.parentSession });
				if (!success) {
					return { cancelled: true };
				}

				// Call setup callback if provided
				if (options?.setup) {
					await options.setup(this.ctx.sessionManager);
				}

				// Clear UI state
				this.ctx.chatContainer.clear();
				this.ctx.pendingMessagesContainer.clear();
				this.ctx.compactionQueuedMessages = [];
				this.ctx.streamingComponent = undefined;
				this.ctx.streamingMessage = undefined;
				this.ctx.pendingTools.clear();

				this.ctx.chatContainer.addChild(new Spacer(1));
				this.ctx.chatContainer.addChild(
					new Text(`${theme.fg("accent", `${theme.status.success} New session started`)}`, 1, 1),
				);
				await this.ctx.reloadTodos();
				this.ctx.ui.requestRender();

				return { cancelled: false };
			},
			branch: async (entryId) => {
				const result = await this.ctx.session.branch(entryId);
				if (result.cancelled) {
					return { cancelled: true };
				}

				// Update UI
				this.ctx.chatContainer.clear();
				this.ctx.renderInitialMessages();
				await this.ctx.reloadTodos();
				this.ctx.editor.setText(result.selectedText);
				this.ctx.showStatus("Branched to new session");

				return { cancelled: false };
			},
			navigateTree: async (targetId, options) => {
				const result = await this.ctx.session.navigateTree(targetId, { summarize: options?.summarize });
				if (result.cancelled) {
					return { cancelled: true };
				}

				// Update UI
				this.ctx.chatContainer.clear();
				this.ctx.renderInitialMessages();
				await this.ctx.reloadTodos();
				if (result.editorText) {
					this.ctx.editor.setText(result.editorText);
				}
				this.ctx.showStatus("Navigated to selected point");

				return { cancelled: false };
			},
			compact: async (instructionsOrOptions) => {
				const instructions = typeof instructionsOrOptions === "string" ? instructionsOrOptions : undefined;
				const options =
					instructionsOrOptions && typeof instructionsOrOptions === "object" ? instructionsOrOptions : undefined;
				if (this.ctx.isBackgrounded) {
					await this.ctx.session.compact(instructions, options);
					return;
				}
				await this.ctx.executeCompaction(instructionsOrOptions, false);
			},
		};

		extensionRunner.initialize(actions, contextActions, commandActions, uiContext);

		// Subscribe to extension errors
		extensionRunner.onError((error: ExtensionError) => {
			this.showExtensionError(error.extensionPath, error.error);
		});

		// Emit session_start event
		await extensionRunner.emit({
			type: "session_start",
		});
	}

	setHookWidget(key: string, content: unknown): void {
		this.ctx.statusLine.setHookStatus(key, String(content));
		this.ctx.ui.requestRender();
	}

	initializeHookRunner(uiContext: ExtensionUIContext, _hasUI: boolean): void {
		const extensionRunner = this.ctx.session.extensionRunner;
		if (!extensionRunner) {
			return;
		}

		const actions: ExtensionActions = {
			sendMessage: (message, options) => {
				const wasStreaming = this.ctx.session.isStreaming;
				this.ctx.session
					.sendCustomMessage(message, options)
					.then(() => {
						// For non-streaming cases with display=true, update UI
						// (streaming cases update via message_end event)
						if (!this.ctx.isBackgrounded && !wasStreaming && message.display) {
							this.ctx.rebuildChatFromMessages();
						}
					})
					.catch((err: unknown) => {
						const errorText = `Extension sendMessage failed: ${err instanceof Error ? err.message : String(err)}`;
						if (this.ctx.isBackgrounded) {
							logger.error(errorText);
							return;
						}
						this.ctx.showError(errorText);
					});
			},
			sendUserMessage: (content, options) => {
				this.ctx.session.sendUserMessage(content, options).catch((err: unknown) => {
					this.ctx.showError(
						`Extension sendUserMessage failed: ${err instanceof Error ? err.message : String(err)}`,
					);
				});
			},
			appendEntry: (customType, data) => {
				this.ctx.sessionManager.appendCustomEntry(customType, data);
			},
			setLabel: (targetId, label) => {
				this.ctx.sessionManager.appendLabelChange(targetId, label);
			},
			getActiveTools: () => this.ctx.session.getActiveToolNames(),
			getAllTools: () => this.ctx.session.getAllToolNames(),
			setActiveTools: (toolNames) => this.ctx.session.setActiveToolsByName(toolNames),
			setModel: async (model) => {
				const key = await this.ctx.session.modelRegistry.getApiKey(model);
				if (!key) return false;
				await this.ctx.session.setModel(model);
				return true;
			},
			getThinkingLevel: () => this.ctx.session.thinkingLevel,
			setThinkingLevel: (level) => this.ctx.session.setThinkingLevel(level),
		};
		const contextActions: ExtensionContextActions = {
			getModel: () => this.ctx.session.model,
			isIdle: () => !this.ctx.session.isStreaming,
			abort: () => this.ctx.session.abort(),
			hasPendingMessages: () => this.ctx.session.queuedMessageCount > 0,
			shutdown: () => {
				// Signal shutdown request (will be handled by main loop)
			},
			getContextUsage: () => this.ctx.session.getContextUsage(),
			compact: async (instructionsOrOptions) => {
				const instructions = typeof instructionsOrOptions === "string" ? instructionsOrOptions : undefined;
				const options =
					instructionsOrOptions && typeof instructionsOrOptions === "object" ? instructionsOrOptions : undefined;
				await this.ctx.session.compact(instructions, options);
			},
		};
		const commandActions: ExtensionCommandContextActions = {
			getContextUsage: () => this.ctx.session.getContextUsage(),
			waitForIdle: () => this.ctx.session.agent.waitForIdle(),
			newSession: async (options) => {
				if (this.ctx.isBackgrounded) {
					return { cancelled: true };
				}
				// Stop any loading animation
				if (this.ctx.loadingAnimation) {
					this.ctx.loadingAnimation.stop();
					this.ctx.loadingAnimation = undefined;
				}
				this.ctx.statusContainer.clear();

				// Create new session
				const success = await this.ctx.session.newSession({ parentSession: options?.parentSession });
				if (!success) {
					return { cancelled: true };
				}

				// Call setup callback if provided
				if (options?.setup) {
					await options.setup(this.ctx.sessionManager);
				}

				// Clear UI state
				this.ctx.chatContainer.clear();
				this.ctx.pendingMessagesContainer.clear();
				this.ctx.compactionQueuedMessages = [];
				this.ctx.streamingComponent = undefined;
				this.ctx.streamingMessage = undefined;
				this.ctx.pendingTools.clear();

				this.ctx.chatContainer.addChild(new Spacer(1));
				this.ctx.chatContainer.addChild(
					new Text(`${theme.fg("accent", `${theme.status.success} New session started`)}`, 1, 1),
				);
				await this.ctx.reloadTodos();
				this.ctx.ui.requestRender();

				return { cancelled: false };
			},
			branch: async (entryId) => {
				if (this.ctx.isBackgrounded) {
					return { cancelled: true };
				}
				const result = await this.ctx.session.branch(entryId);
				if (result.cancelled) {
					return { cancelled: true };
				}

				// Update UI
				this.ctx.chatContainer.clear();
				this.ctx.renderInitialMessages();
				await this.ctx.reloadTodos();
				this.ctx.editor.setText(result.selectedText);
				this.ctx.showStatus("Branched to new session");

				return { cancelled: false };
			},
			navigateTree: async (targetId, options) => {
				if (this.ctx.isBackgrounded) {
					return { cancelled: true };
				}
				const result = await this.ctx.session.navigateTree(targetId, { summarize: options?.summarize });
				if (result.cancelled) {
					return { cancelled: true };
				}

				// Update UI
				this.ctx.chatContainer.clear();
				this.ctx.renderInitialMessages();
				await this.ctx.reloadTodos();
				if (result.editorText) {
					this.ctx.editor.setText(result.editorText);
				}
				this.ctx.showStatus("Navigated to selected point");

				return { cancelled: false };
			},
			compact: async (instructionsOrOptions) => {
				const instructions = typeof instructionsOrOptions === "string" ? instructionsOrOptions : undefined;
				const options =
					instructionsOrOptions && typeof instructionsOrOptions === "object" ? instructionsOrOptions : undefined;
				if (this.ctx.isBackgrounded) {
					await this.ctx.session.compact(instructions, options);
					return;
				}
				await this.ctx.executeCompaction(instructionsOrOptions, false);
			},
		};

		extensionRunner.initialize(actions, contextActions, commandActions, uiContext);
	}

	createBackgroundUiContext(): ExtensionUIContext {
		return {
			select: async (_title: string, _options: string[], _dialogOptions) => undefined,
			confirm: async (_title: string, _message: string, _dialogOptions) => false,
			input: async (_title: string, _placeholder?: string, _dialogOptions?: unknown) => undefined,
			notify: () => {},
			setStatus: () => {},
			setWidget: () => {},
			setTitle: () => {},
			custom: async () => undefined as never,
			setEditorText: () => {},
			getEditorText: () => "",
			editor: async () => undefined,
			get theme() {
				return theme;
			},
			getAllThemes: () => [],
			getTheme: () => undefined,
			setTheme: () => ({ success: false, error: "Background mode" }),
			setFooter: () => {},
			setHeader: () => {},
			setEditorComponent: () => {},
		};
	}

	/**
	 * Emit session event to all extension tools.
	 */
	async emitCustomToolSessionEvent(
		reason: "start" | "switch" | "branch" | "tree" | "shutdown",
		previousSessionFile?: string,
	): Promise<void> {
		const event = { reason, previousSessionFile };
		const uiContext = this.ctx.session.extensionRunner?.getUIContext();
		if (!uiContext) {
			return;
		}
		for (const registeredTool of this.ctx.session.extensionRunner?.getAllRegisteredTools() ?? []) {
			if (registeredTool.definition.onSession) {
				try {
					await registeredTool.definition.onSession(event, {
						ui: uiContext,
						getContextUsage: () => this.ctx.session.getContextUsage(),
						compact: async (instructionsOrOptions) => {
							const instructions = typeof instructionsOrOptions === "string" ? instructionsOrOptions : undefined;
							const options =
								instructionsOrOptions && typeof instructionsOrOptions === "object"
									? instructionsOrOptions
									: undefined;
							await this.ctx.session.compact(instructions, options);
						},
						hasUI: !this.ctx.isBackgrounded,
						cwd: this.ctx.sessionManager.getCwd(),
						sessionManager: this.ctx.session.sessionManager,
						modelRegistry: this.ctx.session.modelRegistry,
						model: this.ctx.session.model,
						isIdle: () => !this.ctx.session.isStreaming,
						hasPendingMessages: () => this.ctx.session.queuedMessageCount > 0,
						hasQueuedMessages: () => this.ctx.session.queuedMessageCount > 0,
						abort: () => {
							this.ctx.session.abort();
						},
						shutdown: () => {
							// Signal shutdown request
						},
					});
				} catch (err) {
					this.showToolError(registeredTool.definition.name, err instanceof Error ? err.message : String(err));
				}
			}
		}
	}

	/**
	 * Show a tool error in the chat.
	 */
	showToolError(toolName: string, error: string): void {
		if (this.ctx.isBackgrounded) {
			logger.error(`Tool "${toolName}" error: ${error}`);
			return;
		}
		const errorText = new Text(theme.fg("error", `Tool "${toolName}" error: ${error}`), 1, 0);
		this.ctx.chatContainer.addChild(errorText);
		this.ctx.ui.requestRender();
	}

	/**
	 * Set hook status text in the footer.
	 */
	setHookStatus(key: string, text: string | undefined): void {
		if (this.ctx.isBackgrounded) {
			return;
		}
		this.ctx.statusLine.setHookStatus(key, text);
		this.ctx.ui.requestRender();
	}

	/**
	 * Show a selector for hooks.
	 */
	showHookSelector(title: string, options: string[], initialIndex?: number): Promise<string | undefined> {
		return new Promise((resolve) => {
			this.ctx.hookSelector = new HookSelectorComponent(
				title,
				options,
				(option) => {
					this.hideHookSelector();
					resolve(option);
				},
				() => {
					this.hideHookSelector();
					resolve(undefined);
				},
				{ initialIndex },
			);

			this.ctx.editorContainer.clear();
			this.ctx.editorContainer.addChild(this.ctx.hookSelector);
			this.ctx.ui.setFocus(this.ctx.hookSelector);
			this.ctx.ui.requestRender();
		});
	}

	/**
	 * Hide the hook selector.
	 */
	hideHookSelector(): void {
		this.ctx.editorContainer.clear();
		this.ctx.editorContainer.addChild(this.ctx.editor);
		this.ctx.hookSelector = undefined;
		this.ctx.ui.setFocus(this.ctx.editor);
		this.ctx.ui.requestRender();
	}

	/**
	 * Show a confirmation dialog for hooks.
	 */
	async showHookConfirm(title: string, message: string): Promise<boolean> {
		const result = await this.showHookSelector(`${title}\n${message}`, ["Yes", "No"]);
		return result === "Yes";
	}

	/**
	 * Show a text input for hooks.
	 */
	showHookInput(title: string, placeholder?: string): Promise<string | undefined> {
		return new Promise((resolve) => {
			this.ctx.hookInput = new HookInputComponent(
				title,
				placeholder,
				(value) => {
					this.hideHookInput();
					resolve(value);
				},
				() => {
					this.hideHookInput();
					resolve(undefined);
				},
			);

			this.ctx.editorContainer.clear();
			this.ctx.editorContainer.addChild(this.ctx.hookInput);
			this.ctx.ui.setFocus(this.ctx.hookInput);
			this.ctx.ui.requestRender();
		});
	}

	/**
	 * Hide the hook input.
	 */
	hideHookInput(): void {
		this.ctx.editorContainer.clear();
		this.ctx.editorContainer.addChild(this.ctx.editor);
		this.ctx.hookInput = undefined;
		this.ctx.ui.setFocus(this.ctx.editor);
		this.ctx.ui.requestRender();
	}

	/**
	 * Show a multi-line editor for hooks (with Ctrl+G support).
	 */
	showHookEditor(title: string, prefill?: string): Promise<string | undefined> {
		return new Promise((resolve) => {
			this.ctx.hookEditor = new HookEditorComponent(
				this.ctx.ui,
				title,
				prefill,
				(value) => {
					this.hideHookEditor();
					resolve(value);
				},
				() => {
					this.hideHookEditor();
					resolve(undefined);
				},
			);

			this.ctx.editorContainer.clear();
			this.ctx.editorContainer.addChild(this.ctx.hookEditor);
			this.ctx.ui.setFocus(this.ctx.hookEditor);
			this.ctx.ui.requestRender();
		});
	}

	/**
	 * Hide the hook editor.
	 */
	hideHookEditor(): void {
		this.ctx.editorContainer.clear();
		this.ctx.editorContainer.addChild(this.ctx.editor);
		this.ctx.hookEditor = undefined;
		this.ctx.ui.setFocus(this.ctx.editor);
		this.ctx.ui.requestRender();
	}

	/**
	 * Show a notification for hooks.
	 */
	showHookNotify(message: string, type?: "info" | "warning" | "error"): void {
		if (type === "error") {
			this.ctx.showError(message);
		} else if (type === "warning") {
			this.ctx.showWarning(message);
		} else {
			this.ctx.showStatus(message);
		}
	}

	/**
	 * Show a custom component with keyboard focus.
	 */
	async showHookCustom<T>(
		factory: (
			tui: TUI,
			theme: Theme,
			keybindings: KeybindingsManager,
			done: (result: T) => void,
		) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
	): Promise<T> {
		const savedText = this.ctx.editor.getText();
		const keybindings = KeybindingsManager.inMemory();

		return new Promise((resolve) => {
			let component: Component & { dispose?(): void };

			const close = (result: T) => {
				component.dispose?.();
				this.ctx.editorContainer.clear();
				this.ctx.editorContainer.addChild(this.ctx.editor);
				this.ctx.editor.setText(savedText);
				this.ctx.ui.setFocus(this.ctx.editor);
				this.ctx.ui.requestRender();
				resolve(result);
			};

			Promise.resolve(factory(this.ctx.ui, theme, keybindings, close)).then((c) => {
				component = c;
				this.ctx.editorContainer.clear();
				this.ctx.editorContainer.addChild(component);
				this.ctx.ui.setFocus(component);
				this.ctx.ui.requestRender();
			});
		});
	}

	/**
	 * Show an extension error in the UI.
	 */
	showExtensionError(extensionPath: string, error: string): void {
		const errorText = new Text(theme.fg("error", `Extension "${extensionPath}" error: ${error}`), 1, 0);
		this.ctx.chatContainer.addChild(errorText);
		this.ctx.ui.requestRender();
	}
}
