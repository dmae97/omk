import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { nanoid } from "nanoid";
import { theme } from "../../modes/theme/theme";
import type { InteractiveModeContext } from "../../modes/types";
import type { AgentSessionEvent } from "../../session/agent-session";
import { readImageFromClipboard } from "../../utils/clipboard";
import { resizeImage } from "../../utils/image-resize";
import { generateSessionTitle, setTerminalTitle } from "../../utils/title-generator";

interface Expandable {
	setExpanded(expanded: boolean): void;
}

function isExpandable(obj: unknown): obj is Expandable {
	return typeof obj === "object" && obj !== null && "setExpanded" in obj && typeof obj.setExpanded === "function";
}

export class InputController {
	constructor(private ctx: InteractiveModeContext) {}

	setupKeyHandlers(): void {
		this.ctx.editor.onEscape = () => {
			if (this.ctx.loadingAnimation) {
				this.restoreQueuedMessagesToEditor({ abort: true });
			} else if (this.ctx.session.isBashRunning) {
				this.ctx.session.abortBash();
			} else if (this.ctx.isBashMode) {
				this.ctx.editor.setText("");
				this.ctx.isBashMode = false;
				this.ctx.updateEditorBorderColor();
			} else if (this.ctx.isPythonMode) {
				this.ctx.editor.setText("");
				this.ctx.isPythonMode = false;
				this.ctx.updateEditorBorderColor();
			} else if (this.ctx.session.isPythonRunning) {
				this.ctx.session.abortPython();
			} else if (!this.ctx.editor.getText().trim()) {
				// Double-escape with empty editor triggers /tree or /branch based on setting
				const now = Date.now();
				if (now - this.ctx.lastEscapeTime < 500) {
					if (this.ctx.settingsManager.getDoubleEscapeAction() === "tree") {
						this.ctx.showTreeSelector();
					} else {
						this.ctx.showUserMessageSelector();
					}
					this.ctx.lastEscapeTime = 0;
				} else {
					this.ctx.lastEscapeTime = now;
				}
			}
		};

		this.ctx.editor.onCtrlC = () => this.handleCtrlC();
		this.ctx.editor.onCtrlD = () => this.handleCtrlD();
		this.ctx.editor.onCtrlZ = () => this.handleCtrlZ();
		this.ctx.editor.onShiftTab = () => this.cycleThinkingLevel();
		this.ctx.editor.onCtrlP = () => this.cycleRoleModel();
		this.ctx.editor.onShiftCtrlP = () => this.cycleRoleModel({ temporary: true });
		this.ctx.editor.onAltP = () => this.ctx.showModelSelector({ temporaryOnly: true });

		// Global debug handler on TUI (works regardless of focus)
		this.ctx.ui.onDebug = () => void this.ctx.handleDebugCommand();
		this.ctx.editor.onCtrlL = () => this.ctx.showModelSelector();
		this.ctx.editor.onCtrlR = () => this.ctx.showHistorySearch();
		this.ctx.editor.onCtrlT = () => this.ctx.toggleTodoExpansion();
		this.ctx.editor.onCtrlG = () => void this.openExternalEditor();
		this.ctx.editor.onQuestionMark = () => this.ctx.handleHotkeysCommand();
		this.ctx.editor.onCtrlV = () => this.handleImagePaste();

		// Wire up extension shortcuts
		this.registerExtensionShortcuts();

		const expandToolsKeys = this.ctx.keybindings.getKeys("expandTools");
		this.ctx.editor.onCtrlO = expandToolsKeys.includes("ctrl+o") ? () => this.toggleToolOutputExpansion() : undefined;
		for (const key of expandToolsKeys) {
			if (key === "ctrl+o") continue;
			this.ctx.editor.setCustomKeyHandler(key, () => this.toggleToolOutputExpansion());
		}

		const dequeueKeys = this.ctx.keybindings.getKeys("dequeue");
		this.ctx.editor.onAltUp = dequeueKeys.includes("alt+up") ? () => this.handleDequeue() : undefined;
		for (const key of dequeueKeys) {
			if (key === "alt+up") continue;
			this.ctx.editor.setCustomKeyHandler(key, () => this.handleDequeue());
		}

		const planModeKeys = this.ctx.keybindings.getKeys("togglePlanMode");
		for (const key of planModeKeys) {
			this.ctx.editor.setCustomKeyHandler(key, () => void this.ctx.handlePlanModeCommand());
		}

		this.ctx.editor.onChange = (text: string) => {
			const wasBashMode = this.ctx.isBashMode;
			const wasPythonMode = this.ctx.isPythonMode;
			const trimmed = text.trimStart();
			this.ctx.isBashMode = text.trimStart().startsWith("!");
			this.ctx.isPythonMode = trimmed.startsWith("$") && !trimmed.startsWith("${");
			if (wasBashMode !== this.ctx.isBashMode || wasPythonMode !== this.ctx.isPythonMode) {
				this.ctx.updateEditorBorderColor();
			}
		};

		this.ctx.editor.onAltEnter = async (text: string) => {
			const trimmedText = text.trim();

			// Queue follow-up messages while compaction is running
			if (this.ctx.session.isCompacting) {
				if (!trimmedText) {
					this.ctx.editor.handleInput("\n");
					return;
				}
				this.ctx.queueCompactionMessage(trimmedText, "followUp");
				return;
			}

			// Alt+Enter queues a follow-up message while streaming
			if (this.ctx.session.isStreaming) {
				if (!trimmedText) {
					this.ctx.editor.handleInput("\n");
					return;
				}
				this.ctx.editor.addToHistory(trimmedText);
				this.ctx.editor.setText("");
				await this.ctx.session.prompt(trimmedText, { streamingBehavior: "followUp" });
				this.ctx.updatePendingMessagesDisplay();
				this.ctx.ui.requestRender();
				return;
			}

			// Default behavior: insert a new line
			this.ctx.editor.handleInput("\n");
		};
	}

