import type { Component, TUI } from "@earendil-works/omk-tui";
import { Chalk } from "chalk";
import gradient from "gradient-string";
import stringWidth from "string-width";
import { VERSION } from "../../../config.ts";

const chalk = new Chalk({ level: 3 });
const CSI = "\x1b[";
const RESET = `${CSI}0m`;

const C = {
	cyan: "#08d3fa",
	deepCyan: "#003d4d",
	magenta: "#fc6eff",
	pink: "#ff4fe3",
	green: "#08df69",
	amber: "#fcee09",
	purple: "#a55ff6",
	blue: "#06b3f8",
	white: "#f2ffff",
	dim: "#80a3a6",
} as const;

const BRAND_GRADIENT = [C.cyan, C.magenta, C.green] as const;
const BRAND_GRADIENT_ALT = [C.green, C.amber, C.magenta] as const;

const DEFAULT_VERSION = `v${VERSION}`;
const DEFAULT_MODEL = "deepseek-v4-pro:max";
const DEFAULT_PROVIDER = "deepseek";
const DEFAULT_SIGIL = "omk";
const DEFAULT_CWD = "~/projects/benchmark/super-mario-mvp";
const DEFAULT_BRANCH = "main";

export interface OmkBrandSurfaceData {
	version?: string;
	provider?: string;
	model?: string;
	cwd?: string;
	branch?: string;
}

export interface OmkBrandSurfaceOptions {
	getData?: () => OmkBrandSurfaceData;
	frame?: number;
	showStatusBar?: boolean;
	showPrompt?: boolean;
	compact?: boolean;
	ui?: TUI;
	animate?: boolean;
	intervalMs?: number;
	maxFrames?: number;
}

export interface OmkBrandStartupOptions extends OmkBrandSurfaceOptions {
	getCollapsedHint?: () => string;
	getExpandedHelp?: () => string;
	expanded?: boolean;
}

function hexToRgb(hex: string): [number, number, number] {
	const value = hex.replace("#", "");
	return [
		Number.parseInt(value.slice(0, 2), 16),
		Number.parseInt(value.slice(2, 4), 16),
		Number.parseInt(value.slice(4, 6), 16),
	];
}

function lerp(a: number, b: number, t: number): number {
	return Math.round(a + (b - a) * t);
}

function paletteAt(colors: readonly string[], t: number): [number, number, number] {
	const safeT = ((t % 1) + 1) % 1;
	const scaled = safeT * (colors.length - 1);
	const index = Math.floor(scaled);
	const next = Math.min(colors.length - 1, index + 1);
	const localT = scaled - index;
	const a = hexToRgb(colors[index]);
	const b = hexToRgb(colors[next]);
	return [lerp(a[0], b[0], localT), lerp(a[1], b[1], localT), lerp(a[2], b[2], localT)];
}

