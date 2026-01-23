import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import { Type } from "@sinclair/typebox";
import type { SSHHost } from "$c/capability/ssh";
import { sshCapability } from "$c/capability/ssh";
import { renderPromptTemplate } from "$c/config/prompt-templates";
import { loadCapability } from "$c/discovery/index";
import type { RenderResultOptions } from "$c/extensibility/custom-tools/types";
import type { Theme } from "$c/modes/theme/theme";
import sshDescriptionBase from "$c/prompts/tools/ssh.md" with { type: "text" };
import type { SSHHostInfo } from "$c/ssh/connection-manager";
import { ensureHostInfo, getHostInfoForHost } from "$c/ssh/connection-manager";
import { executeSSH } from "$c/ssh/ssh-executor";
import type { OutputMeta } from "$c/tools/output-meta";
import { ToolError } from "$c/tools/tool-errors";
import { renderOutputBlock, renderStatusLine } from "$c/tui";
import type { ToolSession } from "./index";
import { allocateOutputArtifact, createTailBuffer } from "./output-utils";
import { formatBytes, wrapBrackets } from "./render-utils";
import { toolResult } from "./tool-result";
import { DEFAULT_MAX_BYTES } from "./truncate";

const sshSchema = Type.Object({
	host: Type.String({ description: "Host name from ssh.json or .ssh.json" }),
	command: Type.String({ description: "Command to execute on the remote host" }),
	cwd: Type.Optional(Type.String({ description: "Remote working directory (optional)" })),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (default: 60)" })),
});

export interface SSHToolDetails {
	meta?: OutputMeta;
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

	private readonly session: ToolSession;

	private readonly allowedHosts: Set<string>;
	private readonly hostsByName: Map<string, SSHHost>;
	private readonly hostNames: string[];

	constructor(session: ToolSession, hostNames: string[], hostsByName: Map<string, SSHHost>) {
		this.session = session;
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
		{ host, command, cwd, timeout: rawTimeout = 60 }: SshToolParams,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<SSHToolDetails>,
		_ctx?: AgentToolContext,
	): Promise<AgentToolResult<SSHToolDetails>> {
		if (!this.allowedHosts.has(host)) {
			throw new ToolError(`Unknown SSH host: ${host}. Available hosts: ${this.hostNames.join(", ")}`);
		}

		const hostConfig = this.hostsByName.get(host);
		if (!hostConfig) {
			throw new ToolError(`SSH host not loaded: ${host}`);
		}

		const hostInfo = await ensureHostInfo(hostConfig);
		const remoteCommand = buildRemoteCommand(command, cwd, hostInfo);

		// Auto-convert milliseconds to seconds if value > 1000 (16+ min is unreasonable)
		let timeoutSec = rawTimeout > 1000 ? rawTimeout / 1000 : rawTimeout;
		// Clamp to reasonable range: 1s - 3600s (1 hour)
		timeoutSec = Math.max(1, Math.min(3600, timeoutSec));
		const timeoutMs = timeoutSec * 1000;

		const tailBuffer = createTailBuffer(DEFAULT_MAX_BYTES);
		const { artifactPath, artifactId } = await allocateOutputArtifact(this.session, "ssh");

		const result = await executeSSH(hostConfig, remoteCommand, {
			timeout: timeoutMs,
			signal,
			compatEnabled: hostInfo.compatEnabled,
			artifactPath,
			artifactId,
			onChunk: (chunk) => {
				tailBuffer.append(chunk);
				if (onUpdate) {
					onUpdate({
						content: [{ type: "text", text: tailBuffer.text() }],
						details: {},
					});
				}
			},
		});

		if (result.cancelled) {
			throw new ToolError(result.output || "Command aborted");
		}

		const outputText = result.output || "(no output)";
		const details: SSHToolDetails = {};
		const resultBuilder = toolResult(details).text(outputText).truncationFromSummary(result, { direction: "tail" });

		if (result.exitCode !== 0 && result.exitCode !== undefined) {
			throw new ToolError(`${outputText}\n\nCommand exited with code ${result.exitCode}`);
		}

		return resultBuilder.done();
	}
}

export async function loadSshTool(session: ToolSession): Promise<SshTool | null> {
	const { hostNames, hostsByName } = await loadHosts(session);
	if (hostNames.length === 0) {
		return null;
	}
	return new SshTool(session, hostNames, hostsByName);
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
		const host = args.host || uiTheme.format.ellipsis;
		const command = args.command || uiTheme.format.ellipsis;
		const text = renderStatusLine({ icon: "pending", title: "SSH", description: `[${host}] $ ${command}` }, uiTheme);
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
		const { expanded, renderContext } = options;
		const details = result.details;
		const header = renderStatusLine({ icon: "success", title: "SSH" }, uiTheme);
		const outputLines: string[] = [];

		const textContent = result.content?.find((c) => c.type === "text")?.text ?? "";
		const output = textContent.trim();

		if (output) {
			if (expanded) {
				outputLines.push(...output.split("\n").map((line) => uiTheme.fg("toolOutput", line)));
			} else if (renderContext?.visualLines) {
				const { visualLines, skippedCount = 0, totalVisualLines = visualLines.length } = renderContext;
				if (skippedCount > 0) {
					outputLines.push(
						uiTheme.fg(
							"dim",
							`${uiTheme.format.ellipsis} (${skippedCount} earlier lines, showing ${visualLines.length} of ${totalVisualLines}) (ctrl+o to expand)`,
						),
					);
				}
				outputLines.push(...visualLines);
			} else {
				const outputLinesRaw = output.split("\n");
				const maxLines = 5;
				const displayLines = outputLinesRaw.slice(0, maxLines);
				const remaining = outputLinesRaw.length - maxLines;
				outputLines.push(...displayLines.map((line) => uiTheme.fg("toolOutput", line)));
				if (remaining > 0) {
					outputLines.push(
						uiTheme.fg("dim", `${uiTheme.format.ellipsis} (${remaining} more lines) (ctrl+o to expand)`),
					);
				}
			}
		}

		const truncation = details?.meta?.truncation;
		if (truncation) {
			const warnings: string[] = [];
			if (truncation.artifactId) {
				warnings.push(`Full output: artifact://${truncation.artifactId}`);
			}
			if (truncation.truncatedBy === "lines") {
				warnings.push(`Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`);
			} else {
				warnings.push(
					`Truncated: ${truncation.outputLines} lines shown (${formatBytes(truncation.outputBytes)} limit)`,
				);
			}
			outputLines.push(uiTheme.fg("warning", wrapBrackets(warnings.join(". "), uiTheme)));
		}

		return {
			render: (width: number) =>
				renderOutputBlock(
					{
						header,
						state: "success",
						sections: [{ label: uiTheme.fg("toolTitle", "Output"), lines: outputLines }],
						width,
					},
					uiTheme,
				),
			invalidate: () => {},
		};
	},
};
