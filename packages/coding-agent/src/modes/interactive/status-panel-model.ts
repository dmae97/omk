import type { AgentSession } from "../../core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../../core/footer-data-provider.ts";
import { getSubscriptionUsageSource, type SubscriptionUsageSnapshot } from "../../core/provider-usage.ts";
import { singleLineDisplayText } from "../../utils/display-text.ts";
import { formatBytes, formatCwdForFooter, formatTokens } from "./components/footer.ts";
import { keyText } from "./components/keybinding-hints.ts";
import { memoryPressureColor, systemMemory } from "./components/status-sidebar-system.ts";
import { readControlPlaneSignals } from "./control-plane-signals.ts";
import { authorityStyle, authorityText, buildControlPlaneViewModel } from "./control-plane-view-model.ts";
import { type RNodePanelInput, rnodeStatusRows } from "./rnode/rnode-panel.ts";
import type { StatusPanelActivitySnapshot } from "./status-panel-activity.ts";
import { getResolvedThemeColors, getThemeExportColors, type ThemeColor } from "./theme/theme.ts";

export type StatusRow = { label: string; value: string; color: string };
export type StatusSection = { title: string; rows: StatusRow[]; meter?: number | null };
export type StatusPanelModel = {
	model: string;
	provider: string;
	path: string;
	rows: StatusRow[];
	context: { percent: number | null; caption: string; color: string };
	usage: { label: string; windows: { label: string; percent: number }[]; message?: string };
	sections: StatusSection[];
	system: {
		cpuPercent: number | null;
		memoryPercent: number | null;
		memoryCaption: string;
		cpuColor: string;
		memoryColor: string;
	};
	palette: { text: string; muted: string; accent: string; border: string; background: string; surface: string };
	hint: string;
	expanded: boolean;
};

