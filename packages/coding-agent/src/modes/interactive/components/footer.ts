import { type Component, truncateToWidth, visibleWidth } from "omk-tui";
import type { AgentSession } from "../../../core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.ts";
import { type ContextPressure, contextPressure } from "../control-plane-view-model.ts";
import { theme } from "../theme/theme.ts";
import { formatFooterPwdRowWithTodosChip } from "../todos-visibility.ts";
import { FooterMetricsTimer } from "./footer-metrics-timer.ts";

/** Context percentage colour per pressure band; normal and unknown stay uncoloured. */
const CONTEXT_PRESSURE_COLOR: Readonly<Record<ContextPressure, "error" | "warning" | undefined>> = {
	unknown: undefined,
	normal: undefined,
	elevated: "warning",
	critical: "error",
};

function sanitizeStatusText(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

import {
	formatBytes,
	formatCwdForFooter,
	formatEndpointForFooter,
	formatPackageIntake,
	formatTokens,
} from "./footer-format.ts";

export { formatBytes, formatCwdForFooter, formatEndpointForFooter, formatPackageIntake, formatTokens };

/**
 * Footer component that shows pwd, token stats, and context usage.
 * Computes token/context stats from session, gets git branch and extension statuses from provider.
 */
export class FooterComponent implements Component {
	private autoCompactEnabled = true;
	private showSystemMetrics = false;
	private getTodosVisible?: () => boolean;

	setTodosVisibilityGetter(getter: (() => boolean) | undefined): void {
		this.getTodosVisible = getter;
	}
	private readonly metricsTimer = new FooterMetricsTimer();
	private session: AgentSession;
	private footerData: ReadonlyFooterDataProvider;

	constructor(session: AgentSession, footerData: ReadonlyFooterDataProvider) {
		this.session = session;
		this.footerData = footerData;
	}

	setSession(session: AgentSession): void {
		this.session = session;
	}

	setAutoCompactEnabled(enabled: boolean): void {
		this.autoCompactEnabled = enabled;
	}

	/** Show system-wide CPU/MEM metrics in the stats line (off by default). */
	setShowSystemMetrics(enabled: boolean): void {
		this.showSystemMetrics = enabled;
		this.metricsTimer.setEnabled(enabled);
	}

	/**
	 * Register the 2s refresh callback for live CPU/MEM metrics. The interval only
	 * runs while metrics are shown, so the default (off) never wakes the event loop.
	 */
	setMetricsTickHandler(onTick: (() => void) | undefined): void {
		this.metricsTimer.setHandler(onTick);
	}

	/** True when the footer is configured to show live CPU/MEM metrics. */
	isShowingSystemMetrics(): boolean {
		return this.showSystemMetrics;
	}

	/**
	 * Build a compact system-wide CPU/memory metrics segment for the footer.
	 * Degrades gracefully to shorter forms (or is omitted entirely) when the
	 * terminal is very narrow so the rest of the footer can still render.
	 */
	private buildMetricsSegment(width: number): string | undefined {
		if (!this.showSystemMetrics) {
			return undefined;
		}
		const cpu = this.footerData.getSystemCpuPercent();
		const memUsed = this.footerData.getSystemMemoryUsedBytes();
		const memTotal = this.footerData.getSystemMemoryTotalBytes();
		if (cpu === null || memUsed === null || memTotal === null || memTotal <= 0) {
			return undefined;
		}

		const memPercent = (memUsed / memTotal) * 100;
		const color: "error" | "warning" | "dim" =
			cpu >= 90 || memPercent >= 95 ? "error" : cpu >= 70 || memPercent >= 85 ? "warning" : "dim";

		const cpuStr = `${Math.round(cpu)}%`;
		const memStr = `${Math.round(memPercent)}%`;

		if (width >= 56)
			return theme.fg(color, `CPU ${cpuStr} MEM ${memStr} (${formatBytes(memUsed)}/${formatBytes(memTotal)})`);
		if (width >= 48) return theme.fg(color, `CPU ${cpuStr} MEM ${memStr}`);
		if (width >= 30) return theme.fg(color, `${cpuStr} ${memStr}`);
		if (width >= 18) return theme.fg(color, cpuStr);
		return undefined;
	}

	invalidate(): void {}

	dispose(): void {
		this.setMetricsTickHandler(undefined);
	}

	render(width: number): string[] {
		return this.renderParts(width).lines;
	}

	/** The rendered rows plus the stats row split at its padding, for the OpenTUI footer. */
	renderParts(width: number): { lines: string[]; statsLeft: string; statsRight: string } {
		const state = this.session.state;

		// Calculate cumulative usage from ALL session entries (not just post-compaction messages)
		let totalInput = 0;
		let totalOutput = 0;
		let totalCacheRead = 0;
		let totalCacheWrite = 0;
		let totalCost = 0;

		for (const entry of this.session.sessionManager.getEntries()) {
			if (entry.type === "message" && entry.message.role === "assistant") {
				totalInput += entry.message.usage.input;
				totalOutput += entry.message.usage.output;
				totalCacheRead += entry.message.usage.cacheRead;
				totalCacheWrite += entry.message.usage.cacheWrite;
				totalCost += entry.message.usage.cost.total;
			}
		}

		// Calculate context usage from session (handles compaction correctly).
		// After compaction, tokens are unknown until the next LLM response.
		const contextUsage = this.session.getContextUsage();
		const contextWindow = contextUsage?.contextWindow ?? state.model?.contextWindow ?? 0;
		const contextPercentValue = contextUsage?.percent ?? 0;
		// Floor, never round: 69.96% shows 69.9%, so the number cannot reach a band before its colour does.
		const contextPercent =
			contextUsage?.percent !== null ? (Math.floor(contextPercentValue * 10) / 10).toFixed(1) : "?";

		// Replace home directory with ~
		const cwd = formatCwdForFooter(this.session.sessionManager.getCwd(), process.env.HOME || process.env.USERPROFILE);
		const branch = this.footerData.getGitBranch();
		const sessionName = this.session.sessionManager.getSessionName();
		const metaDot = theme.fg("borderMuted", " · ");
		const metaSegments: string[] = [`${theme.fg("dim", "CWD")} ${theme.fg("muted", sanitizeStatusText(cwd))}`];
		if (branch) {
			metaSegments.push(`${theme.fg("dim", "GIT")} ${theme.fg("muted", sanitizeStatusText(branch))}`);
		}
		if (sessionName) {
			metaSegments.push(theme.fg("dim", sanitizeStatusText(sessionName)));
		}

		// Build stats line. Each part carries a drop priority so narrow terminals
		// shed low-value segments first instead of truncating the context stats tail.
		const statsParts: Array<{ text: string; priority: number; styled?: boolean }> = [];
		if (totalInput) statsParts.push({ text: `↑${formatTokens(totalInput)}`, priority: 3 });
		if (totalOutput) statsParts.push({ text: `↓${formatTokens(totalOutput)}`, priority: 3 });
		if (totalCacheRead) statsParts.push({ text: `R${formatTokens(totalCacheRead)}`, priority: 2 });
		if (totalCacheWrite) statsParts.push({ text: `W${formatTokens(totalCacheWrite)}`, priority: 2 });

		const usingSubscription = state.model ? this.session.modelRegistry.isUsingOAuth(state.model) : false;
		if (totalCost || usingSubscription) {
			const costStr = `$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`;
			statsParts.push({ text: costStr, priority: 4 });
		}

		const metricsSegment = this.buildMetricsSegment(width);
		if (metricsSegment) {
			statsParts.push({ text: metricsSegment, priority: 1, styled: true });
		}
		const packageIntake = this.footerData.getPackageIntakeSummary();
		if (packageIntake.total > 0) {
			statsParts.push({ text: formatPackageIntake(packageIntake), priority: 2 });
		}

		const autoIndicator = this.autoCompactEnabled ? " (auto)" : "";
		const contextPercentDisplay =
			contextPercent === "?"
				? `?/${formatTokens(contextWindow)}${autoIndicator}`
				: `${contextPercent}%/${formatTokens(contextWindow)}${autoIndicator}`;
		const pressureColor = CONTEXT_PRESSURE_COLOR[contextPressure(contextUsage?.percent)];
		const contextPercentStr = pressureColor ? theme.fg(pressureColor, contextPercentDisplay) : contextPercentDisplay;
		statsParts.push({ text: contextPercentStr, priority: Number.POSITIVE_INFINITY, styled: Boolean(pressureColor) });

		const joinStats = (parts: readonly { text: string; styled?: boolean }[]): string =>
			parts.map((part) => (part.styled ? part.text : theme.fg("dim", part.text))).join(metaDot);

		let activeParts = [...statsParts];
		let statsLeft = joinStats(activeParts);
		while (visibleWidth(statsLeft) > width) {
			const droppable = activeParts.filter((part) => Number.isFinite(part.priority));
			if (droppable.length === 0) break;
			let lowest = droppable[0]!;
			for (const part of droppable) {
				if (part.priority < lowest.priority) lowest = part;
			}
			activeParts = activeParts.filter((part) => part !== lowest);
			statsLeft = joinStats(activeParts);
		}

		const modelName = state.model?.id || "no-model";
		let statsLeftWidth = visibleWidth(statsLeft);
		if (statsLeftWidth > width) {
			statsLeft = truncateToWidth(statsLeft, width, theme.fg("dim", "…"));
			statsLeftWidth = visibleWidth(statsLeft);
		}

		const minPadding = 2;

		let rightSideWithoutProvider = modelName;
		if (state.model?.reasoning) {
			const thinkingLevel = state.thinkingLevel || "off";
			rightSideWithoutProvider =
				thinkingLevel === "off" ? `${modelName} • thinking off` : `${modelName} • ${thinkingLevel}`;
		}

		let rightSide = rightSideWithoutProvider;
		if (this.footerData.getAvailableProviderCount() > 1 && state.model) {
			const endpointHost = formatEndpointForFooter(state.model.baseUrl);
			const providerLabel = endpointHost ? `${state.model.provider} · ${endpointHost}` : state.model.provider;
			rightSide = `(${providerLabel}) ${rightSideWithoutProvider}`;
			if (endpointHost && statsLeftWidth + minPadding + visibleWidth(rightSide) > width) {
				rightSide = `(${state.model.provider}) ${rightSideWithoutProvider}`;
			}
			if (statsLeftWidth + minPadding + visibleWidth(rightSide) > width) {
				rightSide = rightSideWithoutProvider;
			}
		}

		const rightSideWidth = visibleWidth(rightSide);
		const totalNeeded = statsLeftWidth + minPadding + rightSideWidth;

		let statsLine: string;
		let styledRight = "";
		if (totalNeeded <= width) {
			const padding = " ".repeat(width - statsLeftWidth - rightSideWidth);
			styledRight = theme.fg("muted", rightSide);
			statsLine = statsLeft + padding + styledRight;
		} else {
			const availableForRight = width - statsLeftWidth - minPadding;
			if (availableForRight > 0) {
				const truncatedRight = truncateToWidth(rightSide, availableForRight, "");
				const truncatedRightWidth = visibleWidth(truncatedRight);
				const padding = " ".repeat(Math.max(0, width - statsLeftWidth - truncatedRightWidth));
				styledRight = theme.fg("muted", truncatedRight);
				statsLine = statsLeft + padding + styledRight;
			} else {
				statsLine = statsLeft;
			}
		}

		const { pwdLine, pwdLeft, pwdRight } = this.getTodosVisible
			? formatFooterPwdRowWithTodosChip(
					metaSegments.join(metaDot),
					width,
					minPadding,
					this.getTodosVisible(),
					truncateToWidth,
				)
			: {
					pwdLine: truncateToWidth(metaSegments.join(metaDot), width, theme.fg("dim", "…")),
					pwdLeft: "",
					pwdRight: "",
				};
		const lines = [pwdLine, statsLine];

		const extensionStatuses = this.footerData.getExtensionStatuses();
		if (extensionStatuses.size > 0) {
			const sortedStatuses = Array.from(extensionStatuses.entries())
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([, text]) => sanitizeStatusText(text))
				.filter(Boolean);
			if (sortedStatuses.length > 0) {
				const statusLine = `${theme.fg("borderMuted", "│ ")}${sortedStatuses.join(metaDot)}`;
				lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "…")));
			}
		}

		return { lines, statsLeft, statsRight: styledRight, ...(pwdRight ? { pwdLeft, pwdRight } : {}) };
	}
}