	setupEditorSubmitHandler(): void {
		this.ctx.editor.onSubmit = async (text: string) => {
			text = text.trim();

			// Empty submit while streaming with queued messages: flush queues immediately
			if (!text && this.ctx.session.isStreaming && this.ctx.session.queuedMessageCount > 0) {
				// Abort current stream and let queued messages be processed
				await this.ctx.session.abort();
				return;
			}

			if (!text) return;

			// Continue shortcuts: "." or "c" sends empty message (agent continues, no visible message)
			if (text === "." || text === "c") {
				if (this.ctx.onInputCallback) {
					this.ctx.editor.setText("");
					this.ctx.pendingImages = [];
					this.ctx.onInputCallback({ text: "" });
				}
				return;
			}

			const runner = this.ctx.session.extensionRunner;
			let inputImages = this.ctx.pendingImages.length > 0 ? [...this.ctx.pendingImages] : undefined;

			if (runner?.hasHandlers("input")) {
				const result = await runner.emitInput(text, inputImages, "interactive");
				if (result?.handled) {
					this.ctx.editor.setText("");
					this.ctx.pendingImages = [];
					return;
				}
				if (result?.text !== undefined) {
					text = result.text.trim();
				}
				if (result?.images !== undefined) {
					inputImages = result.images;
				}
			}

			if (!text) return;

			// Handle slash commands
			if (text === "/settings") {
				this.ctx.showSettingsSelector();
				this.ctx.editor.setText("");
				return;
			}
			if (text === "/plan") {
				await this.ctx.handlePlanModeCommand();
				this.ctx.editor.setText("");
				return;
			}
			if (text === "/model" || text === "/models") {
				this.ctx.showModelSelector();
				this.ctx.editor.setText("");
				return;
			}
			if (text.startsWith("/export")) {
				await this.ctx.handleExportCommand(text);
				this.ctx.editor.setText("");
				return;
			}
			if (text === "/dump") {
				await this.ctx.handleDumpCommand();
				this.ctx.editor.setText("");
				return;
			}
			if (text === "/share") {
				await this.ctx.handleShareCommand();
				this.ctx.editor.setText("");
				return;
			}
			if (text === "/copy") {
				await this.ctx.handleCopyCommand();
				this.ctx.editor.setText("");
				return;
			}
			if (text === "/session") {
				await this.ctx.handleSessionCommand();
				this.ctx.editor.setText("");
				return;
			}
			if (text === "/usage") {
				await this.ctx.handleUsageCommand();
				this.ctx.editor.setText("");
				return;
			}
			if (text === "/changelog") {
				await this.ctx.handleChangelogCommand();
				this.ctx.editor.setText("");
				return;
			}
			if (text === "/hotkeys") {
				this.ctx.handleHotkeysCommand();
				this.ctx.editor.setText("");
				return;
			}
			if (text === "/extensions" || text === "/status") {
				this.ctx.showExtensionsDashboard();
				this.ctx.editor.setText("");
				return;
			}
			if (text === "/branch") {
				if (this.ctx.settingsManager.getDoubleEscapeAction() === "tree") {
					this.ctx.showTreeSelector();
				} else {
					this.ctx.showUserMessageSelector();
				}
				this.ctx.editor.setText("");
				return;
			}
			if (text === "/tree") {
				this.ctx.showTreeSelector();
				this.ctx.editor.setText("");
				return;
			}
			if (text === "/login") {
				this.ctx.showOAuthSelector("login");
				this.ctx.editor.setText("");
				return;
			}
			if (text === "/logout") {
				this.ctx.showOAuthSelector("logout");
				this.ctx.editor.setText("");
				return;
			}
			if (text === "/new") {
				this.ctx.editor.setText("");
				await this.ctx.handleClearCommand();
				return;
			}
			if (text === "/compact" || text.startsWith("/compact ")) {
				const customInstructions = text.startsWith("/compact ") ? text.slice(9).trim() : undefined;
				this.ctx.editor.setText("");
				await this.ctx.handleCompactCommand(customInstructions);
				return;
			}
			if (text === "/handoff" || text.startsWith("/handoff ")) {
				const customInstructions = text.startsWith("/handoff ") ? text.slice(9).trim() : undefined;
				this.ctx.editor.setText("");
				await this.ctx.handleHandoffCommand(customInstructions);
				return;
			}
			if (text === "/background" || text === "/bg") {
				this.ctx.editor.setText("");
				this.handleBackgroundCommand();
				return;
			}
			if (text === "/debug") {
				void this.ctx.handleDebugCommand();
				this.ctx.editor.setText("");
				return;
			}
			if (text === "/arminsayshi") {
				this.ctx.handleArminSaysHi();
				this.ctx.editor.setText("");
				return;
			}
			if (text === "/resume") {
				this.ctx.showSessionSelector();
				this.ctx.editor.setText("");
				return;
			}
			if (text === "/exit") {
				this.ctx.editor.setText("");
				void this.ctx.shutdown();
				return;
			}

			// Handle skill commands (/skill:name [args])
			if (text.startsWith("/skill:")) {
				const spaceIndex = text.indexOf(" ");
				const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
				const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim();
				const skillPath = this.ctx.skillCommands?.get(commandName);
				if (skillPath) {
					this.ctx.editor.addToHistory(text);
					this.ctx.editor.setText("");
					try {
						const content = await Bun.file(skillPath).text();
						const body = content.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
						const metaLines = [`Skill: ${skillPath}`];
						if (args) {
							metaLines.push(`User: ${args}`);
						}
						const message = `${body}\n\n---\n\n${metaLines.join("\n")}`;
						await this.ctx.session.prompt(message);
					} catch (err) {
						this.ctx.showError(`Failed to load skill: ${err instanceof Error ? err.message : String(err)}`);
					}
					return;
				}
			}

			// Handle bash command (! for normal, !! for excluded from context)
			if (text.startsWith("!")) {
				const isExcluded = text.startsWith("!!");
				const command = isExcluded ? text.slice(2).trim() : text.slice(1).trim();
				if (command) {
					if (this.ctx.session.isBashRunning) {
						this.ctx.showWarning("A bash command is already running. Press Esc to cancel it first.");
						this.ctx.editor.setText(text);
						return;
					}
					this.ctx.editor.addToHistory(text);
					await this.ctx.handleBashCommand(command, isExcluded);
					this.ctx.isBashMode = false;
					this.ctx.updateEditorBorderColor();
					return;
				}
			}

			// Handle python command ($ for normal, $$ for excluded from context)
			if (text.startsWith("$")) {
				const isExcluded = text.startsWith("$$");
				const code = isExcluded ? text.slice(2).trim() : text.slice(1).trim();
				if (code) {
					if (this.ctx.session.isPythonRunning) {
						this.ctx.showWarning("A Python execution is already running. Press Esc to cancel it first.");
						this.ctx.editor.setText(text);
						return;
					}
					this.ctx.editor.addToHistory(text);
					await this.ctx.handlePythonCommand(code, isExcluded);
					this.ctx.isPythonMode = false;
					this.ctx.updateEditorBorderColor();
					return;
				}
			}

			// Queue input during compaction
			if (this.ctx.session.isCompacting) {
				if (this.ctx.pendingImages.length > 0) {
					this.ctx.showStatus("Compaction in progress. Retry after it completes to send images.");
					return;
				}
				this.ctx.queueCompactionMessage(text, "steer");
				return;
			}

			// If streaming, use prompt() with steer behavior
			// This handles extension commands (execute immediately), prompt template expansion, and queueing
			if (this.ctx.session.isStreaming) {
				this.ctx.editor.addToHistory(text);
				this.ctx.editor.setText("");
				const images = inputImages && inputImages.length > 0 ? [...inputImages] : undefined;
				this.ctx.pendingImages = [];
				await this.ctx.session.prompt(text, { streamingBehavior: "steer", images });
				this.ctx.updatePendingMessagesDisplay();
				this.ctx.ui.requestRender();
				return;
			}

			// Normal message submission
			// First, move any pending bash components to chat
			this.ctx.flushPendingBashComponents();

			// Generate session title on first message
			const hasUserMessages = this.ctx.agent.state.messages.some((m: AgentMessage) => m.role === "user");
			if (!hasUserMessages && !this.ctx.sessionManager.getSessionTitle() && !process.env.OMP_NO_TITLE) {
				const registry = this.ctx.session.modelRegistry;
				const smolModel = this.ctx.settingsManager.getModelRole("smol");
				generateSessionTitle(text, registry, smolModel, this.ctx.session.sessionId)
					.then(async title => {
						if (title) {
							await this.ctx.sessionManager.setSessionTitle(title);
							setTerminalTitle(`π: ${title}`);
						}
					})
					.catch(() => {});
			}

			if (this.ctx.onInputCallback) {
				// Include any pending images from clipboard paste
				const images = inputImages && inputImages.length > 0 ? [...inputImages] : undefined;
				this.ctx.pendingImages = [];
				this.ctx.onInputCallback({ text, images });
			}
			this.ctx.editor.addToHistory(text);
		};
	}

