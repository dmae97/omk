/**
 * Overlay surface for terminal-browser inside OMK.
 *
 * Renders kitty unicode placeholders so the terminal composites the real
 * browser pixels at this region, and translates OMK input into bridge input
 * events. The bridge scales cell coordinates to pixels itself — mouse x/y here
 * stay in cell units.
 */

import { type Component, isKeyRelease, matchesKey, type TUI } from "omk-tui";
import type { Theme } from "open-multi-agent-kit";
import type { BridgeState } from "./bridge-protocol.ts";
import { imageColor, MAX_PLACEHOLDER_CELLS, placeholderRow } from "./placeholders.ts";

export type Mods = { shift: boolean; alt: boolean; ctrl: boolean; super: boolean };
export type SurfaceInputEvent =
	| { type: "mouse"; kind: string; button?: string; x: number; y: number; mods: Mods }
	| { type: "key"; key: string; text?: string; mods: Mods }
	| { type: "paste"; text: string }
	| { type: "focus"; focused: boolean };

type SurfaceHooks = {
	getState: () => BridgeState | null;
	post: (path: string, body: unknown) => Promise<unknown>;
	onSized: (cols: number, rows: number) => void;
	onClose: () => void;
};

/** OMK key name → bridge key name. Names the bridge already accepts are omitted. */
const KEY_MAP: Record<string, string> = {
	enter: "enter",
	return: "enter",
	backspace: "backspace",
	delete: "delete",
	tab: "tab",
	up: "up",
	down: "down",
	left: "left",
	right: "right",
	home: "home",
	end: "end",
	pageup: "pageup",
	pagedown: "pagedown",
	insert: "insert",
	escape: "escape",
};

const MODIFIER_PARTS = new Set(["shift", "ctrl", "alt", "super", "meta", "cmd", "win"]);

function modsFromParts(parts: string[]): Mods {
	return {
		shift: parts.includes("shift"),
		alt: parts.includes("alt"),
		ctrl: parts.includes("ctrl"),
		super: parts.includes("super") || parts.includes("meta") || parts.includes("cmd") || parts.includes("win"),
	};
}

function parseSgrMouse(data: string): { code: number; x: number; y: number; press: boolean } | null {
	const match = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(data);
	if (!match) return null;
	return { code: Number(match[1]), x: Number(match[2]), y: Number(match[3]), press: match[4] === "M" };
}

