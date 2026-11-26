import { type Component, truncateToWidth, visibleWidth } from "omk-tui";
import type { AgentSession } from "../../../core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.ts";
import { resolveHerdrConfig } from "../../../core/herdr-client.ts";
import { singleLineDisplayText } from "../../../utils/display-text.ts";
import { readControlPlaneSignals } from "../control-plane-signals.ts";
import {
	authorityStyle,
	authorityText,
	buildControlPlaneViewModel,
	type UiAuthorityState,
} from "../control-plane-view-model.ts";
import { theme } from "../theme/theme.ts";
import { formatCwdForFooter, formatTokens } from "./footer.ts";

export interface OmkStatusHeaderSnapshot {
	readonly version: string;
	readonly modelLabel: string;
	readonly thinkingLevel: string;
	readonly runState: UiAuthorityState;
	readonly runLabel: string;
	readonly verifyState: UiAuthorityState;
	readonly verifyLabel: string;
	readonly contextPercent: number | null;
	readonly contextWindowTokens: number;
	readonly cwdLabel: string;
	readonly gitBranch: string | null;
	readonly planBadge: string | undefined;
	readonly mcpReady: number;
	readonly mcpTotal: number;
	readonly herdrActive: boolean;
	readonly filesSidebarMode?: "open" | "collapsed" | "hidden";
}