	handleCtrlC(): void {
		const now = Date.now();
		if (now - this.ctx.lastSigintTime < 500) {
			void this.ctx.shutdown();
		} else {
			this.ctx.clearEditor();
			this.ctx.lastSigintTime = now;
		}
	}

	handleCtrlD(): void {
		// Only called when editor is empty (enforced by CustomEditor)
		void this.ctx.shutdown();
	}

	handleCtrlZ(): void {
		// Set up handler to restore TUI when resumed
		process.once("SIGCONT", () => {
			this.ctx.ui.start();
			this.ctx.ui.requestRender(true);
		});

		// Stop the TUI (restore terminal to normal mode)
		this.ctx.ui.stop();

		// Send SIGTSTP to process group (pid=0 means all processes in group)
		process.kill(0, "SIGTSTP");
	}

	handleDequeue(): void {
		const restored = this.restoreQueuedMessagesToEditor();
		if (restored === 0) {
			this.ctx.showStatus("No queued messages to restore");
		} else {
			this.ctx.showStatus(`Restored ${restored} queued message${restored > 1 ? "s" : ""} to editor`);
		}
	}

	restoreQueuedMessagesToEditor(options?: { abort?: boolean; currentText?: string }): number {
		const { steering, followUp } = this.ctx.session.clearQueue();
		const allQueued = [...steering, ...followUp];
		if (allQueued.length === 0) {
			this.ctx.updatePendingMessagesDisplay();
			if (options?.abort) {
				this.ctx.agent.abort();
			}
			return 0;
		}
		const queuedText = allQueued.join("\n\n");
		const currentText = options?.currentText ?? this.ctx.editor.getText();
		const combinedText = [queuedText, currentText].filter(t => t.trim()).join("\n\n");
		this.ctx.editor.setText(combinedText);
		this.ctx.updatePendingMessagesDisplay();
		if (options?.abort) {
			this.ctx.agent.abort();
		}
		return allQueued.length;
	}

