import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { UsageLimit, UsageReport } from "@oh-my-pi/pi-ai";
import { Loader, Markdown, Spacer, Text, visibleWidth } from "@oh-my-pi/pi-tui";
import { $ } from "bun";
import { nanoid } from "nanoid";
import { getDebugLogPath } from "../../config";
import { loadCustomShare } from "../../export/custom-share";
import type { CompactOptions } from "../../extensibility/extensions/types";
import { getGatewayStatus } from "../../ipy/gateway-coordinator";
import { ArminComponent } from "../../modes/components/armin";
import { BashExecutionComponent } from "../../modes/components/bash-execution";
import { BorderedLoader } from "../../modes/components/bordered-loader";
import { DynamicBorder } from "../../modes/components/dynamic-border";
import { PythonExecutionComponent } from "../../modes/components/python-execution";
import { getMarkdownTheme, getSymbolTheme, theme } from "../../modes/theme/theme";
import type { InteractiveModeContext } from "../../modes/types";
import { createCompactionSummaryMessage } from "../../session/messages";
import { outputMeta } from "../../tools/output-meta";
import { getChangelogPath, parseChangelog } from "../../utils/changelog";
import { copyToClipboard } from "../../utils/clipboard";

export class CommandController {
	constructor(private readonly ctx: InteractiveModeContext) {}

