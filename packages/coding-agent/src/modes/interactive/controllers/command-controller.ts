import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Loader, Markdown, Spacer, Text, visibleWidth } from "@oh-my-pi/pi-tui";
import { nanoid } from "nanoid";
import { getDebugLogPath } from "../../../config";
import { loadCustomShare } from "../../../core/custom-share";
import type { CompactOptions } from "../../../core/extensions/types";
import { createCompactionSummaryMessage } from "../../../core/messages";
import type { TruncationResult } from "../../../core/tools/truncate";
import { getChangelogPath, parseChangelog } from "../../../utils/changelog";
import { copyToClipboard } from "../../../utils/clipboard";
import { ArminComponent } from "../components/armin";
import { BashExecutionComponent } from "../components/bash-execution";
import { BorderedLoader } from "../components/bordered-loader";
import { DynamicBorder } from "../components/dynamic-border";
import { getMarkdownTheme, getSymbolTheme, theme } from "../theme/theme";
import type { InteractiveModeContext } from "../types";

export class CommandController {
	constructor(private readonly ctx: InteractiveModeContext) {}

	openInBrowser(urlOrPath: string): void {
		try {
			const args =
				process.platform === "darwin"
					? ["open", urlOrPath]
					: process.platform === "win32"
						? ["cmd", "/c", "start", "", urlOrPath]
						: ["xdg-open", urlOrPath];
			Bun.spawn(args, { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
		} catch {
			// Best-effort: browser opening is non-critical
		}
	}

	async handleExportCommand(text: string): Promise<void> {
		const parts = text.split(/\s+/);
		const arg = parts.length > 1 ? parts[1] : undefined;

		if (arg === "--copy" || arg === "clipboard" || arg === "copy") {
			this.ctx.showWarning("Use /dump to copy the session to clipboard.");
			return;
		}

		try {
			const filePath = await this.ctx.session.exportToHtml(arg);
			this.ctx.showStatus(`Session exported to: ${filePath}`);
			this.openInBrowser(filePath);
		} catch (error: unknown) {
			this.ctx.showError(`Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	}

	async handleDumpCommand(): Promise<void> {
		try {
			const formatted = this.ctx.session.formatSessionAsText();
			if (!formatted) {
				this.ctx.showError("No messages to dump yet.");
				return;
			}
			await copyToClipboard(formatted);
			this.ctx.showStatus("Session copied to clipboard");
		} catch (error: unknown) {
			this.ctx.showError(`Failed to copy session: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	}

	async handleShareCommand(): Promise<void> {
		const tmpFile = path.join(os.tmpdir(), `${nanoid()}.html`);
		try {
			await this.ctx.session.exportToHtml(tmpFile);
		} catch (error: unknown) {
			this.ctx.showError(`Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`);
			return;
		}

		try {
			const customShare = await loadCustomShare();
			if (customShare) {
				const loader = new BorderedLoader(this.ctx.ui, theme, "Sharing...");
				this.ctx.editorContainer.clear();
				this.ctx.editorContainer.addChild(loader);
				this.ctx.ui.setFocus(loader);
				this.ctx.ui.requestRender();

				const restoreEditor = () => {
					loader.dispose();
					this.ctx.editorContainer.clear();
					this.ctx.editorContainer.addChild(this.ctx.editor);
					this.ctx.ui.setFocus(this.ctx.editor);
					try {
						fs.unlinkSync(tmpFile);
					} catch {
						// Ignore cleanup errors
					}
				};

				try {
					const result = await customShare.fn(tmpFile);
					restoreEditor();

					if (typeof result === "string") {
						this.ctx.showStatus(`Share URL: ${result}`);
						this.openInBrowser(result);
					} else if (result) {
						const parts: string[] = [];
						if (result.url) parts.push(`Share URL: ${result.url}`);
						if (result.message) parts.push(result.message);
						if (parts.length > 0) this.ctx.showStatus(parts.join("\n"));
						if (result.url) this.openInBrowser(result.url);
					} else {
						this.ctx.showStatus("Session shared");
					}
					return;
				} catch (err) {
					restoreEditor();
					this.ctx.showError(`Custom share failed: ${err instanceof Error ? err.message : String(err)}`);
					return;
				}
			}
		} catch (err) {
			try {
				fs.unlinkSync(tmpFile);
			} catch {
				// Ignore cleanup errors
			}
			this.ctx.showError(err instanceof Error ? err.message : String(err));
			return;
		}

		try {
			const authResult = Bun.spawnSync(["gh", "auth", "status"]);
			if (authResult.exitCode !== 0) {
				try {
					fs.unlinkSync(tmpFile);
				} catch {}
				this.ctx.showError("GitHub CLI is not logged in. Run 'gh auth login' first.");
				return;
			}
		} catch {
			try {
				fs.unlinkSync(tmpFile);
			} catch {}
			this.ctx.showError("GitHub CLI (gh) is not installed. Install it from https://cli.github.com/");
			return;
		}

		const loader = new BorderedLoader(this.ctx.ui, theme, "Creating gist...");
		this.ctx.editorContainer.clear();
		this.ctx.editorContainer.addChild(loader);
		this.ctx.ui.setFocus(loader);
		this.ctx.ui.requestRender();

		const restoreEditor = () => {
			loader.dispose();
			this.ctx.editorContainer.clear();
			this.ctx.editorContainer.addChild(this.ctx.editor);
			this.ctx.ui.setFocus(this.ctx.editor);
			try {
				fs.unlinkSync(tmpFile);
			} catch {
				// Ignore cleanup errors
			}
		};

		let proc: ReturnType<typeof Bun.spawn> | null = null;

		loader.onAbort = () => {
			proc?.kill();
			restoreEditor();
			this.ctx.showStatus("Share cancelled");
		};

		try {
			const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
				proc = Bun.spawn(["gh", "gist", "create", "--public=false", tmpFile], {
					stdout: "pipe",
					stderr: "pipe",
				});
				let stdout = "";
				let stderr = "";

				const stdoutReader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
				const stderrReader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
				const decoder = new TextDecoder();

				(async () => {
					try {
						while (true) {
							const { done, value } = await stdoutReader.read();
							if (done) break;
							stdout += decoder.decode(value);
						}
					} catch {}
				})();

				(async () => {
					try {
						while (true) {
							const { done, value } = await stderrReader.read();
							if (done) break;
							stderr += decoder.decode(value);
						}
					} catch {}
				})();

				proc.exited.then((code) => resolve({ stdout, stderr, code }));
			});

			if (loader.signal.aborted) return;

			restoreEditor();

			if (result.code !== 0) {
				const errorMsg = result.stderr?.trim() || "Unknown error";
				this.ctx.showError(`Failed to create gist: ${errorMsg}`);
				return;
			}

			const gistUrl = result.stdout?.trim();
			const gistId = gistUrl?.split("/").pop();
			if (!gistId) {
				this.ctx.showError("Failed to parse gist ID from gh output");
				return;
			}

			const previewUrl = `https://gistpreview.github.io/?${gistId}`;
			this.ctx.showStatus(`Share URL: ${previewUrl}\nGist: ${gistUrl}`);
			this.openInBrowser(previewUrl);
		} catch (error: unknown) {
			if (!loader.signal.aborted) {
				restoreEditor();
				this.ctx.showError(`Failed to create gist: ${error instanceof Error ? error.message : "Unknown error"}`);
			}
		}
	}

	async handleCopyCommand(): Promise<void> {
		const text = this.ctx.session.getLastAssistantText();
		if (!text) {
			this.ctx.showError("No agent messages to copy yet.");
			return;
		}

		try {
			await copyToClipboard(text);
			this.ctx.showStatus("Copied last agent message to clipboard");
		} catch (error) {
			this.ctx.showError(error instanceof Error ? error.message : String(error));
		}
	}

	handleSessionCommand(): void {
		const stats = this.ctx.session.getSessionStats();

		let info = `${theme.bold("Session Info")}\n\n`;
		info += `${theme.fg("dim", "File:")} ${stats.sessionFile ?? "In-memory"}\n`;
		info += `${theme.fg("dim", "ID:")} ${stats.sessionId}\n\n`;
		info += `${theme.bold("Messages")}\n`;
		info += `${theme.fg("dim", "User:")} ${stats.userMessages}\n`;
		info += `${theme.fg("dim", "Assistant:")} ${stats.assistantMessages}\n`;
		info += `${theme.fg("dim", "Tool Calls:")} ${stats.toolCalls}\n`;
		info += `${theme.fg("dim", "Tool Results:")} ${stats.toolResults}\n`;
		info += `${theme.fg("dim", "Total:")} ${stats.totalMessages}\n\n`;
		info += `${theme.bold("Tokens")}\n`;
		info += `${theme.fg("dim", "Input:")} ${stats.tokens.input.toLocaleString()}\n`;
		info += `${theme.fg("dim", "Output:")} ${stats.tokens.output.toLocaleString()}\n`;
		if (stats.tokens.cacheRead > 0) {
			info += `${theme.fg("dim", "Cache Read:")} ${stats.tokens.cacheRead.toLocaleString()}\n`;
		}
		if (stats.tokens.cacheWrite > 0) {
			info += `${theme.fg("dim", "Cache Write:")} ${stats.tokens.cacheWrite.toLocaleString()}\n`;
		}
		info += `${theme.fg("dim", "Total:")} ${stats.tokens.total.toLocaleString()}\n`;

		if (stats.cost > 0) {
			info += `\n${theme.bold("Cost")}\n`;
			info += `${theme.fg("dim", "Total:")} ${stats.cost.toFixed(4)}`;
		}

		this.ctx.chatContainer.addChild(new Spacer(1));
		this.ctx.chatContainer.addChild(new Text(info, 1, 0));
		this.ctx.ui.requestRender();
	}

	handleChangelogCommand(): void {
		const changelogPath = getChangelogPath();
		const allEntries = parseChangelog(changelogPath);

		const changelogMarkdown =
			allEntries.length > 0
				? allEntries
						.reverse()
						.map((e) => e.content)
						.join("\n\n")
				: "No changelog entries found.";

		this.ctx.chatContainer.addChild(new Spacer(1));
		this.ctx.chatContainer.addChild(new DynamicBorder());
		this.ctx.chatContainer.addChild(new Text(theme.bold(theme.fg("accent", "What's New")), 1, 0));
		this.ctx.chatContainer.addChild(new Spacer(1));
		this.ctx.chatContainer.addChild(new Markdown(changelogMarkdown, 1, 1, getMarkdownTheme()));
		this.ctx.chatContainer.addChild(new DynamicBorder());
		this.ctx.ui.requestRender();
	}

	handleHotkeysCommand(): void {
		const expandToolsKey = this.ctx.keybindings.getDisplayString("expandTools") || "Ctrl+O";
		const hotkeys = `
**Navigation**
| Key | Action |
|-----|--------|
| \`Arrow keys\` | Move cursor / browse history (Up when empty) |
| \`Option+Left/Right\` | Move by word |
| \`Ctrl+A\` / \`Home\` / \`Cmd+Left\` | Start of line |
| \`Ctrl+E\` / \`End\` / \`Cmd+Right\` | End of line |

**Editing**
| Key | Action |
|-----|--------|
| \`Enter\` | Send message |
| \`Shift+Enter\` / \`Alt+Enter\` | New line |
| \`Ctrl+W\` / \`Option+Backspace\` | Delete word backwards |
| \`Ctrl+U\` | Delete to start of line |
| \`Ctrl+K\` | Delete to end of line |

**Other**
| Key | Action |
|-----|--------|
| \`Tab\` | Path completion / accept autocomplete |
| \`Escape\` | Cancel autocomplete / abort streaming |
| \`Ctrl+C\` | Clear editor (first) / exit (second) |
| \`Ctrl+D\` | Exit (when editor is empty) |
| \`Ctrl+Z\` | Suspend to background |
| \`Shift+Tab\` | Cycle thinking level |
| \`Ctrl+P\` | Cycle role models (slow/default/smol) |
| \`Shift+Ctrl+P\` | Cycle role models (temporary) |
| \`Alt+P\` | Select model (temporary) |
| \`Ctrl+L\` | Select model (set roles) |
| \`Ctrl+R\` | Search prompt history |
| \`${expandToolsKey}\` | Toggle tool output expansion |
| \`Ctrl+T\` | Toggle todo list expansion |
| \`Ctrl+G\` | Edit message in external editor |
| \`/\` | Slash commands |
| \`!\` | Run bash command |
| \`!!\` | Run bash command (excluded from context) |
`;
		this.ctx.chatContainer.addChild(new Spacer(1));
		this.ctx.chatContainer.addChild(new DynamicBorder());
		this.ctx.chatContainer.addChild(new Text(theme.bold(theme.fg("accent", "Keyboard Shortcuts")), 1, 0));
		this.ctx.chatContainer.addChild(new Spacer(1));
		this.ctx.chatContainer.addChild(new Markdown(hotkeys.trim(), 1, 1, getMarkdownTheme()));
		this.ctx.chatContainer.addChild(new DynamicBorder());
		this.ctx.ui.requestRender();
	}

	async handleClearCommand(): Promise<void> {
		if (this.ctx.loadingAnimation) {
			this.ctx.loadingAnimation.stop();
			this.ctx.loadingAnimation = undefined;
		}
		this.ctx.statusContainer.clear();

		await this.ctx.session.newSession();

		this.ctx.statusLine.invalidate();
		this.ctx.updateEditorTopBorder();

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
	}

	handleDebugCommand(): void {
		const width = this.ctx.ui.terminal.columns;
		const allLines = this.ctx.ui.render(width);

		const debugLogPath = getDebugLogPath();
		const debugData = [
			`Debug output at ${new Date().toISOString()}`,
			`Terminal width: ${width}`,
			`Total lines: ${allLines.length}`,
			"",
			"=== All rendered lines with visible widths ===",
			...allLines.map((line, idx) => {
				const vw = visibleWidth(line);
				const escaped = JSON.stringify(line);
				return `[${idx}] (w=${vw}) ${escaped}`;
			}),
			"",
			"=== Agent messages (JSONL) ===",
			...this.ctx.session.messages.map((msg) => JSON.stringify(msg)),
			"",
		].join("\n");

		fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
		fs.writeFileSync(debugLogPath, debugData);

		this.ctx.chatContainer.addChild(new Spacer(1));
		this.ctx.chatContainer.addChild(
			new Text(
				`${theme.fg("accent", `${theme.status.success} Debug log written`)}\n${theme.fg("muted", debugLogPath)}`,
				1,
				1,
			),
		);
		this.ctx.ui.requestRender();
	}

	handleArminSaysHi(): void {
		this.ctx.chatContainer.addChild(new Spacer(1));
		this.ctx.chatContainer.addChild(new ArminComponent(this.ctx.ui));
		this.ctx.ui.requestRender();
	}

	async handleBashCommand(command: string, excludeFromContext = false): Promise<void> {
		const isDeferred = this.ctx.session.isStreaming;
		this.ctx.bashComponent = new BashExecutionComponent(command, this.ctx.ui, excludeFromContext);

		if (isDeferred) {
			this.ctx.pendingMessagesContainer.addChild(this.ctx.bashComponent);
			this.ctx.pendingBashComponents.push(this.ctx.bashComponent);
		} else {
			this.ctx.chatContainer.addChild(this.ctx.bashComponent);
		}
		this.ctx.ui.requestRender();

		try {
			const result = await this.ctx.session.executeBash(
				command,
				(chunk) => {
					if (this.ctx.bashComponent) {
						this.ctx.bashComponent.appendOutput(chunk);
						this.ctx.ui.requestRender();
					}
				},
				{ excludeFromContext },
			);

			if (this.ctx.bashComponent) {
				this.ctx.bashComponent.setComplete(
					result.exitCode,
					result.cancelled,
					result.truncated ? ({ truncated: true, content: result.output } as TruncationResult) : undefined,
					result.fullOutputPath,
				);
			}
		} catch (error) {
			if (this.ctx.bashComponent) {
				this.ctx.bashComponent.setComplete(undefined, false);
			}
			this.ctx.showError(`Bash command failed: ${error instanceof Error ? error.message : "Unknown error"}`);
		}

		this.ctx.bashComponent = undefined;
		this.ctx.ui.requestRender();
	}

	async handleCompactCommand(customInstructions?: string): Promise<void> {
		const entries = this.ctx.sessionManager.getEntries();
		const messageCount = entries.filter((e) => e.type === "message").length;

		if (messageCount < 2) {
			this.ctx.showWarning("Nothing to compact (no messages yet)");
			return;
		}

		await this.executeCompaction(customInstructions, false);
	}

	async handleSkillCommand(skillPath: string, args: string): Promise<void> {
		try {
			const content = fs.readFileSync(skillPath, "utf-8");
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
	}

	async executeCompaction(customInstructionsOrOptions?: string | CompactOptions, isAuto = false): Promise<void> {
		if (this.ctx.loadingAnimation) {
			this.ctx.loadingAnimation.stop();
			this.ctx.loadingAnimation = undefined;
		}
		this.ctx.statusContainer.clear();

		const originalOnEscape = this.ctx.editor.onEscape;
		this.ctx.editor.onEscape = () => {
			this.ctx.session.abortCompaction();
		};

		this.ctx.chatContainer.addChild(new Spacer(1));
		const label = isAuto ? "Auto-compacting context... (esc to cancel)" : "Compacting context... (esc to cancel)";
		const compactingLoader = new Loader(
			this.ctx.ui,
			(spinner) => theme.fg("accent", spinner),
			(text) => theme.fg("muted", text),
			label,
			getSymbolTheme().spinnerFrames,
		);
		this.ctx.statusContainer.addChild(compactingLoader);
		this.ctx.ui.requestRender();

		try {
			const instructions = typeof customInstructionsOrOptions === "string" ? customInstructionsOrOptions : undefined;
			const options =
				customInstructionsOrOptions && typeof customInstructionsOrOptions === "object"
					? customInstructionsOrOptions
					: undefined;
			const result = await this.ctx.session.compact(instructions, options);

			this.ctx.rebuildChatFromMessages();

			const msg = createCompactionSummaryMessage(result.summary, result.tokensBefore, new Date().toISOString());
			this.ctx.addMessageToChat(msg);

			this.ctx.statusLine.invalidate();
			this.ctx.updateEditorTopBorder();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message === "Compaction cancelled" || (error instanceof Error && error.name === "AbortError")) {
				this.ctx.showError("Compaction cancelled");
			} else {
				this.ctx.showError(`Compaction failed: ${message}`);
			}
		} finally {
			compactingLoader.stop();
			this.ctx.statusContainer.clear();
			this.ctx.editor.onEscape = originalOnEscape;
		}
		await this.ctx.flushCompactionQueue({ willRetry: false });
	}
}