	handleBackgroundCommand(): void {
		if (this.ctx.isBackgrounded) {
			this.ctx.showStatus("Background mode already enabled");
			return;
		}
		if (!this.ctx.session.isStreaming && this.ctx.session.queuedMessageCount === 0) {
			this.ctx.showWarning("Agent is idle; nothing to background");
			return;
		}

		this.ctx.isBackgrounded = true;
		const backgroundUiContext = this.ctx.createBackgroundUiContext();

		// Background mode disables interactive UI so tools like ask fail fast.
		this.ctx.setToolUIContext(backgroundUiContext, false);
		this.ctx.initializeHookRunner(backgroundUiContext, false);

		if (this.ctx.loadingAnimation) {
			this.ctx.loadingAnimation.stop();
			this.ctx.loadingAnimation = undefined;
		}
		if (this.ctx.autoCompactionLoader) {
			this.ctx.autoCompactionLoader.stop();
			this.ctx.autoCompactionLoader = undefined;
		}
		if (this.ctx.retryLoader) {
			this.ctx.retryLoader.stop();
			this.ctx.retryLoader = undefined;
		}
		this.ctx.statusContainer.clear();
		this.ctx.statusLine.dispose();

		if (this.ctx.unsubscribe) {
			this.ctx.unsubscribe();
		}
		this.ctx.unsubscribe = this.ctx.session.subscribe(async (event: AgentSessionEvent) => {
			await this.ctx.handleBackgroundEvent(event);
		});

		// Backgrounding keeps the current process to preserve in-flight agent state.
		if (this.ctx.isInitialized) {
			this.ctx.ui.stop();
			this.ctx.isInitialized = false;
		}

		process.stdout.write("Background mode enabled. Run `bg` to continue in background.\n");

		if (process.platform === "win32" || !process.stdout.isTTY) {
			process.stdout.write("Backgrounding requires POSIX job control; continuing in foreground.\n");
			return;
		}

		process.kill(0, "SIGTSTP");
	}

