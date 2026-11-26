import { type Component, truncateToWidth, visibleWidth } from "omk-tui";
import { singleLineDisplayText } from "../../../utils/display-text.ts";
import { theme } from "../theme/theme.ts";
import type { FilesSidebarModel } from "./files-sidebar-model.ts";
import { renderHairlineRule } from "./paper-hairline.ts";

function padTo(text: string, width: number): string {
	if (width <= 0) return "";
	const clipped = visibleWidth(text) <= width ? text : truncateToWidth(text, width, "…");
	return `${clipped}${" ".repeat(Math.max(0, width - visibleWidth(clipped)))}`;
}

export class FilePreviewDrawerComponent implements Component {
	private readonly model: FilesSidebarModel;
	private readonly getRows: () => number;

	constructor(model: FilesSidebarModel, getRows: () => number) {
		this.model = model;
		this.getRows = getRows;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const preview = this.model.getPreview();
		if (!preview || width < 20) return [];
		const maxDrawerHeight = Math.max(6, Math.min(16, Math.floor(this.getRows() * 0.42)));
		const bodyRows = Math.max(3, maxDrawerHeight - 2);
		const pathLabel = singleLineDisplayText(preview.path);
		const meta = `${preview.size} B${preview.truncated ? ", truncated" : ""}`;
		const leftTitle = `${theme.fg("accent", "▫")} ${theme.bold(theme.fg("text", pathLabel))} ${theme.fg("dim", `(${meta})`)}`;
		const rightHint = theme.fg("dim", "@ insert · Esc close");

		const lines: string[] = [renderHairlineRule(width, "┌", "┐", leftTitle, rightHint)];
		const pipe = theme.fg("borderMuted", "│");
		const inner = Math.max(1, width - 4);

		if (preview.blocked) {
			lines.push(
				`${pipe} ${padTo(theme.fg("warning", "[Protected secret file — preview blocked]"), inner)} ${pipe}`,
			);
		} else if (preview.binary) {
			lines.push(`${pipe} ${padTo(theme.fg("dim", `[Binary file (${preview.size} bytes)]`), inner)} ${pipe}`);
		} else {
			const contentLines = preview.content.split(/\r?\n/);
			const start = this.model.getPreviewScrollOffset();
			const slice = contentLines.slice(start, start + bodyRows);
			const lnWidth = Math.max(3, String(start + slice.length).length);
			for (let i = 0; i < bodyRows; i++) {
				const raw = slice[i];
				if (raw === undefined) {
					lines.push(`${pipe} ${" ".repeat(inner)} ${pipe}`);
					continue;
				}
				const ln = theme.fg("dim", String(start + i + 1).padStart(lnWidth));
				const safeText = singleLineDisplayText(raw.replace(/\t/g, "  "));
				const textBudget = Math.max(1, inner - lnWidth - 2);
				const body = padTo(theme.fg("text", safeText), textBudget);
				lines.push(`${pipe} ${ln}  ${body} ${pipe}`);
			}
		}

		lines.push(renderHairlineRule(width, "└", "┘", theme.fg("dim", "PgUp/PgDn scroll")));
		return lines;
	}
}
