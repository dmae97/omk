import type { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import type { OAuthProvider } from "@oh-my-pi/pi-ai";
import type { Component } from "@oh-my-pi/pi-tui";
import { Input, Loader, Spacer, Text } from "@oh-my-pi/pi-tui";
import { getAgentDbPath } from "$c/config";
import { disableProvider, enableProvider } from "$c/discovery";
import { AssistantMessageComponent } from "$c/modes/components/assistant-message";
import { ExtensionDashboard } from "$c/modes/components/extensions";
import { HistorySearchComponent } from "$c/modes/components/history-search";
import { ModelSelectorComponent } from "$c/modes/components/model-selector";
import { OAuthSelectorComponent } from "$c/modes/components/oauth-selector";
import { SessionSelectorComponent } from "$c/modes/components/session-selector";
import { SettingsSelectorComponent } from "$c/modes/components/settings-selector";
import { ToolExecutionComponent } from "$c/modes/components/tool-execution";
import { TreeSelectorComponent } from "$c/modes/components/tree-selector";
import { UserMessageSelectorComponent } from "$c/modes/components/user-message-selector";
import { getAvailableThemes, getSymbolTheme, setSymbolPreset, setTheme, theme } from "$c/modes/theme/theme";
import type { InteractiveModeContext } from "$c/modes/types";
import { SessionManager } from "$c/session/session-manager";
import { setPreferredImageProvider, setPreferredWebSearchProvider } from "$c/tools/index";

export class SelectorController {
	constructor(private ctx: InteractiveModeContext) {}

	/**
	 * Shows a selector component in place of the editor.
	 * @param create Factory that receives a `done` callback and returns the component and focus target
	 */
	showSelector(create: (done: () => void) => { component: Component; focus: Component }): void {
		const done = () => {
			this.ctx.editorContainer.clear();
			this.ctx.editorContainer.addChild(this.ctx.editor);
			this.ctx.ui.setFocus(this.ctx.editor);
		};
		const { component, focus } = create(done);
		this.ctx.editorContainer.clear();
		this.ctx.editorContainer.addChild(component);
		this.ctx.ui.setFocus(focus);
		this.ctx.ui.requestRender();
	}

	showSettingsSelector(): void {
		this.showSelector((done) => {
			const selector = new SettingsSelectorComponent(
				this.ctx.settingsManager,
				{
					availableThinkingLevels: this.ctx.session.getAvailableThinkingLevels(),
					thinkingLevel: this.ctx.session.thinkingLevel,
					availableThemes: getAvailableThemes(),
					cwd: process.cwd(),
				},
				{
					onChange: (id, value) => this.handleSettingChange(id, value),
					onThemePreview: (themeName) => {
						const result = setTheme(themeName, true);
						if (result.success) {
							this.ctx.ui.invalidate();
							this.ctx.ui.requestRender();
						}
					},
					onStatusLinePreview: (settings) => {
						// Update status line with preview settings
						const currentSettings = this.ctx.settingsManager.getStatusLineSettings();
						this.ctx.statusLine.updateSettings({ ...currentSettings, ...settings });
						this.ctx.updateEditorTopBorder();
						this.ctx.ui.requestRender();
					},
					getStatusLinePreview: () => {
						// Return the rendered status line for inline preview
						const width = this.ctx.ui.getWidth();
						return this.ctx.statusLine.getTopBorder(width).content;
					},
					onPluginsChanged: () => {
						this.ctx.ui.requestRender();
					},
					onCancel: () => {
						done();
						// Restore status line to saved settings
						this.ctx.statusLine.updateSettings(this.ctx.settingsManager.getStatusLineSettings());
						this.ctx.updateEditorTopBorder();
						this.ctx.ui.requestRender();
					},
				},
			);
			return { component: selector, focus: selector };
		});
	}

	showHistorySearch(): void {
		const historyStorage = this.ctx.historyStorage;
		if (!historyStorage) return;

		this.showSelector((done) => {
			const component = new HistorySearchComponent(
				historyStorage,
				(prompt) => {
					done();
					this.ctx.editor.setText(prompt);
					this.ctx.ui.requestRender();
				},
				() => {
					done();
					this.ctx.ui.requestRender();
				},
			);
			return { component, focus: component };
		});
	}

	/**
	 * Show the Extension Control Center dashboard.
	 * Replaces /status with a unified view of all providers and extensions.
	 */
	async showExtensionsDashboard(): Promise<void> {
		const dashboard = await ExtensionDashboard.create(
			process.cwd(),
			this.ctx.settingsManager,
			this.ctx.ui.terminal.rows,
		);
		this.showSelector((done) => {
			dashboard.onClose = () => {
				done();
				this.ctx.ui.requestRender();
			};
			return { component: dashboard, focus: dashboard };
		});
	}

	/**
	 * Handle setting changes from the settings selector.
	 * Most settings are saved directly via SettingsManager in the definitions.
	 * This handles side effects and session-specific settings.
	 */
	handleSettingChange(id: string, value: string | boolean): void {
		// Discovery provider toggles
		if (id.startsWith("discovery.")) {
			const providerId = id.replace("discovery.", "");
			if (value) {
				enableProvider(providerId);
			} else {
				disableProvider(providerId);
			}
			return;
		}

		switch (id) {
			// Session-managed settings (not in SettingsManager)
			case "autoCompact":
				this.ctx.session.setAutoCompactionEnabled(value as boolean);
				this.ctx.statusLine.setAutoCompactEnabled(value as boolean);
				break;
			case "steeringMode":
				this.ctx.session.setSteeringMode(value as "all" | "one-at-a-time");
				break;
			case "followUpMode":
				this.ctx.session.setFollowUpMode(value as "all" | "one-at-a-time");
				break;
			case "interruptMode":
				this.ctx.session.setInterruptMode(value as "immediate" | "wait");
				break;
			case "thinkingLevel":
				this.ctx.session.setThinkingLevel(value as ThinkingLevel);
				this.ctx.statusLine.invalidate();
				this.ctx.updateEditorBorderColor();
				break;

			// Settings with UI side effects
			case "showImages":
				for (const child of this.ctx.chatContainer.children) {
					if (child instanceof ToolExecutionComponent) {
						child.setShowImages(value as boolean);
					}
				}
				break;
			case "hideThinking":
				this.ctx.hideThinkingBlock = value as boolean;
				for (const child of this.ctx.chatContainer.children) {
					if (child instanceof AssistantMessageComponent) {
						child.setHideThinkingBlock(value as boolean);
					}
				}
				this.ctx.chatContainer.clear();
				this.ctx.rebuildChatFromMessages();
				break;
			case "theme": {
				const result = setTheme(value as string, true);
				this.ctx.statusLine.invalidate();
				this.ctx.updateEditorTopBorder();
				this.ctx.ui.invalidate();
				if (!result.success) {
					this.ctx.showError(`Failed to load theme "${value}": ${result.error}\nFell back to dark theme.`);
				}
				break;
			}
			case "symbolPreset": {
				setSymbolPreset(value as "unicode" | "nerd" | "ascii");
				this.ctx.statusLine.invalidate();
				this.ctx.updateEditorTopBorder();
				this.ctx.ui.invalidate();
				break;
			}
			case "statusLinePreset":
			case "statusLineSeparator":
			case "statusLineShowHooks":
			case "statusLineSegments":
			case "statusLineModelThinking":
			case "statusLinePathAbbreviate":
			case "statusLinePathMaxLength":
			case "statusLinePathStripWorkPrefix":
			case "statusLineGitShowBranch":
			case "statusLineGitShowStaged":
			case "statusLineGitShowUnstaged":
			case "statusLineGitShowUntracked":
			case "statusLineTimeFormat":
			case "statusLineTimeShowSeconds": {
				this.ctx.statusLine.updateSettings(this.ctx.settingsManager.getStatusLineSettings());
				this.ctx.updateEditorTopBorder();
				this.ctx.ui.requestRender();
				break;
			}

			// Provider settings - update runtime preferences
			case "webSearchProvider":
				setPreferredWebSearchProvider(value as "auto" | "exa" | "perplexity" | "anthropic");
				break;
			case "imageProvider":
				setPreferredImageProvider(value as "auto" | "gemini" | "openrouter");
				break;

			// All other settings are handled by the definitions (get/set on SettingsManager)
			// No additional side effects needed
		}
	}

	showModelSelector(options?: { temporaryOnly?: boolean }): void {
		this.showSelector((done) => {
			const selector = new ModelSelectorComponent(
				this.ctx.ui,
				this.ctx.session.model,
				this.ctx.settingsManager,
				this.ctx.session.modelRegistry,
				this.ctx.session.scopedModels,
				async (model, role) => {
					try {
						if (role === "temporary") {
							// Temporary: update agent state but don't persist to settings
							await this.ctx.session.setModelTemporary(model);
							this.ctx.statusLine.invalidate();
							this.ctx.updateEditorBorderColor();
							this.ctx.showStatus(`Temporary model: ${model.id}`);
							done();
							this.ctx.ui.requestRender();
						} else if (role === "default") {
							// Default: update agent state and persist
							await this.ctx.session.setModel(model, role);
							this.ctx.statusLine.invalidate();
							this.ctx.updateEditorBorderColor();
							this.ctx.showStatus(`Default model: ${model.id}`);
							// Don't call done() - selector stays open for role assignment
						} else {
							// Other roles (smol, slow): just update settings, not current model
							const roleLabel = role === "smol" ? "Smol" : role;
							this.ctx.showStatus(`${roleLabel} model: ${model.id}`);
							// Don't call done() - selector stays open
						}
					} catch (error) {
						this.ctx.showError(error instanceof Error ? error.message : String(error));
					}
				},
				() => {
					done();
					this.ctx.ui.requestRender();
				},
				options,
			);
			return { component: selector, focus: selector };
		});
	}

	showUserMessageSelector(): void {
		const userMessages = this.ctx.session.getUserMessagesForBranching();

		if (userMessages.length === 0) {
			this.ctx.showStatus("No messages to branch from");
			return;
		}

		this.showSelector((done) => {
			const selector = new UserMessageSelectorComponent(
				userMessages.map((m) => ({ id: m.entryId, text: m.text })),
				async (entryId) => {
					const result = await this.ctx.session.branch(entryId);
					if (result.cancelled) {
						// Hook cancelled the branch
						done();
						this.ctx.ui.requestRender();
						return;
					}

					this.ctx.chatContainer.clear();
					this.ctx.renderInitialMessages();
					this.ctx.editor.setText(result.selectedText);
					done();
					this.ctx.showStatus("Branched to new session");
				},
				() => {
					done();
					this.ctx.ui.requestRender();
				},
			);
			return { component: selector, focus: selector.getMessageList() };
		});
	}

	showTreeSelector(): void {
		const tree = this.ctx.sessionManager.getTree();
		const realLeafId = this.ctx.sessionManager.getLeafId();

		// Find the visible leaf for display (skip metadata entries like labels)
		let visibleLeafId = realLeafId;
		while (visibleLeafId) {
			const entry = this.ctx.sessionManager.getEntry(visibleLeafId);
			if (!entry) break;
			if (entry.type !== "label" && entry.type !== "custom") break;
			visibleLeafId = entry.parentId ?? null;
		}

		if (tree.length === 0) {
			this.ctx.showStatus("No entries in session");
			return;
		}

		this.showSelector((done) => {
			const selector = new TreeSelectorComponent(
				tree,
				visibleLeafId,
				this.ctx.ui.terminal.rows,
				async (entryId) => {
					// Selecting the visible leaf is a no-op (already there)
					if (entryId === visibleLeafId) {
						done();
						this.ctx.showStatus("Already at this point");
						return;
					}

					// Ask about summarization
					done(); // Close selector first

					// Loop until user makes a complete choice or cancels to tree
					let wantsSummary = false;
					let customInstructions: string | undefined;

					const branchSummariesEnabled = this.ctx.settingsManager.getBranchSummaryEnabled();

					while (branchSummariesEnabled) {
						const summaryChoice = await this.ctx.showHookSelector("Summarize branch?", [
							"No summary",
							"Summarize",
							"Summarize with custom prompt",
						]);

						if (summaryChoice === undefined) {
							// User pressed escape - re-show tree selector
							this.showTreeSelector();
							return;
						}

						wantsSummary = summaryChoice !== "No summary";

						if (summaryChoice === "Summarize with custom prompt") {
							customInstructions = await this.ctx.showHookEditor("Custom summarization instructions");
							if (customInstructions === undefined) {
								// User cancelled - loop back to summary selector
								continue;
							}
						}

						// User made a complete choice
						break;
					}

					// Set up escape handler and loader if summarizing
					let summaryLoader: Loader | undefined;
					const originalOnEscape = this.ctx.editor.onEscape;

					if (wantsSummary) {
						this.ctx.editor.onEscape = () => {
							this.ctx.session.abortBranchSummary();
						};
						this.ctx.chatContainer.addChild(new Spacer(1));
						summaryLoader = new Loader(
							this.ctx.ui,
							(spinner) => theme.fg("accent", spinner),
							(text) => theme.fg("muted", text),
							"Summarizing branch... (esc to cancel)",
							getSymbolTheme().spinnerFrames,
						);
						this.ctx.statusContainer.addChild(summaryLoader);
						this.ctx.ui.requestRender();
					}

					try {
						const result = await this.ctx.session.navigateTree(entryId, {
							summarize: wantsSummary,
							customInstructions,
						});

						if (result.aborted) {
							// Summarization aborted - re-show tree selector
							this.ctx.showStatus("Branch summarization cancelled");
							this.showTreeSelector();
							return;
						}
						if (result.cancelled) {
							this.ctx.showStatus("Navigation cancelled");
							return;
						}

						// Update UI
						this.ctx.chatContainer.clear();
						this.ctx.renderInitialMessages();
						await this.ctx.reloadTodos();
						if (result.editorText) {
							this.ctx.editor.setText(result.editorText);
						}
						this.ctx.showStatus("Navigated to selected point");
					} catch (error) {
						this.ctx.showError(error instanceof Error ? error.message : String(error));
					} finally {
						if (summaryLoader) {
							summaryLoader.stop();
							this.ctx.statusContainer.clear();
						}
						this.ctx.editor.onEscape = originalOnEscape;
					}
				},
				() => {
					done();
					this.ctx.ui.requestRender();
				},
				(entryId, label) => {
					this.ctx.sessionManager.appendLabelChange(entryId, label);
					this.ctx.ui.requestRender();
				},
			);
			return { component: selector, focus: selector };
		});
	}

	showSessionSelector(): void {
		this.showSelector((done) => {
			const sessions = SessionManager.list(
				this.ctx.sessionManager.getCwd(),
				this.ctx.sessionManager.getSessionDir(),
			);
			const selector = new SessionSelectorComponent(
				sessions,
				async (sessionPath) => {
					done();
					await this.handleResumeSession(sessionPath);
				},
				() => {
					done();
					this.ctx.ui.requestRender();
				},
				() => {
					void this.ctx.shutdown();
				},
			);
			return { component: selector, focus: selector.getSessionList() };
		});
	}

	async handleResumeSession(sessionPath: string): Promise<void> {
		// Stop loading animation
		if (this.ctx.loadingAnimation) {
			this.ctx.loadingAnimation.stop();
			this.ctx.loadingAnimation = undefined;
		}
		this.ctx.statusContainer.clear();

		// Clear UI state
		this.ctx.pendingMessagesContainer.clear();
		this.ctx.compactionQueuedMessages = [];
		this.ctx.streamingComponent = undefined;
		this.ctx.streamingMessage = undefined;
		this.ctx.pendingTools.clear();

		// Switch session via AgentSession (emits hook and tool session events)
		await this.ctx.session.switchSession(sessionPath);

		// Clear and re-render the chat
		this.ctx.chatContainer.clear();
		this.ctx.renderInitialMessages();
		await this.ctx.reloadTodos();
		this.ctx.showStatus("Resumed session");
	}

	async showOAuthSelector(mode: "login" | "logout"): Promise<void> {
		if (mode === "logout") {
			const providers = this.ctx.session.modelRegistry.authStorage.list();
			const loggedInProviders = providers.filter((p) => this.ctx.session.modelRegistry.authStorage.hasOAuth(p));
			if (loggedInProviders.length === 0) {
				this.ctx.showStatus("No OAuth providers logged in. Use /login first.");
				return;
			}
		}

		this.showSelector((done) => {
			const selector = new OAuthSelectorComponent(
				mode,
				this.ctx.session.modelRegistry.authStorage,
				async (providerId: string) => {
					done();

					if (mode === "login") {
						this.ctx.showStatus(`Logging in to ${providerId}...`);

						try {
							await this.ctx.session.modelRegistry.authStorage.login(providerId as OAuthProvider, {
								onAuth: (info: { url: string; instructions?: string }) => {
									this.ctx.chatContainer.addChild(new Spacer(1));
									this.ctx.chatContainer.addChild(new Text(theme.fg("dim", info.url), 1, 0));
									// Use OSC 8 hyperlink escape sequence for clickable link
									const hyperlink = `\x1b]8;;${info.url}\x07Click here to login\x1b]8;;\x07`;
									this.ctx.chatContainer.addChild(new Text(theme.fg("accent", hyperlink), 1, 0));
									if (info.instructions) {
										this.ctx.chatContainer.addChild(new Spacer(1));
										this.ctx.chatContainer.addChild(new Text(theme.fg("warning", info.instructions), 1, 0));
									}
									this.ctx.ui.requestRender();

									this.ctx.openInBrowser(info.url);
								},
								onPrompt: async (prompt: { message: string; placeholder?: string }) => {
									this.ctx.chatContainer.addChild(new Spacer(1));
									this.ctx.chatContainer.addChild(new Text(theme.fg("warning", prompt.message), 1, 0));
									if (prompt.placeholder) {
										this.ctx.chatContainer.addChild(new Text(theme.fg("dim", prompt.placeholder), 1, 0));
									}
									this.ctx.ui.requestRender();

									return new Promise<string>((resolve) => {
										const codeInput = new Input();
										codeInput.onSubmit = () => {
											const code = codeInput.getValue();
											this.ctx.editorContainer.clear();
											this.ctx.editorContainer.addChild(this.ctx.editor);
											this.ctx.ui.setFocus(this.ctx.editor);
											resolve(code);
										};
										this.ctx.editorContainer.clear();
										this.ctx.editorContainer.addChild(codeInput);
										this.ctx.ui.setFocus(codeInput);
										this.ctx.ui.requestRender();
									});
								},
								onProgress: (message: string) => {
									this.ctx.chatContainer.addChild(new Text(theme.fg("dim", message), 1, 0));
									this.ctx.ui.requestRender();
								},
							});
							// Refresh models to pick up new baseUrl (e.g., github-copilot)
							await this.ctx.session.modelRegistry.refresh();
							this.ctx.chatContainer.addChild(new Spacer(1));
							this.ctx.chatContainer.addChild(
								new Text(
									theme.fg("success", `${theme.status.success} Successfully logged in to ${providerId}`),
									1,
									0,
								),
							);
							this.ctx.chatContainer.addChild(
								new Text(theme.fg("dim", `Credentials saved to ${getAgentDbPath()}`), 1, 0),
							);
							this.ctx.ui.requestRender();
						} catch (error: unknown) {
							this.ctx.showError(`Login failed: ${error instanceof Error ? error.message : String(error)}`);
						}
					} else {
						try {
							await this.ctx.session.modelRegistry.authStorage.logout(providerId);
							// Refresh models to reset baseUrl
							await this.ctx.session.modelRegistry.refresh();
							this.ctx.chatContainer.addChild(new Spacer(1));
							this.ctx.chatContainer.addChild(
								new Text(
									theme.fg("success", `${theme.status.success} Successfully logged out of ${providerId}`),
									1,
									0,
								),
							);
							this.ctx.chatContainer.addChild(
								new Text(theme.fg("dim", `Credentials removed from ${getAgentDbPath()}`), 1, 0),
							);
							this.ctx.ui.requestRender();
						} catch (error: unknown) {
							this.ctx.showError(`Logout failed: ${error instanceof Error ? error.message : String(error)}`);
						}
					}
				},
				() => {
					done();
					this.ctx.ui.requestRender();
				},
			);
			return { component: selector, focus: selector };
		});
	}
}