	async handleImagePaste(): Promise<boolean> {
		try {
			const image = await readImageFromClipboard();
			if (image) {
				let imageData = image;
				if (this.ctx.settingsManager.getImageAutoResize()) {
					try {
						const resized = await resizeImage({
							type: "image",
							data: image.data,
							mimeType: image.mimeType,
						});
						imageData = { data: resized.data, mimeType: resized.mimeType };
					} catch {
						imageData = image;
					}
				}

				this.ctx.pendingImages.push({
					type: "image",
					data: imageData.data,
					mimeType: imageData.mimeType,
				});
				// Insert placeholder at cursor like Claude does
				const imageNum = this.ctx.pendingImages.length;
				const placeholder = `[Image #${imageNum}]`;
				this.ctx.editor.insertText(`${placeholder} `);
				this.ctx.ui.requestRender();
				return true;
			}
			// No image in clipboard - show hint
			this.ctx.showStatus("No image in clipboard (use terminal paste for text)");
			return false;
		} catch {
			this.ctx.showStatus("Failed to read clipboard");
			return false;
		}
	}

	cycleThinkingLevel(): void {
		const newLevel = this.ctx.session.cycleThinkingLevel();
		if (newLevel === undefined) {
			this.ctx.showStatus("Current model does not support thinking");
		} else {
			this.ctx.statusLine.invalidate();
			this.ctx.updateEditorBorderColor();
		}
	}

	async cycleRoleModel(options?: { temporary?: boolean }): Promise<void> {
		try {
			const roleOrder = ["slow", "default", "smol"];
			const result = await this.ctx.session.cycleRoleModels(roleOrder, options);
			if (!result) {
				this.ctx.showStatus("Only one role model available");
				return;
			}

			this.ctx.statusLine.invalidate();
			this.ctx.updateEditorBorderColor();
			const roleLabel = result.role === "default" ? "default" : result.role;
			const roleLabelStyled = theme.bold(theme.fg("accent", roleLabel));
			const thinkingStr =
				result.model.reasoning && result.thinkingLevel !== "off" ? ` (thinking: ${result.thinkingLevel})` : "";
			const tempLabel = options?.temporary ? " (temporary)" : "";
			const cycleSeparator = theme.fg("dim", " > ");
			const cycleLabel = roleOrder
				.map(role => {
					if (role === result.role) {
						return theme.bold(theme.fg("accent", role));
					}
					return theme.fg("muted", role);
				})
				.join(cycleSeparator);
			const orderLabel = ` (cycle: ${cycleLabel})`;
			this.ctx.showStatus(
				`Switched to ${roleLabelStyled}: ${result.model.name || result.model.id}${thinkingStr}${tempLabel}${orderLabel}`,
				{ dim: false },
			);
		} catch (error) {
			this.ctx.showError(error instanceof Error ? error.message : String(error));
		}
	}

