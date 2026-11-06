import type { OpenTui, OpenTuiCapturedLine, OpenTuiNode, OpenTuiRenderer } from "./opentui-core.ts";
import type { StatusPanelModel } from "./status-panel-model.ts";

/** OpenTUI owns layout and its memory framebuffer. It never writes the host terminal. */
export function buildStatusScene(
	openTui: OpenTui,
	renderer: OpenTuiRenderer,
	model: StatusPanelModel,
	width: number,
	height: number,
): OpenTuiNode {
	const { BoxRenderable, TextRenderable } = openTui;
	const p = model.palette;
	const root = new BoxRenderable(renderer, {
		width,
		height,
		flexDirection: "column",
		paddingX: 1,
		backgroundColor: p.background,
	});
	let id = 0;
	let usedRows = 0;
	const compact = height <= 22 + model.rows.length + Math.max(1, model.usage.windows.length);
	const text = (content: string, color = p.text, bold = false) =>
		new TextRenderable(renderer, {
			id: `status-${++id}`,
			content,
			fg: color,
			attributes: bold ? openTui.boldAttribute : 0,
			height: 1,
			flexShrink: 0,
			wrapMode: "none",
		});
	const pair = (parent: OpenTuiNode, label: string, value: string, color = p.text) => {
		const row = new BoxRenderable(renderer, {
			height: 1,
			width: "100%",
			flexDirection: "row",
			justifyContent: "space-between",
			columnGap: 1,
			flexShrink: 0,
		});
		const left = text(label, p.muted);
		left.flexShrink = 0;
		left.maxWidth = Math.max(6, width - 12);
		const right = text(value, color);
		right.flexShrink = 1;
		row.add(left);
		row.add(right);
		parent.add(row);
		if (parent === root) usedRows++;
	};
	const blank = () => {
		if (!compact) {
			root.add(text(""));
			usedRows++;
		}
	};
	const heading = (label: string, suffix = "") => {
		blank();
		pair(root, label, suffix, p.muted);
	};
	const meter = (percent: number | null, color: string, label = "") => {
		const cells = Math.max(4, width - 12 - label.length);
		const count = percent === null ? 0 : Math.round((Math.max(0, Math.min(100, percent)) / 100) * cells);
		pair(
			root,
			`${label}${"━".repeat(count)}${"╌".repeat(cells - count)}`,
			percent === null ? "?" : `${Math.floor(percent)}%`,
			color,
		);
	};
	if (compact) {
		root.add(text(model.model, p.text, true));
		const showProvider = height >= model.rows.length + Math.max(1, model.usage.windows.length) + 8;
		if (showProvider) root.add(text(model.provider, p.muted));
		usedRows += showProvider ? 2 : 1;
	} else {
		const header = new BoxRenderable(renderer, {
			width: "100%",
			flexDirection: "column",
			paddingX: 1,
			paddingY: 0,
			border: true,
			borderStyle: "rounded",
			borderColor: p.border,
			backgroundColor: p.surface,
			flexShrink: 0,
		});
		pair(header, "OMK", "Status", p.muted);
		header.add(text(model.model, p.text, true));
		header.add(text(model.provider, p.muted));
		root.add(header);
		usedRows += 5;
	}
	blank();
	for (const row of model.rows) pair(root, row.label, row.value, row.color);
	const system = model.system;
	if (compact && height < usedRows + 10 + Math.max(1, model.usage.windows.length)) {
		const percent = (value: number | null) => (value === null ? "?" : `${Math.floor(value)}%`);
		pair(root, "Host", `CPU ${percent(system.cpuPercent)}  RAM ${percent(system.memoryPercent)}`);
	} else {
		heading("System", "host / all cores");
		meter(system.cpuPercent, system.cpuColor, "CPU ");
		meter(system.memoryPercent, system.memoryColor, "RAM ");
		if (!compact) pair(root, "Memory", system.memoryCaption, p.muted);
	}
	if (compact && height < usedRows + 6 + Math.max(1, model.usage.windows.length)) {
		pair(
			root,
			"Context",
			`${model.context.percent === null ? "?" : `${Math.floor(model.context.percent)}%`} / ${model.context.caption}`,
			model.context.color,
		);
	} else {
		heading("Context", model.context.caption);
		meter(model.context.percent, model.context.color);
	}
	heading("Usage", model.usage.label);
	if (model.usage.windows.length === 0) {
		root.add(text(model.usage.message ?? "unavailable", p.muted));
		usedRows++;
	} else for (const window of model.usage.windows) meter(window.percent, p.text, `${window.label} `);
	let sections = model.sections;
	const headingRows = compact ? 1 : 2;
	const fits = () =>
		sections.reduce((count, section) => count + section.rows.length + headingRows, usedRows + 2) <= height;
	if (!fits())
		sections = sections.map((section) =>
			section.title === "Connections" ? { ...section, rows: section.rows.slice(0, 1) } : section,
		);
	if (!fits()) sections = sections.filter((section) => section.title !== "Session");
	if (!fits()) sections = sections.filter((section) => section.title !== "Runtime");
	if (!fits()) sections = sections.filter((section) => section.title !== "Connections");
	for (const [index, section] of sections.entries()) {
		if (height - usedRows < 5) break;
		const reserved = sections.slice(index + 1).reduce((rows, item) => rows + item.rows.length + headingRows, 2);
		const available = Math.max(1, height - usedRows - reserved - headingRows);
		heading(section.title);
		const shown = section.rows.length > available ? section.rows.slice(0, Math.max(1, available - 1)) : section.rows;
		for (const row of shown) pair(root, row.label, row.value, row.color);
		if (shown.length < section.rows.length && available > 1)
			pair(root, `+${section.rows.length - shown.length} more`, "", p.muted);
	}
	const spacer = new BoxRenderable(renderer, { flexGrow: 1, minHeight: 1 });
	root.add(spacer);
	root.add(text(model.hint, p.muted));
	return root;
}

export function statusSpansToAnsi(lines: readonly OpenTuiCapturedLine[], boldAttribute: number): string[] {
	return lines.map(
		(line) =>
			`${line.spans
				.map((span) => {
					const [r, g, b] = span.fg.toInts();
					const [br, bg, bb, ba] = span.bg.toInts();
					return `\x1b[0m\x1b[38;2;${r};${g};${b}m${ba > 0 ? `\x1b[48;2;${br};${bg};${bb}m` : ""}${span.attributes & boldAttribute ? "\x1b[1m" : ""}${span.text}`;
				})
				.join("")}\x1b[0m`,
	);
}