function fg(rgb: readonly [number, number, number]): string {
	return `${CSI}38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

function stripAnsi(value: string): string {
	return value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

function width(value: string): number {
	return stringWidth(stripAnsi(value));
}

function padRight(value: string, targetWidth: number): string {
	return value + " ".repeat(Math.max(0, targetWidth - width(value)));
}

function center(value: string, targetWidth: number): string {
	const visible = width(value);
	const left = Math.max(0, Math.floor((targetWidth - visible) / 2));
	const right = Math.max(0, targetWidth - visible - left);
	return " ".repeat(left) + value + " ".repeat(right);
}

function centerFit(value: string, targetWidth: number): string {
	return center(width(value) > targetWidth ? clipPlain(value, targetWidth) : value, targetWidth);
}

function clipPlain(value: string, targetWidth: number): string {
	const plain = stripAnsi(value);
	if (stringWidth(plain) <= targetWidth) return value;
	return `${plain.slice(0, Math.max(0, targetWidth - 1))}…`;
}

function paint(value: string, colors: readonly string[], frame = 0, bold = false): string {
	const chars = [...value];
	const span = Math.max(1, chars.length - 1);
	let out = "";
	for (let i = 0; i < chars.length; i++) {
		const ch = chars[i];
		if (ch === " ") {
			out += ch;
			continue;
		}
		const base = i / span;
		const wave = Math.sin((i + frame) * 0.38) * 0.08;
		const phase = base + frame * 0.028 + wave;
		out += `${fg(paletteAt(colors, phase))}${bold ? `${CSI}1m` : ""}${ch}${RESET}`;
	}
	return out;
}

function sparkleRow(targetWidth: number, frame: number, seed: number): string {
	let out = "";
	for (let i = 0; i < targetWidth; i++) {
		const v = (i * 37 + frame * 11 + seed * 19) % 101;
		if (v === 0) out += paint("✦", [C.cyan, C.magenta, C.green], frame + i, true);
		else if (v === 7 || v === 13) out += paint("·", [C.cyan, C.green], frame + i);
		else if (v === 29) out += paint("•", [C.amber, C.magenta], frame + i);
		else out += " ";
	}
	return out;
}

function box(title: string, lines: string[], targetWidth: number, colors: readonly string[], frame: number): string[] {
	const inner = targetWidth - 4;
	const titleText = title ? ` ${chalk.hex(C.cyan).bold(title)} ` : "";
	const topRightRun = Math.max(0, targetWidth - 4 - width(titleText));
	const top =
		paint("╭──", colors, frame, true) + titleText + paint(`${"─".repeat(topRightRun)}╮`, colors, frame + 4, true);
	const out = [top];
	for (let i = 0; i < lines.length; i++) {
		const line = width(lines[i]) > inner ? clipPlain(lines[i], inner) : lines[i];
		out.push(
			`${paint("│", colors, frame + i, true)} ${padRight(line, inner)} ${paint("│", colors, frame + i + 7, true)}`,
		);
	}
	out.push(paint(`╰${"─".repeat(targetWidth - 2)}╯`, colors, frame + 11, true));
	return out;
}

const OMK_WORDMARK = [
	"   ██████╗ ███╗   ███╗██╗  ██╗   ",
	"  ██╔═══██╗████╗ ████║██║ ██╔╝   ",
	"  ██║   ██║██╔████╔██║█████╔╝    ",
	"  ██║   ██║██║╚██╔╝██║██╔═██╗    ",
	"  ╚██████╔╝██║ ╚═╝ ██║██║  ██╗   ",
	"   ╚═════╝ ╚═╝     ╚═╝╚═╝  ╚═╝   ",
] as const;

const FORGE = [
	"        ╭──────────────╮          ╭────────╮        ",
	"        ╰─────╮    ╭───╯       ╭──╯        ╰──╮     ",
	"              ╰────╯        ╭──╯              │     ",
	"        ╭─────╮    ╭───╮    ╰──╮              │     ",
	"        ╰─────╯    ╰───╯       ╰──╮        ╭──╯     ",
	"                                    ╰────────╯        ",
] as const;

function sigilLine(line: string, frame: number, sigil: "omk" | "forge"): string {
	if (sigil === "omk") {
		return paint(line, BRAND_GRADIENT, frame, true);
	}
	const chars = [...line];
	const split = Math.floor(chars.length * 0.52);
	return (
		paint(chars.slice(0, split).join(""), BRAND_GRADIENT, frame, true) +
		paint(chars.slice(split).join(""), BRAND_GRADIENT_ALT, frame + 8, true)
	);
}

function normalizeSigilVariant(value: string | undefined): "omk" | "forge" {
	return value?.trim().toLowerCase() === "forge" ? "forge" : "omk";
}

function resolveSigilLines(compact: boolean): readonly string[] {
	const sigil = normalizeSigilVariant(process.env.OMK_SIGIL ?? DEFAULT_SIGIL);
	if (sigil === "forge") {
		return compact ? FORGE.slice(1, 5) : FORGE;
	}
	return OMK_WORDMARK;
}

function normalizeData(data: OmkBrandSurfaceData): Required<OmkBrandSurfaceData> {
	return {
		version: data.version ?? DEFAULT_VERSION,
		provider: data.provider ?? DEFAULT_PROVIDER,
		model: data.model ?? DEFAULT_MODEL,
		cwd: data.cwd ?? DEFAULT_CWD,
		branch: data.branch ?? DEFAULT_BRANCH,
	};
}

function makeBrandCard(
	targetWidth: number,
	frame: number,
	data: Required<OmkBrandSurfaceData>,
	compact = false,
): string[] {
	const inner = targetWidth - 4;
	const routeGradient = gradient([...BRAND_GRADIENT]);
	const modelGradient = gradient([...BRAND_GRADIENT_ALT]);
	const artLines = resolveSigilLines(compact);
	const sigil = normalizeSigilVariant(process.env.OMK_SIGIL ?? DEFAULT_SIGIL);
	const lines = [
		"",
		centerFit(chalk.hex(C.cyan).bold("OMK"), inner),
		centerFit(chalk.hex(C.dim)("route · verify · loop · control"), inner),
		"",
		sparkleRow(inner, frame, 1),
		...artLines.map((line) => centerFit(sigilLine(line, frame, sigil), inner)),
		sparkleRow(inner, frame + 9, 2),
		"",
		centerFit(
			`${paint("●", [C.magenta, C.green], frame, true)} ${chalk.hex(C.white).bold("OMK")} ${chalk.hex(C.dim)(" / ")}${modelGradient(data.model)}`,
			inner,
		),
		centerFit(
			`${paint("◈", [C.amber, C.magenta], frame, true)} ${chalk.hex(C.white)("omk-control")} ${chalk.hex(C.dim)("· ")}${routeGradient("route · verify · loop")}`,
			inner,
		),
		"",
	];
	return box(`omk ${data.version} · OMK//CONTROL`, lines, targetWidth, BRAND_GRADIENT, frame);
}

