import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import { Type } from "@sinclair/typebox";
import type { SSHHost } from "../../capability/ssh";
import { sshCapability } from "../../capability/ssh";
import { loadCapability } from "../../discovery/index";
import type { Theme } from "../../modes/interactive/theme/theme";
import sshDescriptionBase from "../../prompts/tools/ssh.md" with { type: "text" };
import type { RenderResultOptions } from "../custom-tools/types";
import { renderPromptTemplate } from "../prompt-templates";
import type { SSHHostInfo } from "../ssh/connection-manager";
import { ensureHostInfo, getHostInfoForHost } from "../ssh/connection-manager";
import { executeSSH } from "../ssh/ssh-executor";
import type { ToolSession } from "./index";
import { ToolUIKit } from "./render-utils";
import { formatTailTruncationNotice, type TruncationResult, truncateTail } from "./truncate";

const sshSchema = Type.Object({
	host: Type.String({ description: "Host name from ssh.json or .ssh.json" }),
	command: Type.String({ description: "Command to execute on the remote host" }),
	cwd: Type.Optional(Type.String({ description: "Remote working directory (optional)" })),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
});

export interface SSHToolDetails {
	truncation?: TruncationResult;
	fullOutputPath?: string;
}

function formatHostEntry(host: SSHHost): string {
	const info = getHostInfoForHost(host);

	let shell: string;
	if (!info) {
		shell = "detecting...";
	} else if (info.os === "windows") {
		if (info.compatEnabled) {
			const compatShell = info.compatShell || "bash";
			shell = `windows/${compatShell}`;
		} else if (info.shell === "powershell") {
			shell = "windows/powershell";
		} else {
			shell = "windows/cmd";
		}
	} else if (info.os === "linux") {
		shell = `linux/${info.shell}`;
	} else if (info.os === "macos") {
		shell = `macos/${info.shell}`;
	} else {
		shell = `unknown/${info.shell}`;
	}

	return `- ${host.name} (${host.host}) | ${shell}`;
}

function formatDescription(hosts: SSHHost[]): string {
	const baseDescription = renderPromptTemplate(sshDescriptionBase);
	if (hosts.length === 0) {
		return baseDescription;
	}
	const hostList = hosts.map(formatHostEntry).join("\n");
	return `${baseDescription}\n\nAvailable hosts:\n${hostList}`;
}

