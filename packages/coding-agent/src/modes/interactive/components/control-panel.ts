import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/omk-tui";
import { type ThemeColor, theme } from "../theme/theme.ts";

const CONTROL_PANEL_ASCII = [
	"  ____   __  __ _  __",
	" / __ \\ /  |/  / |/ /",
	"/ /_/ // /|_/ /    < ",
	"\\____//_/  /_/_/|_| ",
];

export interface ControlPanelContent {
	appName: string;
	version: string;
	compactInstructions: () => string;
	expandedInstructions: () => string;
	compactOnboarding: () => string;
	onboarding: () => string;
}

/**
 * Built-in startup header with ANSI-colored ASCII branding and compact/expanded
 * control-panel layouts. Content is provided as callbacks so theme changes can
 * rebuild styled strings without retaining stale ANSI sequences.
 */
export class ControlPanelComponent implements Component {
	private expanded = false;
	private readonly content: ControlPanelContent;

	constructor(content: ControlPanelContent) {
		this.content = content;
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
	}

	invalidate(): void {
		// Stateless render: content callbacks are evaluated on each render so theme
		// changes automatically take effect.
	}

	render(width: number): string[] {
		if (width <= 0) {
			return [];
		}

		return this.expanded ? this.renderExpanded(width) : this.renderCompact(width);
	}

	private renderCompact(width: number): string[] {
		return [
			this.divider(width, "OMK//CONTROL PANEL", "accent"),
			this.statusLine(width),
			this.textLine(width, this.content.compactInstructions()),
			this.textLine(width, this.content.compactOnboarding(), "dim"),
		];
	}

	private renderExpanded(width: number): string[] {
		const lines = [this.divider(width, "OMK//CONTROL PANEL", "accent"), this.statusLine(width)];

		if (width >= 32) {
			for (const logoLine of CONTROL_PANEL_ASCII) {
				lines.push(this.textLine(width, theme.fg("accent", logoLine)));
			}
		}

		lines.push(this.divider(width, "SYSTEM MAP", "mdHeading"));
		for (const instruction of this.content.expandedInstructions().split("\n")) {
			lines.push(this.textLine(width, instruction));
		}
		lines.push(this.divider(width, "CONTROL LINK", "success"));
		for (const onboardingLine of this.content.onboarding().split("\n")) {
			lines.push(this.textLine(width, onboardingLine, "dim"));
		}
		lines.push(this.divider(width, "END", "borderMuted"));

		return lines;
	}

	private statusLine(width: number): string {
		const app = this.content.appName.toUpperCase();
		const segments = [
			theme.bold(theme.fg("accent", `${app} v${this.content.version}`)),
			theme.fg("success", "CORE:READY"),
			theme.fg("mdCode", "ANSI:ON"),
			theme.fg("warning", "ASCII:ARMED"),
			theme.fg("muted", "THEME:LIVE"),
		];
		return this.textLine(width, segments.join(theme.fg("borderMuted", " | ")));
	}

	private divider(width: number, label: string, color: ThemeColor): string {
		const prefix = theme.fg("border", "+-- ");
		const coloredLabel = theme.bold(theme.fg(color, label));
		const visiblePrefix = visibleWidth("+-- ");
		const labelWidth = visibleWidth(label);
		const fillWidth = Math.max(0, width - visiblePrefix - labelWidth - 1);
		return this.clipLine(`${prefix}${coloredLabel}${theme.fg("border", ` ${"-".repeat(fillWidth)}`)}`, width);
	}

	private textLine(width: number, text: string, color?: ThemeColor): string {
		const prefix = theme.fg("borderMuted", "| ");
		const body = color ? theme.fg(color, text) : text;
		return this.clipLine(`${prefix}${body}`, width);
	}

	private clipLine(line: string, width: number): string {
		if (visibleWidth(line) <= width) {
			return line;
		}
		return truncateToWidth(line, width, "");
	}
}