function statusBar(targetWidth: number, frame: number, data: Required<OmkBrandSurfaceData>): string {
	const left =
		chalk.bgHex(C.deepCyan).hex(C.white).bold(" ● OMK ") +
		chalk.bgHex("#0a2a2f").hex(C.green)(` ${data.provider}/${data.model} `) +
		chalk.bgHex("#0a1a1f").hex(C.white)(` ⎇ ${data.branch} ×40 ?635 `) +
		chalk.bgHex("#142a1f").hex(C.amber)(` 📁 ${data.cwd} `);
	const right =
		chalk.bgHex(C.deepCyan).hex(C.white).bold(" 12.2%/272K ↻ ") + chalk.bgHex("#0a2a2f").hex(C.magenta)(" (sub) ");
	const clippedLeft = clipPlain(left, Math.max(1, targetWidth - width(right) - 1));
	const gap = Math.max(1, targetWidth - width(clippedLeft) - width(right));
	const line = clippedLeft + paint("─".repeat(gap), BRAND_GRADIENT, frame, true) + right;
	return width(line) > targetWidth ? clipPlain(line, targetWidth) : line;
}

function promptBox(targetWidth: number, frame: number): string[] {
	const inner = targetWidth - 4;
	const content = `${chalk.hex(C.cyan).bold("> ")}${chalk.hex(C.dim)("Type your message...")}`;
	return [
		paint(`╭${"─".repeat(targetWidth - 2)}╮`, BRAND_GRADIENT, frame, true),
		`${paint("│", BRAND_GRADIENT, frame + 2, true)} ${padRight(content, inner)} ${paint("│", BRAND_GRADIENT, frame + 7, true)}`,
		paint(`╰${"─".repeat(targetWidth - 2)}╯`, BRAND_GRADIENT, frame + 11, true),
	];
}

interface BrandAnimationOptions {
	ui?: TUI;
	animate?: boolean;
	intervalMs?: number;
	maxFrames?: number;
	onFrame: () => void;
}

function startBrandAnimation(options: BrandAnimationOptions): NodeJS.Timeout | undefined {
	if (!options.ui || options.animate === false) return undefined;
	const intervalMs = Math.max(60, options.intervalMs ?? 90);
	const maxFrames = Math.max(1, Math.min(options.maxFrames ?? 36, 120));
	let ticks = 0;
	const interval = setInterval(() => {
		options.onFrame();
		options.ui?.requestRender();
		ticks += 1;
		if (ticks >= maxFrames) clearInterval(interval);
	}, intervalMs);
	interval.unref?.();
	return interval;
}