const ANSI_SGR_RE = /\x1b\[[0-9;]*m/g;
const stripSgr = (value: string) => value.replace(ANSI_SGR_RE, "");

function floorPct(percent: number): string {
	return (Math.floor(percent * 10) / 10).toFixed(1);
}

function fitText(text: string, maxWidth: number): string {
	if (maxWidth <= 0) return "";
	return visibleWidth(text) <= maxWidth ? text : truncateToWidth(text, maxWidth, "…");
}

function hairlineRule(width: number, leftCorner: string, rightCorner: string, left: string, right = ""): string {
	if (width <= 2) return fitText(`${leftCorner}${rightCorner}`, width);
	const inner = width - 2;
	const dash = theme.fg("borderMuted", "─");
	const leftPart = left ? `${dash} ${left} ` : "";
	const rightPart = right ? ` ${right} ${dash}` : "";
	const lw = visibleWidth(leftPart);
	const rw = visibleWidth(rightPart);
	if (lw + rw <= inner) {
		const fill = "─".repeat(inner - lw - rw);
		return `${theme.fg("borderMuted", leftCorner)}${leftPart}${theme.fg("borderMuted", fill)}${rightPart}${theme.fg("borderMuted", rightCorner)}`;
	}
	const clippedLeft = fitText(leftPart, inner);
	const pad = "─".repeat(Math.max(0, inner - visibleWidth(clippedLeft)));
	return `${theme.fg("borderMuted", leftCorner)}${clippedLeft}${theme.fg("borderMuted", pad)}${theme.fg("borderMuted", rightCorner)}`;
}

function bodyRow(width: number, left: string, right = ""): string {
	const inner = Math.max(0, width - 4);
	const pipe = theme.fg("borderMuted", "│");
	if (right) {
		const rw = visibleWidth(right);
		if (rw + 2 <= inner) {
			const clippedLeft = fitText(left, inner - rw - 2);
			const gap = " ".repeat(Math.max(1, inner - visibleWidth(clippedLeft) - rw));
			return `${pipe} ${clippedLeft}${gap}${right} ${pipe}`;
		}
	}
	const clipped = fitText(left, inner);
	const pad = " ".repeat(Math.max(0, inner - visibleWidth(clipped)));
	return `${pipe} ${clipped}${pad} ${pipe}`;
}

export function renderOmkStatusHeader(snapshot: OmkStatusHeaderSnapshot, width: number): string[] {
	if (width <= 4) return [];
	const s = singleLineDisplayText;
	const dot = theme.fg("dim", " · ");
	const version = s(snapshot.version || "0.0.0");
	const model = s(snapshot.modelLabel || "no-model");
	const think = s(snapshot.thinkingLevel || "off");
	const modelWithThink = think && think !== "off" ? `${model}:${think}` : model;
	const runStyle = authorityStyle(snapshot.runState);
	const verifyStyle = authorityStyle(snapshot.verifyState);
	const runToken = theme.fg(runStyle.color, `${runStyle.glyph} ${s(snapshot.runLabel)}`);
	const verifyToken = theme.fg(verifyStyle.color, `${verifyStyle.glyph} ${s(snapshot.verifyLabel).toUpperCase()}`);
	const planClean = snapshot.planBadge ? s(stripSgr(snapshot.planBadge)) : undefined;
	const git = snapshot.gitBranch ? s(snapshot.gitBranch) : undefined;
	const cwd = s(snapshot.cwdLabel || "~");

	const filesChip =
		snapshot.filesSidebarMode === "open"
			? `${theme.fg("muted", "◧ Files ◂")}  `
			: snapshot.filesSidebarMode === "collapsed"
				? `${theme.fg("dim", "◧ Files ▸")}  `
				: "";
	const title = `${filesChip}${theme.fg("accent", "◉")} ${theme.bold(theme.fg("text", "OMK · STATUS"))}`;
	if (width < 88) {
		const rightTop = theme.fg("dim", `v${version}`);
		const segs = [theme.fg("text", modelWithThink), runToken];
		if (git) segs.push(`${theme.fg("dim", "git:")}${theme.fg("muted", git)}`);
		if (planClean) segs.push(theme.fg("accent", planClean));
		return [
			hairlineRule(width, "┌", "┐", title, rightTop),
			bodyRow(width, segs.join(dot)),
			hairlineRule(width, "└", "┘", theme.fg("dim", "/plan · /branch · /resume")),
		];
	}

	const ctxPct = snapshot.contextPercent === null ? "?" : `${floorPct(snapshot.contextPercent)}%`;
	const ctxWin = snapshot.contextWindowTokens > 0 ? formatTokens(snapshot.contextWindowTokens) : "?";
	const ctxColor =
		snapshot.contextPercent !== null && snapshot.contextPercent >= 90
			? "error"
			: snapshot.contextPercent !== null && snapshot.contextPercent >= 70
				? "warning"
				: "text";

	const topRight = `${theme.fg("dim", `v${version}`)}${dot}${theme.fg("dim", "VERIFY")} ${verifyToken}`;
	const row1 = [
		`${theme.fg("dim", "MODEL")} ${theme.fg("text", modelWithThink)}`,
		`${theme.fg("dim", "RUN")} ${runToken}`,
		`${theme.fg("dim", "CTX")} ${theme.fg(ctxColor, `${ctxPct}/${ctxWin}`)}`,
	].join(dot);

	const row2Left = [
		git ? `${theme.fg("dim", "GIT")} ${theme.fg("text", git)}` : "",
		snapshot.mcpTotal > 0
			? `${theme.fg("dim", "MCP")} ${theme.fg("muted", `${snapshot.mcpReady}/${snapshot.mcpTotal}`)}`
			: "",
		theme.fg("muted", cwd),
	]
		.filter(Boolean)
		.join(dot);

	const row2RightParts: string[] = [];
	if (planClean) row2RightParts.push(theme.fg(planClean.includes("(ro)") ? "warning" : "accent", planClean));
	if (snapshot.herdrActive) row2RightParts.push(theme.fg("dim", "HERDR"));
	const hints = theme.fg(
		"dim",
		snapshot.filesSidebarMode
			? "/plan · /branch · /files · ctrl+b files · ctrl+o details · ctrl+q rail"
			: "/plan · /branch · /resume · ctrl+o details · ctrl+q rail",
	);

	return [
		hairlineRule(width, "┌", "┐", title, topRight),
		bodyRow(width, row1),
		bodyRow(width, row2Left, row2RightParts.join(dot)),
		hairlineRule(width, "└", "┘", hints),
	];
}

export class OmkStatusHeaderComponent implements Component {
	private readonly readSnapshot: () => OmkStatusHeaderSnapshot;
	private readonly isInViewport: () => boolean;
	private cached: { width: number; lines: string[] } | undefined;

	constructor(readSnapshot: () => OmkStatusHeaderSnapshot, isInViewport: () => boolean = () => true) {
		this.readSnapshot = readSnapshot;
		this.isInViewport = isInViewport;
	}

	invalidate(): void {
		this.cached = undefined;
	}

	render(width: number): string[] {
		if (!this.isInViewport() && this.cached && this.cached.width === width) {
			return this.cached.lines;
		}
		const lines = renderOmkStatusHeader(this.readSnapshot(), width);
		this.cached = { width, lines };
		return lines;
	}
}

export function createOmkStatusHeader(
	version: string,
	getSession: () => AgentSession,
	footerData: ReadonlyFooterDataProvider,
	isInViewport: () => boolean,
	getFilesSidebarMode?: () => "open" | "collapsed" | "hidden",
): OmkStatusHeaderComponent {
	return new OmkStatusHeaderComponent(() => {
		const session = getSession();
		const model = session.state.model;
		const signals = readControlPlaneSignals(session, footerData, model?.contextWindow ?? 0);
		const vm = buildControlPlaneViewModel(signals);
		const mcpStatuses = session.mcpServerStatus();
		const mcpReady = mcpStatuses.filter((item) => item.state === "ready").length;
		const modelLabel = model ? (model.provider ? `${model.provider}/${model.id}` : model.id) : "no-model";
		return {
			version,
			modelLabel,
			thinkingLevel: session.state.thinkingLevel ?? "off",
			runState: vm.run.state,
			runLabel: authorityText(vm.run).replace(/^[^\s]+\s+/, ""),
			verifyState: vm.verify.state,
			verifyLabel: authorityText(vm.verify).replace(/^[^\s]+\s+/, ""),
			contextPercent: vm.context.percent,
			contextWindowTokens: vm.context.windowTokens,
			cwdLabel: formatCwdForFooter(session.sessionManager.getCwd(), process.env.HOME || process.env.USERPROFILE),
			gitBranch: footerData.getGitBranch(),
			planBadge: footerData.getExtensionStatuses().get("plan"),
			mcpReady,
			mcpTotal: mcpStatuses.length,
			herdrActive: resolveHerdrConfig() !== undefined,
			filesSidebarMode: getFilesSidebarMode?.(),
		};
	}, isInViewport);
}
