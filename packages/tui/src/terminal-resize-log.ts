import { appendFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

/**
 * `OMK_TUI_RESIZE_LOG=<path>`: one JSON line per terminal resize, so a capture
 * of omk's terminal output can be replayed with resizes at exact byte offsets
 * (tmux `pipe-pane` file sizes lag by several KB).
 *
 * Resize line, written when omk handles the resize event, before it renders:
 *   {"bytes":N,"cols":C,"rows":R,"t":T,"prevCols":PC,"prevRows":PR}
 * Final line, written on terminal stop (TUI stop, including SIGINT/SIGTERM
 * paths that stop the TUI), and on process exit if no final line with the same
 * byte count was written yet (exits that skip stop, e.g. a dead tty's EIO):
 *   {"final":true,"bytes":N}
 *
 * `bytes` is the cumulative UTF-8 length of everything omk handed to stdout
 * through its terminal writer so far, counted at the write() call: omk-side
 * bytes, not pty bytes (no ONLCR `\n` → `\r\n` correction). It is an upper
 * bound on where the resize hit the byte stream (written bytes the terminal had
 * not read yet may be processed at the new size); the external pipe-pane
 * offset is the lower bound. `t` is `performance.now()` in ms.
 *
 * Lines are appended synchronously so they land before exit. Write errors are
 * ignored (debug output, best-effort). Unset: no log object exists and the
 * resize handler is not wrapped (TerminalOutput.withResizeLog).
 *
 * Node emits `resize` only when the tty size actually changed, so the SIGWINCH
 * omk sends itself on start (stale size after suspend) logs a line only if the
 * size changed while omk was stopped; there are no same-size lines. A
 * suspend/resume cycle (external editor) writes a final line per stop, so
 * readers take the last final line.
 */
export class TerminalResizeLog {
	private readonly path: string;

	constructor(path: string) {
		this.path = path;
	}

	resize(bytes: number, cols: number, rows: number, prevCols: number, prevRows: number): void {
		this.append({ bytes, cols, rows, t: performance.now(), prevCols, prevRows });
	}

	private finalBytes = -1;

	/** Skipped when the previous final line already has these bytes (stop, then exit). */
	final(bytes: number): void {
		if (bytes === this.finalBytes) return;
		this.finalBytes = bytes;
		this.append({ final: true, bytes });
	}

	private append(record: Record<string, unknown>): void {
		try {
			appendFileSync(this.path, `${JSON.stringify(record)}\n`, { encoding: "utf8" });
		} catch {
			/* Best-effort debug log. */
		}
	}
}