function quoteRemotePath(value: string): string {
	if (value.length === 0) {
		return "''";
	}
	const escaped = value.replace(/'/g, "'\\''");
	return `'${escaped}'`;
}

function quotePowerShellPath(value: string): string {
	if (value.length === 0) {
		return "''";
	}
	const escaped = value.replace(/'/g, "''");
	return `'${escaped}'`;
}

function quoteCmdPath(value: string): string {
	const escaped = value.replace(/"/g, '""');
	return `"${escaped}"`;
}

function buildRemoteCommand(command: string, cwd: string | undefined, info: SSHHostInfo): string {
	if (!cwd) return command;

	if (info.os === "windows" && !info.compatEnabled) {
		if (info.shell === "powershell") {
			return `Set-Location -Path ${quotePowerShellPath(cwd)}; ${command}`;
		}
		return `cd /d ${quoteCmdPath(cwd)} && ${command}`;
	}

	return `cd -- ${quoteRemotePath(cwd)} && ${command}`;
}

async function loadHosts(session: ToolSession): Promise<{
	hostNames: string[];
	hostsByName: Map<string, SSHHost>;
}> {
	const result = await loadCapability<SSHHost>(sshCapability.id, { cwd: session.cwd });
	const hostsByName = new Map<string, SSHHost>();
	for (const host of result.items) {
		if (!hostsByName.has(host.name)) {
			hostsByName.set(host.name, host);
		}
	}
	const hostNames = Array.from(hostsByName.keys()).sort();
	return { hostNames, hostsByName };
}

interface SshToolParams {
	host: string;
	command: string;
	cwd?: string;
	timeout?: number;
}

export class SshTool implements AgentTool<typeof sshSchema, SSHToolDetails> {
	public readonly name = "ssh";
	public readonly label = "SSH";
	public readonly description: string;
	public readonly parameters = sshSchema;

	private readonly allowedHosts: Set<string>;
	private readonly hostsByName: Map<string, SSHHost>;
	private readonly hostNames: string[];

	constructor(hostNames: string[], hostsByName: Map<string, SSHHost>) {
		this.hostNames = hostNames;
		this.hostsByName = hostsByName;
		this.allowedHosts = new Set(hostNames);

		const descriptionHosts = hostNames
			.map((name) => hostsByName.get(name))
			.filter((host): host is SSHHost => host !== undefined);

		this.description = formatDescription(descriptionHosts);
	}

	public async execute(
		_toolCallId: string,
		{ host, command, cwd, timeout }: SshToolParams,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<SSHToolDetails>,
		_ctx?: AgentToolContext,
	): Promise<AgentToolResult<SSHToolDetails>> {
		if (!this.allowedHosts.has(host)) {
			throw new Error(`Unknown SSH host: ${host}. Available hosts: ${this.hostNames.join(", ")}`);
		}

		const hostConfig = this.hostsByName.get(host);
		if (!hostConfig) {
			throw new Error(`SSH host not loaded: ${host}`);
		}

		const hostInfo = await ensureHostInfo(hostConfig);
		const remoteCommand = buildRemoteCommand(command, cwd, hostInfo);
		let currentOutput = "";

		const result = await executeSSH(hostConfig, remoteCommand, {
			timeout: timeout ? timeout * 1000 : undefined,
			signal,
			compatEnabled: hostInfo.compatEnabled,
			onChunk: (chunk) => {
				currentOutput += chunk;
				if (onUpdate) {
					const truncation = truncateTail(currentOutput);
					onUpdate({
						content: [{ type: "text", text: truncation.content || "" }],
						details: {
							truncation: truncation.truncated ? truncation : undefined,
						},
					});
				}
			},
		});

		if (result.cancelled) {
			throw new Error(result.output || "Command aborted");
		}

		const truncation = truncateTail(result.output);
		let outputText = truncation.content || "(no output)";

		let details: SSHToolDetails | undefined;

		if (truncation.truncated) {
			details = {
				truncation,
				fullOutputPath: result.fullOutputPath,
			};
			outputText += formatTailTruncationNotice(truncation, {
				fullOutputPath: result.fullOutputPath,
				originalContent: result.output,
			});
		}

		if (result.exitCode !== 0 && result.exitCode !== undefined) {
			outputText += `\n\nCommand exited with code ${result.exitCode}`;
			throw new Error(outputText);
		}

		return { content: [{ type: "text", text: outputText }], details: details ?? {} };
	}
}

export async function loadSshTool(session: ToolSession): Promise<SshTool | null> {
	const { hostNames, hostsByName } = await loadHosts(session);
	if (hostNames.length === 0) {
		return null;
	}
	return new SshTool(hostNames, hostsByName);
}

// =============================================================================
// TUI Renderer
// =============================================================================

interface SshRenderArgs {
	host?: string;
	command?: string;
	timeout?: number;
}

interface SshRenderContext {
	/** Visual lines for truncated output (pre-computed by tool-execution) */
	visualLines?: string[];
	/** Number of lines skipped */
	skippedCount?: number;
	/** Total visual lines */
	totalVisualLines?: number;
}

export const sshToolRenderer = {
	renderCall(args: SshRenderArgs, uiTheme: Theme): Component {
		const ui = new ToolUIKit(uiTheme);
		const host = args.host || uiTheme.format.ellipsis;
		const command = args.command || uiTheme.format.ellipsis;
		const text = ui.title(`[${host}] $ ${command}`);
		return new Text(text, 0, 0);
	},

	renderResult(
		result: {
			content: Array<{ type: string; text?: string }>;
			details?: SSHToolDetails;
		},
		options: RenderResultOptions & { renderContext?: SshRenderContext },
		uiTheme: Theme,
	): Component {
		const ui = new ToolUIKit(uiTheme);
		const { expanded, renderContext } = options;
		const details = result.details;
		const lines: string[] = [];

		const textContent = result.content?.find((c) => c.type === "text")?.text ?? "";
		const output = textContent.trim();

		if (output) {
			if (expanded) {
				const styledOutput = output
					.split("\n")
					.map((line) => uiTheme.fg("toolOutput", line))
					.join("\n");
				lines.push(styledOutput);
			} else if (renderContext?.visualLines) {
				const { visualLines, skippedCount = 0, totalVisualLines = visualLines.length } = renderContext;
				if (skippedCount > 0) {
					lines.push(
						uiTheme.fg(
							"dim",
							`${uiTheme.format.ellipsis} (${skippedCount} earlier lines, showing ${visualLines.length} of ${totalVisualLines}) (ctrl+o to expand)`,
						),
					);
				}
				lines.push(...visualLines);
			} else {
				const outputLines = output.split("\n");
				const maxLines = 5;
				const displayLines = outputLines.slice(0, maxLines);
				const remaining = outputLines.length - maxLines;

				lines.push(...displayLines.map((line) => uiTheme.fg("toolOutput", line)));
				if (remaining > 0) {
					lines.push(uiTheme.fg("dim", `${uiTheme.format.ellipsis} (${remaining} more lines) (ctrl+o to expand)`));
				}
			}
		}

		const truncation = details?.truncation;
		const fullOutputPath = details?.fullOutputPath;
		if (truncation?.truncated || fullOutputPath) {
			const warnings: string[] = [];
			if (fullOutputPath) {
				warnings.push(`Full output: ${fullOutputPath}`);
			}
			if (truncation?.truncated) {
				if (truncation.truncatedBy === "lines") {
					warnings.push(`Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`);
				} else {
					warnings.push(
						`Truncated: ${truncation.outputLines} lines shown (${ui.formatBytes(truncation.maxBytes)} limit)`,
					);
				}
			}
			lines.push(uiTheme.fg("warning", ui.wrapBrackets(warnings.join(". "))));
		}

		return new Text(lines.join("\n"), 0, 0);
	},
};
