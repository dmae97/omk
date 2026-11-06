import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

type RailOptions = {
	pane: string;
	runTmux?: (args: string[]) => string;
	onClose?: () => void;
};

/** Owns only the pane it creates; failure leaves the in-process rail available. */
export class TmuxStatusRail {
	private readonly render: (columns: number, rows: number) => string[];
	private readonly options: RailOptions;
	private pane: string | undefined;
	private directory: string | undefined;
	private timer: ReturnType<typeof setInterval> | undefined;
	private disposed = false;
	private startedAt = 0;
	private previousFrame = "";

	constructor(render: (columns: number, rows: number) => string[], options: RailOptions) {
		this.render = render;
		this.options = options;
	}

	get active(): boolean {
		return this.pane !== undefined;
	}
	get framePath(): string | undefined {
		return this.directory ? join(this.directory, "frame.json") : undefined;
	}

	private run(args: string[]): string {
		return this.options.runTmux
			? this.options.runTmux(args)
			: execFileSync("tmux", args, { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "pipe"] });
	}

	start(): boolean {
		if (this.disposed || !/^%\d+$/.test(this.options.pane)) return false;
		if (this.active) return true;
		if (process.stdout.columns && process.stdout.columns < 114) return false;
		try {
			this.directory = mkdtempSync(join(tmpdir(), "omk-status-rail-"));
			const suffix = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
			const viewer = fileURLToPath(new URL(`./status-pane-viewer${suffix}`, import.meta.url));
			const argv = [process.execPath, ...process.execArgv, viewer, this.directory, String(process.pid)];
			const command = `exec ${argv.map((arg) => `'${arg.replace(/'/g, `'\\''`)}'`).join(" ")}`;
			const pane = this.run([
				"split-window",
				"-d",
				"-h",
				"-l",
				"40",
				"-t",
				this.options.pane,
				"-P",
				"-F",
				"#{pane_id}",
				command,
			]).trim();
			if (!/^%\d+$/.test(pane) || pane === this.options.pane) throw new Error("Invalid status pane");
			this.pane = pane;
			this.startedAt = performance.now();
			this.publish();
			if (!this.active) return false;
			this.timer = setInterval(() => this.publish(), 1000);
			this.timer.unref();
			return true;
		} catch {
			this.stop();
			return false;
		}
	}

	private publish(): void {
		if (!this.directory) return;
		try {
			let columns = 40;
			let rows = 32;
			try {
				const size = JSON.parse(readFileSync(join(this.directory, "size.json"), "utf8"));
				if (Number.isInteger(size.columns) && size.columns >= 10 && size.columns <= 1000) columns = size.columns;
				if (Number.isInteger(size.rows) && size.rows >= 3 && size.rows <= 1000) rows = size.rows;
				// wall-clock: heartbeat timestamp supplied by the separate viewer process.
				if (!Number.isFinite(size.at) || Date.now() - size.at > 6000) {
					this.stop();
					return;
				}
			} catch {
				if (performance.now() - this.startedAt > 10000) {
					this.stop();
					return;
				}
			}
			if (process.stdout.columns && process.stdout.columns + columns < 112) {
				this.stop();
				return;
			}
			if (columns < 33 && this.pane) this.run(["resize-pane", "-t", this.pane, "-x", "40"]);
			const frame = JSON.stringify({ lines: this.render(columns, rows), columns });
			if (frame === this.previousFrame) return;
			writeFileSync(join(this.directory, "frame.next"), frame, { mode: 0o600 });
			renameSync(join(this.directory, "frame.next"), join(this.directory, "frame.json"));
			this.previousFrame = frame;
		} catch {
			this.stop();
		}
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
		const pane = this.pane;
		this.pane = undefined;
		if (pane) {
			try {
				this.run(["kill-pane", "-t", pane]);
			} catch {
				/* Already closed by tmux. */
			}
		}
		if (this.directory) rmSync(this.directory, { recursive: true, force: true });
		this.directory = undefined;
		this.previousFrame = "";
		if (pane) this.options.onClose?.();
	}

	dispose(): void {
		this.disposed = true;
		this.stop();
	}
}
