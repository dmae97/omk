#!/usr/bin/env node

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { Chalk } from "chalk";
import gradient from "gradient-string";
import stringWidth from "string-width";

const chalk = new Chalk({ level: 3 });

const CSI = "\x1b[";
const RESET = `${CSI}0m`;

const ansi = {
	altOn: `${CSI}?1049h`,
	altOff: `${CSI}?1049l`,
	hideCursor: `${CSI}?25l`,
	showCursor: `${CSI}?25h`,
	clear: `${CSI}2J${CSI}H`,
};

const C = {
	bg: "#050505",
	cyan: "#00f5ff",
	deepCyan: "#003d4d",
	cyan2: "#16a3ff",
	green: "#39ff9d",
	magenta: "#ff2bd6",
	pink: "#ff4fe3",
	amber: "#fcee09",
	purple: "#8a3ffc",
	white: "#f2ffff",
	dim: "#4e7b72",
	dimCyan: "#2a7772",
};

const __dir = dirname(fileURLToPath(import.meta.url));
const _pkg = JSON.parse(readFileSync(join(__dir, "..", "packages", "coding-agent", "package.json"), "utf-8"));
const VERSION = `v${_pkg.version}`;
const MODEL = process.env.OMK_MODEL ?? "deepseek-v4-pro:max";
const PROVIDER = process.env.OMK_PROVIDER ?? "deepseek";
const CWD = process.env.OMK_CWD ?? "~/projects/benchmark/super-mario-mvp";
const BRANCH = process.env.OMK_BRANCH ?? "main";

function hexToRgb(hex) {
	const value = hex.replace("#", "");
	return [
		Number.parseInt(value.slice(0, 2), 16),
		Number.parseInt(value.slice(2, 4), 16),
		Number.parseInt(value.slice(4, 6), 16),
	];
}

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
	return Math.round(a + (b - a) * t);
}

function paletteAt(colors, t) {
	const safeT = ((t % 1) + 1) % 1;
	const scaled = safeT * (colors.length - 1);
	const index = Math.floor(scaled);
	const next = Math.min(colors.length - 1, index + 1);
	const localT = scaled - index;
	const a = hexToRgb(colors[index]);
	const b = hexToRgb(colors[next]);
	return [lerp(a[0], b[0], localT), lerp(a[1], b[1], localT), lerp(a[2], b[2], localT)];
}

