import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/omk-tui";
import type { AgentSession } from "../../../core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.ts";
import { buildOmkControlDecision, buildOmkControlSurface } from "../../../core/omk-control.ts";
import { theme } from "../theme/theme.ts";
import type { OmkControlDashboardActivity } from "./omk-control-dashboard.ts";

const MIN_HUD_WIDTH = 18;
const DEFAULT_ROWS = 0;

function clampRows(rows: number): number {
	if (!Number.isFinite(rows) || rows < 0) return DEFAULT_ROWS;
	return Math.min(Math.floor(rows), 8);
}

function fitToWidth(text: string, width: number): string {
	if (width <= 0) return "";
	const clipped = visibleWidth(text) > width ? truncateToWidth(text, width, "") : text;
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function frameLine(content: string, width: number): string {
	if (width < MIN_HUD_WIDTH) return fitToWidth(content, width);
	const innerWidth = Math.max(0, width - 2);
	return `${theme.fg("borderAccent", "│")}${fitToWidth(content, innerWidth)}${theme.fg("borderAccent", "│")}`;
}

function borderLine(width: number, title: string, bottom = false): string {
	if (width < MIN_HUD_WIDTH) return fitToWidth(title, width);
	const left = bottom ? "╰" : "╭";
	const right = bottom ? "╯" : "╮";
	const label = bottom ? "" : ` ${title} `;
	const fillWidth = Math.max(0, width - visibleWidth(left + right) - visibleWidth(label));
	return theme.gradient("accent", "borderAccent", `${left}${label}${"─".repeat(fillWidth)}${right}`);
}

export interface OmkNeonHudOptions {
	getRows: () => number;
	getActivity?: () => OmkControlDashboardActivity;
}

export class OmkNeonHudComponent implements Component {
	private session: AgentSession;
	private footerData: ReadonlyFooterDataProvider;
	private getRows: () => number;
	private getActivity: () => OmkControlDashboardActivity;

	constructor(session: AgentSession, footerData: ReadonlyFooterDataProvider, options: OmkNeonHudOptions) {
		this.session = session;
		this.footerData = footerData;
		this.getRows = options.getRows;
		this.getActivity = options.getActivity ?? (() => ({ label: "ready", detail: "awaiting route" }));
	}

	setSession(session: AgentSession): void {
		this.session = session;
	}

	invalidate(): void {
		// Reads live session/footer state on every render.
	}

	render(width: number): string[] {
		const rows = clampRows(this.getRows());
		if (rows <= 0) return [];

		const w = Math.max(1, width);
		const activity = this.getActivity();
		const surface = buildOmkControlSurface(activity.detail ?? activity.label);
		const decision = buildOmkControlDecision(activity.detail ?? activity.label, "coordinator");
		const model = this.session.state.model;
		const modelText = model ? `${model.provider}/${model.id}` : "no-model";
		const thinkingText = model?.reasoning ? this.session.state.thinkingLevel || "off" : "off";
		const statuses = Array.from(this.footerData.getExtensionStatuses().entries());
		const gridText = statuses.find(([key]) => key === "omk")?.[1] ?? surface.compactStatus;

		const lines = [
			borderLine(w, "OMK://NEON HUD"),
			frameLine(
				`${theme.fg("success", "ROUTE")} ${theme.fg("text", decision.intent)} ${theme.fg("dim", "│")} ${theme.fg("accent", "RISK")} ${theme.fg("text", decision.risk)} ${theme.fg("dim", "│")} ${theme.fg("warning", "EVIDENCE")} ${theme.fg("text", decision.evidenceRequired ? "required" : "optional")}`,
				w,
			),
			frameLine(
				`${theme.fg("accent", "MODEL")} ${theme.fg("text", modelText)} ${theme.fg("dim", "│")} ${theme.fg("borderAccent", "THINK")} ${theme.fg("text", thinkingText)}`,
				w,
			),
			frameLine(
				`${theme.fg("success", "GRID")} ${theme.fg("muted", gridText)} ${theme.fg("dim", "│")} ${theme.fg("accent", "CAPS")} ${theme.fg("text", decision.capabilities.join("+"))}`,
				w,
			),
			borderLine(w, "", true),
		];

		while (lines.length < rows) {
			lines.splice(
				lines.length - 1,
				0,
				frameLine(theme.fg("dim", "▒░ 0 1 matrix rain · route · verify · loop · control 1 0 ░▒"), w),
			);
		}

		return lines.slice(0, rows).map((line) => fitToWidth(line, w));
	}
}