export function renderOmkBrandFrame(
	args: OmkBrandSurfaceData & {
		cols: number;
		frame?: number;
		showStatusBar?: boolean;
		showPrompt?: boolean;
		compact?: boolean;
	},
): string[] {
	const cols = Math.max(40, args.cols);
	const frame = args.frame ?? 0;
	const data = normalizeData(args);
	const minCardWidth = cols >= 72 ? 64 : 32;
	const cardWidth = Math.min(cols, 96, Math.max(minCardWidth, cols - 8));
	const card = makeBrandCard(cardWidth, frame, data, args.compact);
	const leftPad = " ".repeat(Math.max(0, Math.floor((cols - cardWidth) / 2)));
	const lines = card.map((line) => leftPad + line);
	if (args.showStatusBar) {
		lines.push("", statusBar(cols, frame, data));
	}
	if (args.showPrompt) {
		lines.push(...promptBox(Math.max(32, cols - 2), frame).map((line) => ` ${line}`));
	}
	return lines;
}

export class OmkBrandSurfaceComponent implements Component {
	private readonly getData: () => OmkBrandSurfaceData;
	private readonly baseFrame: number;
	private readonly showStatusBar: boolean;
	private readonly showPrompt: boolean;
	private readonly compact: boolean;
	private animFrame = 0;
	private readonly animationTimer: NodeJS.Timeout | undefined;

	constructor(options: OmkBrandSurfaceOptions = {}) {
		this.getData = options.getData ?? (() => ({}));
		this.baseFrame = options.frame ?? 0;
		this.showStatusBar = options.showStatusBar ?? true;
		this.showPrompt = options.showPrompt ?? true;
		this.compact = options.compact ?? false;
		this.animationTimer = startBrandAnimation({
			ui: options.ui,
			animate: options.animate,
			intervalMs: options.intervalMs,
			maxFrames: options.maxFrames,
			onFrame: () => {
				this.animFrame = (this.animFrame + 1) % 65536;
			},
		});
	}

	dispose(): void {
		if (this.animationTimer) clearInterval(this.animationTimer);
	}

	invalidate(): void {
		// Dynamic view: live data and animation frame are read during render.
	}

	render(width: number): string[] {
		return renderOmkBrandFrame({
			...this.getData(),
			cols: width,
			frame: this.baseFrame + this.animFrame,
			showStatusBar: this.showStatusBar,
			showPrompt: this.showPrompt,
			compact: this.compact,
		});
	}
}

export class OmkBrandStartupComponent implements Component {
	private readonly getData: () => OmkBrandSurfaceData;
	private readonly getCollapsedHint: () => string;
	private readonly getExpandedHelp: () => string;
	private expanded: boolean;
	private animFrame = 0;
	private readonly animationTimer: NodeJS.Timeout | undefined;

	constructor(options: OmkBrandStartupOptions = {}) {
		this.getData = options.getData ?? (() => ({}));
		this.getCollapsedHint =
			options.getCollapsedHint ?? (() => "press ctrl+o for controls · /brand for control surface");
		this.getExpandedHelp = options.getExpandedHelp ?? (() => "");
		this.expanded = options.expanded ?? false;
		this.animationTimer = startBrandAnimation({
			ui: options.ui,
			animate: options.animate,
			intervalMs: options.intervalMs,
			maxFrames: options.maxFrames ?? 16,
			onFrame: () => {
				this.animFrame = (this.animFrame + 1) % 65536;
			},
		});
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
	}

	dispose(): void {
		if (this.animationTimer) clearInterval(this.animationTimer);
	}

	invalidate(): void {
		// Dynamic view: live data and animation frame are read during render.
	}

	render(width: number): string[] {
		const lines = renderOmkBrandFrame({
			...this.getData(),
			cols: width,
			frame: this.animFrame,
			showStatusBar: false,
			showPrompt: false,
			compact: true,
		});
		const hint = this.expanded ? this.getExpandedHelp() : this.getCollapsedHint();
		if (hint.trim()) {
			lines.push("", ...hint.split("\n").map((line) => center(chalk.hex(C.dim)(line), width)));
		}
		return lines;
	}
}