	openInBrowser(urlOrPath: string): void {
		const args =
			process.platform === "darwin"
				? ["open", urlOrPath]
				: process.platform === "win32"
					? ["cmd", "/c", "start", "", urlOrPath]
					: ["xdg-open", urlOrPath];
		const [cmd, ...cmdArgs] = args;
		void (async () => {
			try {
				await $`${cmd} ${cmdArgs}`.quiet().nothrow();
			} catch {
				// Best-effort: browser opening is non-critical
			}
		})();
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
		const cleanupTempFile = async () => {
			try {
				await fs.rm(tmpFile, { force: true });
			} catch {
				// Ignore cleanup errors
			}
		};
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

				const restoreEditor = async () => {
					loader.dispose();
					this.ctx.editorContainer.clear();
					this.ctx.editorContainer.addChild(this.ctx.editor);
					this.ctx.ui.setFocus(this.ctx.editor);
					await cleanupTempFile();
				};

				try {
					const result = await customShare.fn(tmpFile);
					await restoreEditor();

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
					await restoreEditor();
					this.ctx.showError(`Custom share failed: ${err instanceof Error ? err.message : String(err)}`);
					return;
				}
			}
		} catch (err) {
			await cleanupTempFile();
			this.ctx.showError(err instanceof Error ? err.message : String(err));
			return;
		}

		try {
			const authResult = await $`gh auth status`.quiet().nothrow();
			if (authResult.exitCode !== 0) {
				await cleanupTempFile();
				this.ctx.showError("GitHub CLI is not logged in. Run 'gh auth login' first.");
				return;
			}
		} catch {
			await cleanupTempFile();
			this.ctx.showError("GitHub CLI (gh) is not installed. Install it from https://cli.github.com/");
			return;
		}

		const loader = new BorderedLoader(this.ctx.ui, theme, "Creating gist...");
		this.ctx.editorContainer.clear();
		this.ctx.editorContainer.addChild(loader);
		this.ctx.ui.setFocus(loader);
		this.ctx.ui.requestRender();

		const restoreEditor = async () => {
			loader.dispose();
			this.ctx.editorContainer.clear();
			this.ctx.editorContainer.addChild(this.ctx.editor);
			this.ctx.ui.setFocus(this.ctx.editor);
			await cleanupTempFile();
		};

		loader.onAbort = () => {
			void restoreEditor();
			this.ctx.showStatus("Share cancelled");
		};

		try {
			const result = await $`gh gist create --public=false ${tmpFile}`.quiet().nothrow();
			if (loader.signal.aborted) return;

			await restoreEditor();

			if (result.exitCode !== 0) {
				const errorMsg = result.stderr.toString("utf-8").trim() || "Unknown error";
				this.ctx.showError(`Failed to create gist: ${errorMsg}`);
				return;
			}

			const gistUrl = result.stdout.toString("utf-8").trim();
			const gistId = gistUrl.split("/").pop();
			if (!gistId) {
				this.ctx.showError("Failed to parse gist ID from gh output");
				return;
			}

			const previewUrl = `https://gistpreview.github.io/?${gistId}`;
			this.ctx.showStatus(`Share URL: ${previewUrl}\nGist: ${gistUrl}`);
			this.openInBrowser(previewUrl);
		} catch (error: unknown) {
			if (!loader.signal.aborted) {
				await restoreEditor();
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

	async handleSessionCommand(): Promise<void> {
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
			info += `${theme.fg("dim", "Total:")} ${stats.cost.toFixed(4)}\n`;
		}

		const gateway = await getGatewayStatus();
		info += `\n${theme.bold("Python Gateway")}\n`;
		if (gateway.active) {
			info += `${theme.fg("dim", "Status:")} ${theme.fg("success", "Active (Global)")}\n`;
			info += `${theme.fg("dim", "URL:")} ${gateway.url}\n`;
			info += `${theme.fg("dim", "PID:")} ${gateway.pid}\n`;
			if (gateway.pythonPath) {
				info += `${theme.fg("dim", "Python:")} ${gateway.pythonPath}\n`;
			}
			if (gateway.venvPath) {
				info += `${theme.fg("dim", "Venv:")} ${gateway.venvPath}\n`;
			}
			if (gateway.uptime !== null) {
				const uptimeSec = Math.floor(gateway.uptime / 1000);
				const mins = Math.floor(uptimeSec / 60);
				const secs = uptimeSec % 60;
				info += `${theme.fg("dim", "Uptime:")} ${mins}m ${secs}s\n`;
			}
		} else {
			info += `${theme.fg("dim", "Status:")} ${theme.fg("dim", "Inactive")}\n`;
		}

		if (this.ctx.lspServers && this.ctx.lspServers.length > 0) {
			info += `\n${theme.bold("LSP Servers")}\n`;
			for (const server of this.ctx.lspServers) {
				const statusColor = server.status === "ready" ? "success" : "error";
				info += `${theme.fg("dim", `${server.name}:`)} ${theme.fg(statusColor, server.status)} ${theme.fg("dim", `(${server.fileTypes.join(", ")})`)}\n`;
			}
		}

		if (this.ctx.mcpManager) {
			const mcpServers = this.ctx.mcpManager.getConnectedServers();
			info += `\n${theme.bold("MCP Servers")}\n`;
			if (mcpServers.length === 0) {
				info += `${theme.fg("dim", "None connected")}\n`;
			} else {
				for (const name of mcpServers) {
					const conn = this.ctx.mcpManager.getConnection(name);
					const toolCount = conn?.tools?.length ?? 0;
					info += `${theme.fg("dim", `${name}:`)} ${theme.fg("success", "connected")} ${theme.fg("dim", `(${toolCount} tools)`)}\n`;
				}
			}
		}

		this.ctx.chatContainer.addChild(new Spacer(1));
		this.ctx.chatContainer.addChild(new Text(info, 1, 0));
		this.ctx.ui.requestRender();
	}

	async handleUsageCommand(reports?: UsageReport[] | null): Promise<void> {
		let usageReports = reports ?? null;
		if (!usageReports) {
			const provider = this.ctx.session as { fetchUsageReports?: () => Promise<UsageReport[] | null> };
			if (!provider.fetchUsageReports) {
				this.ctx.showWarning("Usage reporting is not configured for this session.");
				return;
			}
			try {
				usageReports = await provider.fetchUsageReports();
			} catch (error) {
				this.ctx.showError(`Failed to fetch usage data: ${error instanceof Error ? error.message : String(error)}`);
				return;
			}
		}

		if (!usageReports || usageReports.length === 0) {
			this.ctx.showWarning("No usage data available.");
			return;
		}

		const output = renderUsageReports(usageReports, theme, Date.now());
		this.ctx.chatContainer.addChild(new Spacer(1));
		this.ctx.chatContainer.addChild(new Text(output, 1, 0));
		this.ctx.ui.requestRender();
	}

	async handleChangelogCommand(): Promise<void> {
		const changelogPath = getChangelogPath();
		const allEntries = await parseChangelog(changelogPath);

		const changelogMarkdown =
			allEntries.length > 0
				? allEntries
						.reverse()
						.map(e => e.content)
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
		const planModeKey = this.ctx.keybindings.getDisplayString("togglePlanMode") || "Alt+Shift+P";
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
| \`${planModeKey}\` | Toggle plan mode |
| \`Ctrl+R\` | Search prompt history |
| \`${expandToolsKey}\` | Toggle tool output expansion |
| \`Ctrl+T\` | Toggle todo list expansion |
| \`Ctrl+G\` | Edit message in external editor |
| \`/\` | Slash commands |
| \`!\` | Run bash command |
| \`!!\` | Run bash command (excluded from context) |
| \`$\` | Run Python in shared kernel |
| \`$$\` | Run Python (excluded from context) |
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

	async handleDebugCommand(): Promise<void> {
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
			...this.ctx.session.messages.map(msg => JSON.stringify(msg)),
			"",
		].join("\n");

		try {
			await Bun.write(debugLogPath, debugData);
		} catch (error) {
			this.ctx.showError(`Failed to write debug log: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}

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
				chunk => {
					if (this.ctx.bashComponent) {
						this.ctx.bashComponent.appendOutput(chunk);
						this.ctx.ui.requestRender();
					}
				},
				{ excludeFromContext },
			);

			if (this.ctx.bashComponent) {
				const meta = outputMeta().truncationFromSummary(result, { direction: "tail" }).get();
				this.ctx.bashComponent.setComplete(result.exitCode, result.cancelled, {
					output: result.output,
					truncation: meta?.truncation,
				});
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

	async handlePythonCommand(code: string, excludeFromContext = false): Promise<void> {
		const isDeferred = this.ctx.session.isStreaming;
		this.ctx.pythonComponent = new PythonExecutionComponent(code, this.ctx.ui, excludeFromContext);

		if (isDeferred) {
			this.ctx.pendingMessagesContainer.addChild(this.ctx.pythonComponent);
			this.ctx.pendingPythonComponents.push(this.ctx.pythonComponent);
		} else {
			this.ctx.chatContainer.addChild(this.ctx.pythonComponent);
		}
		this.ctx.ui.requestRender();

		try {
			const result = await this.ctx.session.executePython(
				code,
				chunk => {
					if (this.ctx.pythonComponent) {
						this.ctx.pythonComponent.appendOutput(chunk);
						this.ctx.ui.requestRender();
					}
				},
				{ excludeFromContext },
			);

			if (this.ctx.pythonComponent) {
				const meta = outputMeta().truncationFromSummary(result, { direction: "tail" }).get();
				this.ctx.pythonComponent.setComplete(result.exitCode, result.cancelled, {
					output: result.output,
					truncation: meta?.truncation,
				});
			}
		} catch (error) {
			if (this.ctx.pythonComponent) {
				this.ctx.pythonComponent.setComplete(undefined, false);
			}
			this.ctx.showError(`Python execution failed: ${error instanceof Error ? error.message : "Unknown error"}`);
		}

		this.ctx.pythonComponent = undefined;
		this.ctx.ui.requestRender();
	}

	async handleCompactCommand(customInstructions?: string): Promise<void> {
		const entries = this.ctx.sessionManager.getEntries();
		const messageCount = entries.filter(e => e.type === "message").length;

		if (messageCount < 2) {
			this.ctx.showWarning("Nothing to compact (no messages yet)");
			return;
		}

		await this.executeCompaction(customInstructions, false);
	}

	async handleSkillCommand(skillPath: string, args: string): Promise<void> {
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
			spinner => theme.fg("accent", spinner),
			text => theme.fg("muted", text),
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

	async handleHandoffCommand(customInstructions?: string): Promise<void> {
		const entries = this.ctx.sessionManager.getEntries();
		const messageCount = entries.filter(e => e.type === "message").length;

		if (messageCount < 2) {
			this.ctx.showWarning("Nothing to hand off (no messages yet)");
			return;
		}

		try {
			// The agent will visibly generate the handoff document in chat
			const result = await this.ctx.session.handoff(customInstructions);

			if (!result) {
				this.ctx.showError("Handoff cancelled");
				return;
			}

			// Rebuild chat from the new session (which now contains the handoff document)
			this.ctx.rebuildChatFromMessages();

			this.ctx.statusLine.invalidate();
			this.ctx.updateEditorTopBorder();
			await this.ctx.reloadTodos();

			this.ctx.chatContainer.addChild(new Spacer(1));
			this.ctx.chatContainer.addChild(
				new Text(`${theme.fg("accent", `${theme.status.success} New session started with handoff context`)}`, 1, 1),
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message === "Handoff cancelled" || (error instanceof Error && error.name === "AbortError")) {
				this.ctx.showError("Handoff cancelled");
			} else {
				this.ctx.showError(`Handoff failed: ${message}`);
			}
		}
		this.ctx.ui.requestRender();
	}
}

const BAR_WIDTH = 24;
const COLUMN_WIDTH = BAR_WIDTH + 2;

function formatProviderName(provider: string): string {
	return provider
		.split(/[-_]/g)
		.map(part => (part ? part[0].toUpperCase() + part.slice(1) : ""))
		.join(" ");
}

function formatNumber(value: number, maxFractionDigits = 1): string {
	return new Intl.NumberFormat("en-US", { maximumFractionDigits: maxFractionDigits }).format(value);
}

function formatUsedAccounts(value: number): string {
	return `${value.toFixed(2)} used`;
}

function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.round(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;
	const days = Math.floor(hours / 24);
	const hrs = hours % 24;
	if (days > 0) return `${days}d ${hrs}h`;
	if (hours > 0) return `${hours}h ${mins}m`;
	if (minutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
}

function formatDurationShort(ms: number): string {
	const totalSeconds = Math.max(0, Math.round(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;
	const days = Math.floor(hours / 24);
	const hrs = hours % 24;
	if (days > 0) return `${days}d${hrs > 0 ? ` ${hrs}h` : ""}`;
	if (hours > 0) return `${hours}h${mins > 0 ? ` ${mins}m` : ""}`;
	if (minutes > 0) return `${minutes}m`;
	return `${totalSeconds}s`;
}

function resolveFraction(limit: UsageLimit): number | undefined {
	const amount = limit.amount;
	if (amount.usedFraction !== undefined) return amount.usedFraction;
	if (amount.used !== undefined && amount.limit !== undefined && amount.limit > 0) {
		return amount.used / amount.limit;
	}
	if (amount.unit === "percent" && amount.used !== undefined) {
		return amount.used / 100;
	}
	return undefined;
}

function resolveProviderUsageTotal(reports: UsageReport[]): number {
	return reports
		.flatMap(report => report.limits)
		.map(limit => resolveFraction(limit) ?? 0)
		.reduce((sum, value) => sum + value, 0);
}

function formatLimitTitle(limit: UsageLimit): string {
	const tier = limit.scope.tier;
	if (tier && !limit.label.toLowerCase().includes(tier.toLowerCase())) {
		return `${limit.label} (${tier})`;
	}
	return limit.label;
}

function formatWindowSuffix(label: string, windowLabel: string, uiTheme: typeof theme): string {
	const normalizedLabel = label.toLowerCase();
	const normalizedWindow = windowLabel.toLowerCase();
	if (normalizedWindow === "quota window") return "";
	if (normalizedLabel.includes(normalizedWindow)) return "";
	return uiTheme.fg("dim", `(${windowLabel})`);
}

function formatAccountLabel(limit: UsageLimit, report: UsageReport, index: number): string {
	const email = (report.metadata?.email as string | undefined) ?? limit.scope.accountId;
	if (email) return email;
	const accountId = (report.metadata?.accountId as string | undefined) ?? limit.scope.accountId;
	if (accountId) return accountId;
	return `account ${index + 1}`;
}

function formatResetShort(limit: UsageLimit, nowMs: number): string | undefined {
	if (limit.window?.resetInMs !== undefined) {
		return formatDurationShort(limit.window.resetInMs);
	}
	if (limit.window?.resetsAt !== undefined) {
		return formatDurationShort(limit.window.resetsAt - nowMs);
	}
	return undefined;
}

function formatAccountHeader(limit: UsageLimit, report: UsageReport, index: number, nowMs: number): string {
	const label = formatAccountLabel(limit, report, index);
	const reset = formatResetShort(limit, nowMs);
	if (!reset) return label;
	return `${label} (${reset})`;
}

function padColumn(text: string, width: number): string {
	const visible = visibleWidth(text);
	if (visible >= width) return text;
	return `${text}${" ".repeat(width - visible)}`;
}

function resolveAggregateStatus(limits: UsageLimit[]): UsageLimit["status"] {
	const hasOk = limits.some(limit => limit.status === "ok");
	const hasWarning = limits.some(limit => limit.status === "warning");
	const hasExhausted = limits.some(limit => limit.status === "exhausted");
	if (!hasOk && !hasWarning && !hasExhausted) return "unknown";
	if (hasOk) {
		return hasWarning || hasExhausted ? "warning" : "ok";
	}
	if (hasWarning) return "warning";
	return "exhausted";
}

function isZeroUsage(limit: UsageLimit): boolean {
	const amount = limit.amount;
	if (amount.usedFraction !== undefined) return amount.usedFraction <= 0;
	if (amount.used !== undefined) return amount.used <= 0;
	if (amount.unit === "percent" && amount.used !== undefined) return amount.used <= 0;
	if (amount.remainingFraction !== undefined) return amount.remainingFraction >= 1;
	return false;
}

function isZeroUsageGroup(limits: UsageLimit[]): boolean {
	return limits.length > 0 && limits.every(limit => isZeroUsage(limit));
}

function formatAggregateAmount(limits: UsageLimit[]): string {
	const fractions = limits
		.map(limit => resolveFraction(limit))
		.filter((value): value is number => value !== undefined);
	if (fractions.length === limits.length && fractions.length > 0) {
		const sum = fractions.reduce((total, value) => total + value, 0);
		const usedPct = Math.max(sum * 100, 0);
		const remainingPct = Math.max(0, limits.length * 100 - usedPct);
		const avgRemaining = limits.length > 0 ? remainingPct / limits.length : remainingPct;
		return `${formatUsedAccounts(sum)} (${formatNumber(avgRemaining)}% left)`;
	}

	const amounts = limits
		.map(limit => limit.amount)
		.filter(amount => amount.used !== undefined && amount.limit !== undefined && amount.limit > 0);
	if (amounts.length === limits.length && amounts.length > 0) {
		const totalUsed = amounts.reduce((sum, amount) => sum + (amount.used ?? 0), 0);
		const totalLimit = amounts.reduce((sum, amount) => sum + (amount.limit ?? 0), 0);
		const usedPct = totalLimit > 0 ? (totalUsed / totalLimit) * 100 : 0;
		const remainingPct = Math.max(0, 100 - usedPct);
		const usedAccounts = totalLimit > 0 ? (usedPct / 100) * limits.length : 0;
		return `${formatUsedAccounts(usedAccounts)} (${formatNumber(remainingPct)}% left)`;
	}

	return `Accounts: ${limits.length}`;
}

function resolveResetRange(limits: UsageLimit[], nowMs: number): string | null {
	const resets = limits
		.map(limit => limit.window?.resetInMs ?? undefined)
		.filter((value): value is number => value !== undefined && Number.isFinite(value) && value > 0);
	if (resets.length === 0) {
		const absolute = limits
			.map(limit => limit.window?.resetsAt)
			.filter((value): value is number => value !== undefined && Number.isFinite(value) && value > nowMs);
		if (absolute.length === 0) return null;
		const earliest = Math.min(...absolute);
		return `resets at ${new Date(earliest).toLocaleString()}`;
	}
	const minReset = Math.min(...resets);
	const maxReset = Math.max(...resets);
	if (maxReset - minReset > 60_000) {
		return `resets in ${formatDuration(minReset)}–${formatDuration(maxReset)}`;
	}
	return `resets in ${formatDuration(minReset)}`;
}

function resolveStatusIcon(status: UsageLimit["status"], uiTheme: typeof theme): string {
	if (status === "exhausted") return uiTheme.fg("error", uiTheme.status.error);
	if (status === "warning") return uiTheme.fg("warning", uiTheme.status.warning);
	if (status === "ok") return uiTheme.fg("success", uiTheme.status.success);
	return uiTheme.fg("dim", uiTheme.status.pending);
}

function resolveStatusColor(status: UsageLimit["status"]): "success" | "warning" | "error" | "dim" {
	if (status === "exhausted") return "error";
	if (status === "warning") return "warning";
	if (status === "ok") return "success";
	return "dim";
}

function renderUsageBar(limit: UsageLimit, uiTheme: typeof theme): string {
	const fraction = resolveFraction(limit);
	if (fraction === undefined) {
		return uiTheme.fg("dim", `[${"·".repeat(BAR_WIDTH)}]`);
	}
	const clamped = Math.min(Math.max(fraction, 0), 1);
	const filled = Math.round(clamped * BAR_WIDTH);
	const filledBar = "█".repeat(filled);
	const emptyBar = "░".repeat(Math.max(0, BAR_WIDTH - filled));
	const color = resolveStatusColor(limit.status);
	return `${uiTheme.fg("dim", "[")}${uiTheme.fg(color, filledBar)}${uiTheme.fg("dim", emptyBar)}${uiTheme.fg("dim", "]")}`;
}

function renderUsageReports(reports: UsageReport[], uiTheme: typeof theme, nowMs: number): string {
	const lines: string[] = [];
	const latestFetchedAt = Math.max(...reports.map(report => report.fetchedAt ?? 0));
	const headerSuffix = latestFetchedAt ? ` (${formatDuration(nowMs - latestFetchedAt)} ago)` : "";
	lines.push(uiTheme.bold(uiTheme.fg("accent", `Usage${headerSuffix}`)));
	const grouped = new Map<string, UsageReport[]>();
	for (const report of reports) {
		const list = grouped.get(report.provider) ?? [];
		list.push(report);
		grouped.set(report.provider, list);
	}
	const providerEntries = Array.from(grouped.entries())
		.map(([provider, providerReports]) => ({
			provider,
			providerReports,
			totalUsage: resolveProviderUsageTotal(providerReports),
		}))
		.sort((a, b) => {
			if (a.totalUsage !== b.totalUsage) return a.totalUsage - b.totalUsage;
			return a.provider.localeCompare(b.provider);
		});

	for (const { provider, providerReports } of providerEntries) {
		lines.push("");
		const providerName = formatProviderName(provider);

		const limitGroups = new Map<
			string,
			{ label: string; windowLabel: string; limits: UsageLimit[]; reports: UsageReport[] }
		>();
		for (const report of providerReports) {
			for (const limit of report.limits) {
				const windowId = limit.window?.id ?? limit.scope.windowId ?? "default";
				const key = `${formatLimitTitle(limit)}|${windowId}`;
				const windowLabel = limit.window?.label ?? windowId;
				const entry = limitGroups.get(key) ?? {
					label: formatLimitTitle(limit),
					windowLabel,
					limits: [],
					reports: [],
				};
				entry.limits.push(limit);
				entry.reports.push(report);
				limitGroups.set(key, entry);
			}
		}

		const providerAllZero = isZeroUsageGroup(Array.from(limitGroups.values()).flatMap(group => group.limits));
		if (providerAllZero) {
			const providerTitle = `${resolveStatusIcon("ok", uiTheme)} ${uiTheme.fg("accent", `${providerName} (0%)`)}`;
			lines.push(uiTheme.bold(providerTitle));
			continue;
		}

		lines.push(uiTheme.bold(uiTheme.fg("accent", providerName)));

		for (const group of limitGroups.values()) {
			const entries = group.limits.map((limit, index) => ({
				limit,
				report: group.reports[index],
				fraction: resolveFraction(limit),
				index,
			}));
			entries.sort((a, b) => {
				const aFraction = a.fraction ?? -1;
				const bFraction = b.fraction ?? -1;
				if (aFraction !== bFraction) return bFraction - aFraction;
				return a.index - b.index;
			});
			const sortedLimits = entries.map(entry => entry.limit);
			const sortedReports = entries.map(entry => entry.report);

			const status = resolveAggregateStatus(sortedLimits);
			const statusIcon = resolveStatusIcon(status, uiTheme);
			if (isZeroUsageGroup(sortedLimits)) {
				const resetText = resolveResetRange(sortedLimits, nowMs);
				const resetSuffix = resetText ? ` | ${resetText}` : "";
				const windowSuffix = formatWindowSuffix(group.label, group.windowLabel, uiTheme);
				lines.push(
					`${statusIcon} ${uiTheme.bold(group.label)} ${windowSuffix} ${uiTheme.fg(
						"dim",
						`0%${resetSuffix}`,
					)}`.trim(),
				);
				continue;
			}

			const windowSuffix = formatWindowSuffix(group.label, group.windowLabel, uiTheme);
			lines.push(`${statusIcon} ${uiTheme.bold(group.label)} ${windowSuffix}`.trim());
			const accountLabels = sortedLimits.map((limit, index) =>
				padColumn(formatAccountHeader(limit, sortedReports[index], index, nowMs), COLUMN_WIDTH),
			);
			lines.push(`  ${accountLabels.join(" ")}`.trimEnd());
			const bars = sortedLimits.map(limit => padColumn(renderUsageBar(limit, uiTheme), COLUMN_WIDTH));
			lines.push(`  ${bars.join(" ")} ${formatAggregateAmount(sortedLimits)}`.trimEnd());
			const resetText = sortedLimits.length <= 1 ? resolveResetRange(sortedLimits, nowMs) : null;
			if (resetText) {
				lines.push(`  ${uiTheme.fg("dim", resetText)}`.trimEnd());
			}
			const notes = sortedLimits.flatMap(limit => limit.notes ?? []);
			if (notes.length > 0) {
				lines.push(`  ${uiTheme.fg("dim", notes.join(" • "))}`.trimEnd());
			}
		}

		// No per-provider footer; global header shows last check.
	}

	return lines.join("\n");
}