/** Legacy F-key tilde sequences and kitty CSI-u functional codepoints. */
function functionKeyFromSequence(data: string): string | null {
	const tilde = /^\x1b\[(\d+)~$/.exec(data);
	if (tilde) {
		const map: Record<number, string> = {
			11: "f1",
			12: "f2",
			13: "f3",
			14: "f4",
			15: "f5",
			17: "f6",
			18: "f7",
			19: "f8",
			20: "f9",
			21: "f10",
			23: "f11",
			24: "f12",
		};
		return map[Number(tilde[1])] ?? null;
	}
	const csiU = /^\x1b\[(\d+)(?::\d*)?(?::\d+)?(?:;\d+)?(?::\d+)?u$/.exec(data);
	if (csiU) {
		const cp = Number(csiU[1]);
		if (cp >= 57376 && cp <= 57398) return `f${cp - 57375}`;
	}
	return null;
}

export class BrowserSurfaceComponent implements Component {
	private cols = 0;
	private rows = 0;
	private disposed = false;
	private lastSize: { cols: number; rows: number } | null = null;
	private readonly interval: ReturnType<typeof setInterval>;
	private lastRendered: string[] | null = null;
	private readonly tui: TUI;
	private readonly hooks: SurfaceHooks;

	constructor(tui: TUI, _theme: Theme, hooks: SurfaceHooks) {
		this.tui = tui;
		this.hooks = hooks;
		// SGR mouse: button events + drag move (1002), any move (1003), SGR encoding (1006).
		this.tui.terminal.write("\x1b[?1003h\x1b[?1002h\x1b[?1006h");
		this.interval = setInterval(() => {
			this.tui.requestRender();
		}, 250);
		this.interval.unref?.();
		queueMicrotask(() => {
			void this.hooks.post("/input", { events: [{ type: "focus", focused: true }] });
		});
	}

	private post(events: SurfaceInputEvent[]): void {
		if (events.length === 0) return;
		void this.hooks.post("/input", { events });
	}

	private keyEventFromInput(data: string): SurfaceInputEvent | SurfaceInputEvent[] | null {
		const paste = /^\x1b\[200~([\s\S]*?)\x1b\[201~$/.exec(data);
		if (paste) {
			return { type: "paste", text: paste[1] ?? "" };
		}

		if (isKeyRelease(data)) return null; // bridge accepts press events only

		for (const name of Object.keys(KEY_MAP)) {
			const bridgeKey = KEY_MAP[name]!;
			const candidates = [name, `shift+${name}`, `ctrl+${name}`, `alt+${name}`] as const;
			for (const candidate of candidates) {
				if (matchesKey(data, candidate as Parameters<typeof matchesKey>[1])) {
					const mods = modsFromParts(candidate.split("+").filter((p) => MODIFIER_PARTS.has(p)));
					return { type: "key", key: bridgeKey, mods };
				}
			}
		}

		const fn = functionKeyFromSequence(data);
		if (fn) {
			return { type: "key", key: fn, mods: { shift: false, alt: false, ctrl: false, super: false } };
		}

		if (data === " ") {
			return { type: "key", key: " ", text: " ", mods: { shift: false, alt: false, ctrl: false, super: false } };
		}

		if (data.length === 1) {
			const code = data.charCodeAt(0);
			if (code >= 1 && code <= 26) {
				return {
					type: "key",
					key: String.fromCharCode(code + 96),
					mods: { shift: false, alt: false, ctrl: true, super: false },
				};
			}
			if (data === "\x7f") {
				return { type: "key", key: "backspace", mods: { shift: false, alt: false, ctrl: false, super: false } };
			}
		}

		if (!data.startsWith("\x1b")) {
			const chars = [...data];
			if (chars.length === 1) {
				const upper = data !== data.toLowerCase() && data === data.toUpperCase();
				return {
					type: "key",
					key: data.toLowerCase(),
					text: data,
					mods: { shift: upper, alt: false, ctrl: false, super: false },
				};
			}
			return { type: "paste", text: data };
		}
		return null;
	}

	private mouseEventFromInput(data: string): SurfaceInputEvent | null {
		const mouse = parseSgrMouse(data);
		if (!mouse) return null;
		const { code, x, y, press } = mouse;
		const originCol = Math.max(0, this.tui.terminal.columns - this.cols - 1);
		const cellX = x - 1 - originCol;
		const cellY = y - 2; // first rendered line is the status header
		if (cellX < 0 || cellY < 0 || cellX >= this.cols || cellY >= this.rows) {
			return null;
		}
		const mods: Mods = {
			shift: Boolean(code & 4),
			alt: Boolean(code & 8),
			ctrl: Boolean(code & 16),
			super: false,
		};
		let kind: string;
		let button = "none";
		if (code & 64) {
			kind = (code & 1) === 0 ? "scrollup" : "scrolldown";
		} else if (code & 32) {
			kind = "move";
		} else {
			kind = press ? "down" : "up";
			button = ["left", "middle", "right", "none"][code & 3] ?? "none";
		}
		return { type: "mouse", kind, button, x: cellX, y: cellY, mods };
	}

	handleInput(data: string): void {
		if (matchesKey(data, "ctrl+q")) {
			this.close();
			return;
		}
		const mouse = this.mouseEventFromInput(data);
		if (mouse) {
			this.post([mouse]);
			return;
		}
		const key = this.keyEventFromInput(data);
		if (key) {
			this.post(Array.isArray(key) ? key : [key]);
		}
	}

	/** Idempotent close; also the path used when OMK or the command asks to close. */
	close(): void {
		if (this.disposed) return;
		this.dispose();
		this.hooks.onClose();
	}

	render(width: number): string[] {
		const state = this.hooks.getState();
		const cols = Math.max(1, Math.min(width, MAX_PLACEHOLDER_CELLS));
		const rows = Math.max(4, Math.min(this.tui.terminal.rows - 4, MAX_PLACEHOLDER_CELLS));
		this.cols = cols;
		this.rows = rows;

		if (!this.lastSize || this.lastSize.cols !== cols || this.lastSize.rows !== rows) {
			this.lastSize = { cols, rows };
			queueMicrotask(() => {
				void this.hooks.post("/size", { cols, rows });
				this.hooks.onSized(cols, rows);
			});
		}

		const title = state?.title ? ` — ${state.title.slice(0, Math.max(0, cols - 30))}` : "";
		const status =
			state?.alive === false
				? `  not running${state?.error ? `: ${state.error}` : ""}`
				: state?.url
					? `  ${state.url}`
					: "";
		const header = `\x1b[2m browser${title}${status}  ctrl+q close\x1b[0m`;
		const lines: string[] = [header];

		if (state?.placed) {
			const color = imageColor(state.placed.imageId);
			const drawCols = Math.min(state.placed.cols, cols);
			const drawRows = Math.min(state.placed.rows, rows);
			for (let row = 0; row < drawRows; row++) {
				lines.push(`${color}${placeholderRow(row, drawCols)}\x1b[0m`);
			}
			for (let row = drawRows; row < rows; row++) lines.push("");
		} else {
			for (let row = 0; row < rows; row++) lines.push("");
		}

		if (state?.placed) {
			this.lastRendered = lines;
		} else if (this.lastRendered) {
			return this.lastRendered;
		}
		return lines;
	}

	invalidate(): void {
		this.lastRendered = null;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		clearInterval(this.interval);
		this.tui.terminal.write("\x1b[?1003l\x1b[?1002l\x1b[?1006l");
		this.post([{ type: "focus", focused: false }]);
	}
}
