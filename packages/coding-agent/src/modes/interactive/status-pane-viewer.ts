import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { truncateToWidth } from "omk-tui";

const directory = process.argv[2];
const owner = Number(process.argv[3]);
if (!directory || !Number.isSafeInteger(owner) || owner <= 0) process.exit(1);
let offset = 0;
let previous = "";
let lineCount = 0;

function paint(): void {
	try {
		process.kill(owner, 0);
	} catch {
		finish();
		return;
	}
	const columns = Math.max(10, (process.stdout.columns || 40) - 1);
	const rows = Math.max(3, process.stdout.rows || 32);
	try {
		// wall-clock: cross-process heartbeat, not an elapsed work deadline.
		writeFileSync(join(directory, "size.next"), JSON.stringify({ columns, rows, at: Date.now() }), { mode: 0o600 });
		renameSync(join(directory, "size.next"), join(directory, "size.json"));
		const frame: unknown = JSON.parse(readFileSync(join(directory, "frame.json"), "utf8"));
		if (!frame || typeof frame !== "object" || !("lines" in frame) || !Array.isArray(frame.lines)) return;
		const lines = frame.lines.filter((line): line is string => typeof line === "string");
		lineCount = lines.length;
		offset = Math.max(0, Math.min(offset, lines.length - rows + 1));
		const footer =
			lines.length > rows - 1
				? ` PgUp/PgDn  ${offset + 1}-${Math.min(lines.length, offset + rows - 1)}/${lines.length}`
				: " Ctrl+Q  hide status";
		const output = [...lines.slice(offset, offset + rows - 1), `\x1b[2m${footer}\x1b[0m`]
			.map((line) => `${truncateToWidth(line, columns, "")}\x1b[0m\x1b[K`)
			.join("\r\n");
		if (output === previous) return;
		previous = output;
		process.stdout.write(`\x1b[H${output}\x1b[J`);
	} catch (error) {
		if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") finish();
	}
}

function finish(): void {
	clearInterval(timer);
	if (process.stdin.isTTY) process.stdin.setRawMode(false);
	process.stdout.write("\x1b[0m\x1b[?25h\x1b[?1049l");
	process.exit(0);
}

process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[2J");
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on("data", (data: Buffer) => {
	const key = data.toString();
	const page = Math.max(1, (process.stdout.rows || 32) - 3);
	if (key === "\x1b[5~" || key === "k" || key === "\x1b[A") offset -= key === "\x1b[5~" ? page : 1;
	if (key === "\x1b[6~" || key === "j" || key === "\x1b[B") offset += key === "\x1b[6~" ? page : 1;
	if (key === "g" || key === "\x1b[H") offset = 0;
	if (key === "G" || key === "\x1b[F") offset = lineCount;
	paint();
});
process.on("SIGTERM", finish);
process.on("SIGINT", finish);
process.stdout.on("resize", () => {
	previous = "";
	paint();
});
const timer = setInterval(paint, 500);
paint();
