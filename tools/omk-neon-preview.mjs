#!/usr/bin/env node

const ESC = "\x1b[";
const csi = (value) => `${ESC}${value}`;
const reset = csi("0m");
const hide = csi("?25l");
const show = csi("?25h");
const clear = csi("2J") + csi("H");

const palette = {
	bg: "#020607",
	cyan: "#00ffd1",
	cyan2: "#00aaff",
	magenta: "#ff2bd6",
	green: "#00ff7f",
	amber: "#ffd166",
	white: "#f4ffff",
	dim: "#26706c",
	dim2: "#123f3f",
	red: "#ff3864",
};

function hexToRgb(hex) {
	const value = hex.replace("#", "");
	return [Number.parseInt(value.slice(0, 2), 16), Number.parseInt(value.slice(2, 4), 16), Number.parseInt(value.slice(4, 6), 16)];
}

function fg(hex) {
	const [r, g, b] = hexToRgb(hex);
	return csi(`38;2;${r};${g};${b}m`);
}

function bg(hex) {
	const [r, g, b] = hexToRgb(hex);
	return csi(`48;2;${r};${g};${b}m`);
}

function move(x, y) {
	return csi(`${y};${x}H`);
}

function writeAt(buf, x, y, text) {
	if (x < 1 || y < 1) return;
	buf.push(move(x, y) + text);
}

function stripAnsi(text) {
	return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}

function visibleLen(text) {
	return [...stripAnsi(text)].length;
}

function fit(text, width) {
	if (width <= 0) return "";
	const plain = [...stripAnsi(text)];
	if (plain.length > width) return plain.slice(0, Math.max(0, width - 1)).join("") + "…";
	return text + " ".repeat(Math.max(0, width - visibleLen(text)));
}

function gradientText(text, colors) {
	const chars = [...text];
	return `${chars
		.map((ch, index) => {
			const color = colors[Math.floor((index / Math.max(1, chars.length - 1)) * (colors.length - 1))];
			return fg(color) + ch;
		})
		.join("")}${reset}`;
}

function box(buf, x, y, w, h, title, color = palette.cyan) {
	if (w < 4 || h < 3) return;
	writeAt(buf, x, y, fg(color) + "╭" + "─".repeat(w - 2) + "╮" + reset);
	for (let row = 1; row < h - 1; row++) writeAt(buf, x, y + row, fg(color) + "│" + " ".repeat(w - 2) + "│" + reset);
	writeAt(buf, x, y + h - 1, fg(color) + "╰" + "─".repeat(w - 2) + "╯" + reset);
	if (title) writeAt(buf, x + 2, y, fg(palette.green) + ` ${title} ` + reset);
}

function bar(width, pct, color) {
	const filled = Math.max(0, Math.min(width, Math.round(width * pct)));
	return fg(color) + "█".repeat(filled) + fg(palette.dim2) + "░".repeat(width - filled) + reset;
}

function drawMatrix(buf, cols, rows, tick) {
	const chars = "010101100101▒░▓";
	for (let x = 1; x <= cols; x += 4) {
		const phase = (x * 7 + tick) % rows;
		for (let k = 0; k < 7; k++) {
			const y = ((phase + k * 3) % rows) + 1;
			const ch = chars[(x + y + tick + k) % chars.length];
			writeAt(buf, x, y, fg(k === 0 ? palette.dim : palette.dim2) + ch + reset);
		}
	}
}

function hero(buf, x, y, maxW) {
	const lines = [
		"█▓▒ OMK://CONTROL ▒▓█",
		"OPEN MULTI - AGENT KIT",
		"ROUTE · VERIFY · LOOP · CONTROL",
		"A neon control plane for coding agents.",
		"Route agents. Verify evidence. Control the loop.",
	];
	writeAt(buf, x, y, gradientText(fit(lines[0], maxW), [palette.white, palette.cyan, palette.magenta]));
	writeAt(buf, x + 2, y + 2, gradientText(fit(lines[1], maxW - 2), [palette.green, palette.cyan, palette.magenta]));
	writeAt(buf, x + 2, y + 4, fg(palette.cyan) + fit(lines[2], maxW - 2) + reset);
	writeAt(buf, x + 2, y + 6, fg(palette.white) + fit(lines[3], maxW - 2) + reset);
	writeAt(buf, x + 2, y + 8, fg(palette.white) + fit(lines[4], maxW - 2) + reset);
}