function fg(rgb) {
	return `${CSI}38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

function bg(rgb) {
	return `${CSI}48;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

function stripAnsi(value) {
	return value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

function width(value) {
	return stringWidth(stripAnsi(value));
}

function padRight(value, targetWidth) {
	const pad = Math.max(0, targetWidth - width(value));
	return value + " ".repeat(pad);
}

function center(value, targetWidth) {
	const visible = width(value);
	const left = Math.max(0, Math.floor((targetWidth - visible) / 2));
	const right = Math.max(0, targetWidth - visible - left);
	return " ".repeat(left) + value + " ".repeat(right);
}

function move(x, y) {
	return `${CSI}${y};${x}H`;
}

function paint(value, colors, frame = 0, bold = false) {
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
		const rgb = paletteAt(colors, phase);
		out += `${fg(rgb)}${bold ? `${CSI}1m` : ""}${ch}${RESET}`;
	}
	return out;
}

function sparkleRow(targetWidth, frame, seed) {
	let out = "";
	for (let i = 0; i < targetWidth; i++) {
		const v = (i * 37 + frame * 11 + seed * 19) % 101;
		if (v === 0) out += paint("✦", [C.cyan, C.magenta, C.green], frame + i, true);
		else if (v === 7 || v === 13) out += paint("·", [C.cyan, C.green], frame + i, false);
		else if (v === 29) out += paint("•", [C.amber, C.magenta], frame + i, false);
		else out += " ";
	}
	return out;
}

function box(title, lines, targetWidth, colors, frame) {
	const inner = targetWidth - 4;
	const out = [];
	const titleText = title ? ` ${chalk.hex(C.cyan).bold(title)} ` : "";
	const topRightRun = Math.max(0, targetWidth - 4 - width(titleText));
	const top = paint("╭──", colors, frame, true) + titleText + paint("─".repeat(topRightRun) + "╮", colors, frame + 4, true);
	out.push(top);
	for (let i = 0; i < lines.length; i++) {
		const left = paint("│", colors, frame + i, true);
		const right = paint("│", colors, frame + i + 7, true);
		out.push(`${left} ${padRight(lines[i], inner)} ${right}`);
	}
	out.push(paint("╰" + "─".repeat(targetWidth - 2) + "╯", colors, frame + 11, true));
	return out.join("\n");
}

const WIRE = [
	"        ╭──────────────╮          ╭────────╮        ",
	"        ╰─────╮    ╭───╯       ╭──╯        ╰──╮     ",
	"              ╰────╯        ╭──╯              │     ",
	"        ╭─────╮    ╭───╮    ╰──╮              │     ",
	"        ╰─────╯    ╰───╯       ╰──╮        ╭──╯     ",
	"                                    ╰────────╯        ",
];

function wireLine(line, frame) {
	const chars = [...line];
	const split = Math.floor(chars.length * 0.52);
	const left = chars.slice(0, split).join("");
	const right = chars.slice(split).join("");
	return paint(left, [C.cyan, C.magenta, C.green], frame, true) + paint(right, [C.green, C.amber, C.magenta], frame + 8, true);
}

function makeBrandCard(targetWidth, frame) {
	const inner = targetWidth - 4;
	const routeGradient = gradient([C.cyan, C.green, C.magenta]);
	const modelGradient = gradient([C.green, C.amber, C.magenta]);
	const lines = [
		"",
		center(chalk.hex(C.cyan).bold("OMK"), inner),
		center(chalk.hex(C.dim)("route · verify · loop · control"), inner),
		"",
		sparkleRow(inner, frame, 1),
		...WIRE.map((line) => center(wireLine(line, frame), inner)),
		sparkleRow(inner, frame + 9, 2),
		"",
		center(`${paint("●", [C.magenta, C.green], frame, true)} ${chalk.hex(C.white).bold("OMK")} ${chalk.hex(C.dim)(" / ")}${modelGradient(MODEL)}`, inner),
		center(`${paint("◈", [C.amber, C.magenta], frame, true)} ${chalk.hex(C.white)("omk-control")} ${chalk.hex(C.dim)("· ")}${routeGradient("route · verify · loop")}`, inner),
		"",
	];
	return box(`omk ${VERSION} · OMK//CONTROL`, lines, targetWidth, [C.cyan, C.magenta, C.green], frame);
}

function statusBar(cols, frame) {
	const left =
		chalk.bgHex(C.deepCyan).hex(C.white).bold(" ● OMK ") +
		chalk.bgHex("#0a2a2f").hex(C.green)(` ${PROVIDER}/${MODEL} `) +
		chalk.bgHex("#0a1a1f").hex(C.white)(` ⎇ ${BRANCH} ×40 ?635 `) +
		chalk.bgHex("#142a1f").hex(C.amber)(` 📁 ${CWD} `);
	const right = chalk.bgHex(C.deepCyan).hex(C.white).bold(" 12.2%/272K ↻ ") + chalk.bgHex("#0a2a2f").hex(C.magenta)(" (sub) ");
	const gap = Math.max(1, cols - width(left) - width(right));
	return left + paint("─".repeat(gap), [C.cyan, C.magenta, C.green], frame, true) + right;
}

function promptBox(cols, frame) {
	const targetWidth = Math.max(32, cols - 2);
	const inner = targetWidth - 4;
	const borderColors = [C.cyan, C.magenta, C.green];
	const content = chalk.hex(C.cyan).bold("> ") + chalk.hex(C.dim)("Type your message...");
	return [
		paint("╭" + "─".repeat(targetWidth - 2) + "╮", borderColors, frame, true),
		paint("│", borderColors, frame + 2, true) + " " + padRight(content, inner) + " " + paint("│", borderColors, frame + 7, true),
		paint("╰" + "─".repeat(targetWidth - 2) + "╯", borderColors, frame + 11, true),
	].join("\n");
}

function drawMultiline(out, x, y, text) {
	const lines = text.split("\n");
	for (let i = 0; i < lines.length; i++) out.push(move(x, y + i) + lines[i]);
}

function render(frame) {
	const cols = Math.max(70, process.stdout.columns || 120);
	const rows = Math.max(24, process.stdout.rows || 36);
	const cardWidth = Math.min(96, Math.max(64, cols - 8));
	const card = makeBrandCard(cardWidth, frame);
	const cardLines = card.split("\n");
	const cardX = Math.max(1, Math.floor((cols - cardWidth) / 2) + 1);
	const cardY = Math.max(2, Math.floor((rows - cardLines.length - 6) / 2));
	const out = [ansi.clear];
	drawMultiline(out, cardX, cardY, card);
	out.push(
		move(cardX + 2, cardY + cardLines.length + 1) +
			paint("╰─ ", [C.cyan, C.magenta, C.green], frame, true) +
			chalk.hex(C.dim)("press ") +
			chalk.hex(C.cyan).bold("q") +
			chalk.hex(C.dim)(" or ") +
			chalk.hex(C.cyan).bold("ctrl+c") +
			chalk.hex(C.dim)(" to exit") +
			paint(" ─╯", [C.green, C.magenta, C.cyan], frame + 5, true),
	);
	out.push(move(1, rows - 4) + statusBar(cols, frame));
	drawMultiline(out, 1, rows - 3, promptBox(cols, frame));
	process.stdout.write(out.join(""));
}

let frame = 0;
let timer = null;

function cleanup(exitCode = 0) {
	if (timer) clearInterval(timer);
	process.stdout.write(RESET + ansi.showCursor + ansi.clear + ansi.altOff);
	if (process.stdin.isTTY) {
		process.stdin.setRawMode(false);
		process.stdin.pause();
	}
	process.exit(exitCode);
}

process.stdout.write(ansi.altOn + bg(hexToRgb(C.bg)) + ansi.hideCursor);

if (process.stdin.isTTY) {
	process.stdin.setRawMode(true);
	process.stdin.resume();
	process.stdin.on("data", (chunk) => {
		const value = chunk.toString("utf8");
		if (value === "q" || chunk[0] === 3) cleanup(0);
	});
}

process.on("SIGINT", () => cleanup(0));
process.on("SIGTERM", () => cleanup(0));
process.on("uncaughtException", (error) => {
	process.stdout.write(RESET + ansi.showCursor + ansi.altOff);
	console.error(error);
	process.exit(1);
});

render(frame);
timer = setInterval(() => {
	frame += 1;
	render(frame);
}, 90);