/** Project the same authority sources as the native rail; unknown is never promoted to healthy. */
export function statusPanelModel(
	session: AgentSession,
	footer: ReadonlyFooterDataProvider,
	usage: readonly SubscriptionUsageSnapshot[],
	expanded: boolean,
	activity?: StatusPanelActivitySnapshot,
	rnode?: RNodePanelInput,
): StatusPanelModel {
	const colors = getResolvedThemeColors();
	// Keep semantic hues, but lift small terminal copy toward the theme's body text.
	const readable = (color: string) =>
		`#${[1, 3, 5]
			.map((offset) =>
				Math.round(
					Number.parseInt(color.slice(offset, offset + 2), 16) * 0.2 +
						Number.parseInt(colors.text.slice(offset, offset + 2), 16) * 0.8,
				)
					.toString(16)
					.padStart(2, "0"),
			)
			.join("")}`;
	const palette = {
		text: colors.text,
		muted: readable(colors.muted),
		accent: readable(colors.accent),
		border: colors.muted,
		background: getThemeExportColors().pageBg ?? colors.toolPendingBg,
		surface: colors.toolPendingBg,
	};
	const safe = singleLineDisplayText;
	const row = (label: string, value: string, color: ThemeColor = "text"): StatusRow => ({
		label: safe(label),
		value: safe(value),
		color: readable(colors[color]),
	});
	const vm = buildControlPlaneViewModel(
		readControlPlaneSignals(session, footer, session.state.model?.contextWindow ?? 0),
	);
	const memory = systemMemory(footer);
	const processCpu = footer.getCpuPercent();
	const activeModel = session.state.model;
	const active = usage.find((item) => item.label === getSubscriptionUsageSource(activeModel?.provider)?.label);
	const statuses = session.mcpServerStatus();
	const connected = statuses.filter((item) => item.state === "ready").length;
	const rows = [
		row("Run", authorityText(vm.run), authorityStyle(vm.run.state).color),
		row("Verify", authorityText(vm.verify), authorityStyle(vm.verify.state).color),
	];
	if (vm.run.failure) {
		rows.push(
			row("Cause", vm.run.failure.causeCode, "error"),
			row("Retry", `${vm.run.failure.retry} / effects ${vm.run.failure.sideEffects}`, "warning"),
			row("Next", vm.run.failure.nextAction),
		);
	}
	if (activity?.task) {
		const task = activity.task;
		rows.push(
			row(
				"Tasks",
				`${task.done}/${task.total}${task.blocked ? ` / ${task.blocked} blocked` : ""}`,
				task.blocked ? "warning" : "text",
			),
		);
		rows.push(row("Now", task.label));
	}
	if (activity?.tool) {
		const tool = activity.tool;
		rows.push(row("Tool", `${tool.name} ${tool.seconds}s${tool.count > 1 ? ` +${tool.count - 1}` : ""}`));
	}
	let input = 0;
	let output = 0;
	for (const entry of session.sessionManager.getEntries()) {
		if (entry.type === "message" && entry.message.role === "assistant") {
			input += entry.message.usage.input;
			output += entry.message.usage.output;
		}
	}
	const sections: StatusSection[] = [
		{
			title: "Connections",
			rows: [
				row(
					"MCP",
					`${connected}/${statuses.length} ready`,
					statuses.some((item) => item.state === "failed" && item.error !== "disabled by configuration")
						? "warning"
						: "text",
				),
			],
		},
	];
	if (expanded) {
		const detailSections: StatusSection[] = [];
		if (activity) {
			const { skills, checks } = activity;
			detailSections.push({
				title: "Skills",
				rows: [
					row(
						"Selected",
						skills.selected.length
							? `${skills.selected[0]}${skills.selected.length > 1 ? ` +${skills.selected.length - 1}` : ""}`
							: "none selected",
						"muted",
					),
					row(
						"Read/loaded",
						skills.loaded.length
							? `${skills.loaded[0]}${skills.loaded.length > 1 ? ` +${skills.loaded.length - 1}` : ""}`
							: "no body read this prompt",
					),
				],
			});
			detailSections.push({
				title: "Recent checks",
				rows: (["tests", "diagnostics"] as const).map((kind) => {
					const check = checks[kind];
					return row(
						kind === "tests" ? "Tests" : "Diagnostics",
						check ? `${check.text}${check.stale ? " / earlier" : ""}` : "not observed",
						check ? (check.stale ? "warning" : check.state) : "muted",
					);
				}),
			});
		}
		sections[0].rows.push(
			...statuses.map((item) =>
				row(
					safe(item.name),
					item.state === "ready"
						? `${item.toolCount} tools`
						: item.error === "disabled by configuration"
							? "off"
							: item.state,
					item.state === "ready" ? "success" : item.state === "failed" ? "warning" : "muted",
				),
			),
		);
		sections.unshift(...detailSections);
		sections.push({
			title: "Session",
			rows: [
				row("Path", formatCwdForFooter(session.sessionManager.getCwd(), process.env.HOME)),
				row("Branch", footer.getGitBranch() ?? "no branch"),
				row("Tokens", `↑${formatTokens(input)}  ↓${formatTokens(output)}`),
			],
		});
		sections.push({
			title: "Runtime",
			rows: [
				row(
					"CPU (OMK)",
					processCpu === null || !Number.isFinite(processCpu) ? "unavailable" : `${Math.floor(processCpu)}%`,
				),
				row(
					"RSS (OMK)",
					vm.resources.memoryRssBytes === null ? "unavailable" : formatBytes(vm.resources.memoryRssBytes),
				),
				row("Uptime", `${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m`),
			],
		});
	}
	// First, because the renderer trims Session, Runtime and Connections before any other section.
	const rnodeRows = rnodeStatusRows(rnode);
	if (rnodeRows.length > 0) {
		const rows = rnodeRows.map((r) => row(r.label, r.value, r.state ? authorityStyle(r.state).color : "text"));
		sections.unshift({ title: "R·NODE", rows });
	}
	return {
		model: safe(activeModel?.id ?? "No model selected"),
		provider: safe(
			`${activeModel?.provider ?? "unavailable"}${activeModel?.reasoning ? ` / ${session.state.thinkingLevel}` : ""}`,
		),
		path: safe(formatCwdForFooter(session.sessionManager.getCwd(), process.env.HOME)),
		rows,
		context: {
			percent: vm.context.percent,
			caption: `${formatTokens(vm.context.windowTokens)}${session.autoCompactionEnabled ? " / auto compact" : ""}`,
			color: readable(colors[authorityStyle(vm.context.state).color]),
		},
		usage: {
			label: safe(active?.label ?? "Usage"),
			windows: (active?.windows ?? []).map((window) => ({
				label: safe(window.label),
				percent: Math.max(0, Math.min(100, window.usedPercent)),
			})),
			...(active?.message
				? { message: safe(active.message) }
				: active?.windows.length
					? {}
					: { message: "usage unavailable" }),
		},
		sections,
		system: {
			cpuPercent: vm.resources.systemCpuPercent,
			memoryPercent: memory.percent,
			memoryCaption: memory.caption,
			cpuColor: readable(colors[authorityStyle(vm.resources.state).color]),
			memoryColor: readable(colors[memoryPressureColor(memory.percent)]),
		},
		palette,
		hint: `${keyText("app.tools.expand")} ${expanded ? "less" : "details"}   ${keyText("app.sidebar.toggle")} hide`,
		expanded,
	};
}
