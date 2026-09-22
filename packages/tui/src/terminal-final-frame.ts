import type { Terminal } from "./terminal.ts";

export function finishTerminalFrame(terminal: Terminal, contentRows: number, hardwareCursorRow: number): void {
	if (contentRows > 0) {
		// Never overwrite a transcript character while clearing cursor-cell attributes.
		terminal.write("\x1b[0m");
		const lineDiff = contentRows - hardwareCursorRow;
		if (lineDiff > 0) terminal.write(`\x1b[${lineDiff}B`);
		else if (lineDiff < 0) terminal.write(`\x1b[${-lineDiff}A`);
		terminal.write("\r\n");
	}
	terminal.showCursor();
	terminal.stop();
}