	toggleToolOutputExpansion(): void {
		this.ctx.toolOutputExpanded = !this.ctx.toolOutputExpanded;
		for (const child of this.ctx.chatContainer.children) {
			if (isExpandable(child)) {
				child.setExpanded(this.ctx.toolOutputExpanded);
			}
		}
		this.ctx.ui.requestRender();
	}

	toggleThinkingBlockVisibility(): void {
		this.ctx.hideThinkingBlock = !this.ctx.hideThinkingBlock;
		this.ctx.settingsManager.setHideThinkingBlock(this.ctx.hideThinkingBlock);

		// Rebuild chat from session messages
		this.ctx.chatContainer.clear();
		this.ctx.rebuildChatFromMessages();

		// If streaming, re-add the streaming component with updated visibility and re-render
		if (this.ctx.streamingComponent && this.ctx.streamingMessage) {
			this.ctx.streamingComponent.setHideThinkingBlock(this.ctx.hideThinkingBlock);
			this.ctx.streamingComponent.updateContent(this.ctx.streamingMessage);
			this.ctx.chatContainer.addChild(this.ctx.streamingComponent);
		}

		this.ctx.showStatus(`Thinking blocks: ${this.ctx.hideThinkingBlock ? "hidden" : "visible"}`);
	}

	private getEditorTerminalPath(): string | null {
		if (process.platform === "win32") {
			return null;
		}
		return "/dev/tty";
	}

	private async openEditorTerminalHandle(): Promise<fs.FileHandle | null> {
		const terminalPath = this.getEditorTerminalPath();
		if (!terminalPath) {
			return null;
		}
		try {
			return await fs.open(terminalPath, "r+");
		} catch {
			return null;
		}
	}

	async openExternalEditor(): Promise<void> {
		// Determine editor (respect $VISUAL, then $EDITOR)
		const editorCmd = process.env.VISUAL || process.env.EDITOR;
		if (!editorCmd) {
			this.ctx.showWarning("No editor configured. Set $VISUAL or $EDITOR environment variable.");
			return;
		}

		const currentText = this.ctx.editor.getText();
		const tmpFile = path.join(os.tmpdir(), `omp-editor-${nanoid()}.omp.md`);

		let ttyHandle: fs.FileHandle | null = null;
		try {
			// Write current content to temp file
			await Bun.write(tmpFile, currentText);

			// Stop TUI to release terminal
			ttyHandle = await this.openEditorTerminalHandle();
			this.ctx.ui.stop();

			// Split by space to support editor arguments (e.g., "code --wait")
			const [editor, ...editorArgs] = editorCmd.split(" ");

			const stdio: [number | "inherit", number | "inherit", number | "inherit"] = ttyHandle
				? [ttyHandle.fd, ttyHandle.fd, ttyHandle.fd]
				: ["inherit", "inherit", "inherit"];

			const child = spawn(editor, [...editorArgs, tmpFile], { stdio });
			const exitCode = await new Promise<number>((resolve, reject) => {
				child.once("exit", (code, signal) => resolve(code ?? (signal ? -1 : 0)));
				child.once("error", error => reject(error));
			});

			// On successful exit (exitCode 0), replace editor content
			if (exitCode === 0) {
				const newContent = (await Bun.file(tmpFile).text()).replace(/\n$/, "");
				this.ctx.editor.setText(newContent);
			}
			// On non-zero exit, keep original text (no action needed)
		} catch (error) {
			this.ctx.showWarning(
				`Failed to open external editor: ${error instanceof Error ? error.message : String(error)}`,
			);
		} finally {
			// Clean up temp file
			try {
				await fs.rm(tmpFile, { force: true });
			} catch {
				// Ignore cleanup errors
			}

			if (ttyHandle) {
				await ttyHandle.close();
			}

			// Restart TUI
			this.ctx.ui.start();
			this.ctx.ui.requestRender();
		}
	}

	registerExtensionShortcuts(): void {
		const runner = this.ctx.session.extensionRunner;
		if (!runner) return;

		const shortcuts = runner.getShortcuts();
		for (const [keyId, shortcut] of shortcuts) {
			this.ctx.editor.setCustomKeyHandler(keyId, () => {
				const ctx = runner.createCommandContext();
				try {
					shortcut.handler(ctx);
				} catch (err) {
					runner.emitError({
						extensionPath: shortcut.extensionPath,
						event: "shortcut",
						error: err instanceof Error ? err.message : String(err),
						stack: err instanceof Error ? err.stack : undefined,
					});
				}
			});
		}
	}
}