function drawCardText(buf, x, y, lines) {
	lines.forEach((line, index) => writeAt(buf, x, y + index, line));
}

function render() {
	const cols = process.stdout.columns || 150;
	const rows = process.stdout.rows || 42;
	const buf = [clear + hide + bg(palette.bg)];
	const tick = Math.floor(Date.now() / 250);

	drawMatrix(buf, cols, rows, tick);
	writeAt(buf, 2, 1, fg(palette.cyan) + "⌕  OMK://CONTROL" + reset);
	writeAt(buf, Math.max(2, cols - 28), 1, fg(palette.green) + "● NEON GRID ONLINE" + reset);
	writeAt(buf, 2, 2, fg(palette.dim) + "╰" + "─".repeat(Math.max(20, cols - 4)) + "╮" + reset);

	const rightW = Math.min(44, Math.floor(cols * 0.28));
	const rightX = cols - rightW - 3;
	hero(buf, 8, 6, Math.max(48, cols - rightW - 16));

	const consoleY = Math.max(17, Math.floor(rows * 0.44));
	box(buf, rightX, consoleY, rightW, Math.min(15, rows - consoleY - 5), "CONSOLE", palette.magenta);
	drawCardText(buf, rightX + 3, consoleY + 2, [
		fg(palette.cyan) + "> omk chat" + reset,
		fg(palette.dim) + "> Routing request..." + reset,
		fg(palette.dim) + "> Runtime: mimo / mimo-v2.5-pro" + reset,
		fg(palette.dim) + "> Capabilities: write, workspace-write" + reset,
		"",
		fg(palette.green) + "✓ GRID ARMED" + reset,
		fg(palette.white) + "Evidence gate ready." + reset,
	]);

	const cardY = Math.max(22, rows - 16);
	const gap = 2;
	const cardW = Math.max(28, Math.floor((cols - 8 - gap * 2) / 3));
	box(buf, 3, cardY, cardW, 11, "SYSTEM STATUS", palette.cyan);
	drawCardText(buf, 6, cardY + 2, [
		fg(palette.white) + "CPU     " + bar(14, 0.12, palette.green) + " 12%",
		fg(palette.white) + "MEMORY  " + bar(14, 0.48, palette.cyan) + " 48%",
		fg(palette.white) + "DISK    " + bar(14, 0.52, palette.green) + " 52%",
		"",
		fg(palette.green) + "BCLP LOOP STABLE" + reset,
	]);

	box(buf, 3 + cardW + gap, cardY, cardW, 11, "AGENT GRID", palette.cyan);
	drawCardText(buf, 6 + cardW + gap, cardY + 2, [
		fg(palette.green) + "ROLE      STATUS    EVIDENCE" + reset,
		fg(palette.white) + "Planner   ● active  summary" + reset,
		fg(palette.white) + "Coder     ● active  patch" + reset,
		fg(palette.dim) + "Tester    ○ queued  --" + reset,
		fg(palette.dim) + "Reviewer  ○ queued  --" + reset,
	]);

	box(buf, 3 + (cardW + gap) * 2, cardY, cardW, 11, "LATEST RUN", palette.cyan);
	drawCardText(buf, 6 + (cardW + gap) * 2, cardY + 2, [
		fg(palette.green) + "RUN ID    " + fg(palette.white) + "chat-preview" + reset,
		fg(palette.green) + "TYPE      " + fg(palette.white) + "Chat Session" + reset,
		fg(palette.green) + "HEALTH    " + fg(palette.white) + "OK" + reset,
		"",
		bar(Math.max(10, cardW - 12), 0.35, palette.green),
	]);

	writeAt(buf, Math.floor(cols / 2) - 10, rows, gradientText("OMK://CONTROL", [palette.magenta, palette.cyan, palette.green]));
	buf.push(reset + show);
	process.stdout.write(buf.join(""));
}

process.on("SIGINT", () => {
	process.stdout.write(reset + show + clear);
	process.exit(0);
});

setInterval(render, 250);
render();
