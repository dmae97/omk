/**
 * OMK Chat Cockpit — watch/refresh loop and terminal renderer.
 */

import { enableRawTerminalInput, restoreTerminalInputState, type TerminalInputState } from "../../util/terminal-input.js";
import { MIN_COCKPIT_FRAME_WIDTH, MAX_COCKPIT_FRAME_WIDTH } from "./utils.js";

export type RenderMode = "diff" | "full" | "append";

export class CockpitRenderer {
  private prevLines: string[] = [];
  mode: RenderMode = "diff";
  paused = false;
  refreshMs: number;
  showHistory = true;
  stopped = false;
  resized = false;
  height?: number;
  private keyHandler?: (chunk: Buffer) => void;
  private terminalInputState?: TerminalInputState;

  constructor(refreshMs: number, height?: number) {
    this.refreshMs = refreshMs;
    this.height = normalizeCockpitFrameHeight(height);
  }

  setupKeyboard(): void {
    if (!process.stdin.isTTY || this.keyHandler) return;
    this.terminalInputState = enableRawTerminalInput(process.stdin);
    this.keyHandler = (key: Buffer) => {
      const char = key.toString();
      if (char === "\u0003" || char === "q") {
        this.stopped = true;
      } else if (char === " ") {
        this.paused = !this.paused;
        this.resized = true; // force redraw to show pause state
      } else if (char === "r") {
        this.resized = true;
      } else if (char === "+") {
        const max = process.stdout.rows ? Math.min(MAX_COCKPIT_HEIGHT, process.stdout.rows) : MAX_COCKPIT_HEIGHT;
        this.height = Math.min(max, (this.height ?? DEFAULT_COCKPIT_HEIGHT) + 1);
        this.resized = true;
      } else if (char === "-") {
        this.height = Math.max(MIN_COCKPIT_HEIGHT, (this.height ?? DEFAULT_COCKPIT_HEIGHT) - 1);
        this.resized = true;
      } else if (char === "a") {
        this.height = normalizeCockpitFrameHeight(undefined);
        this.resized = true;
      } else if (char === "f") {
        this.mode = this.mode === "diff" ? "full" : this.mode === "full" ? "append" : "diff";
        this.resized = true;
      } else if (char === "h") {
        this.showHistory = !this.showHistory;
        this.resized = true;
      }
    };
    process.stdin.on("data", this.keyHandler);
  }

  teardown(): void {
    if (this.keyHandler) {
      process.stdin.off("data", this.keyHandler);
      this.keyHandler = undefined;
      if (this.terminalInputState) {
        restoreTerminalInputState(process.stdin, this.terminalInputState);
        this.terminalInputState = undefined;
      }
    }
  }

  render(frame: string): void {
    const newLines = frame.split("\n");

    if (this.mode === "full") {
      clearScreen();
      process.stdout.write(frame + "\n");
      this.prevLines = [...newLines];
      return;
    }

    if (this.mode === "append") {
      process.stdout.write(frame + "\n");
      this.prevLines = [...newLines];
      return;
    }

    // diff mode
    const parts: string[] = ["\x1b[H"];
    const maxLen = Math.max(newLines.length, this.prevLines.length);

    for (let i = 0; i < maxLen; i++) {
      const newLine = newLines[i] ?? "";
      const oldLine = this.prevLines[i] ?? "";

      if (i < newLines.length) {
        if (newLine !== oldLine) {
          parts.push(newLine + "\x1b[K");
        }
      } else {
        // Extra old line to clear
        parts.push("\x1b[K");
      }

      if (i < maxLen - 1) {
        parts.push("\r\n");
      }
    }

    process.stdout.write(parts.join(""));
    this.prevLines = [...newLines];
  }
}

export function clearScreen(): void {
  // Clear screen + move cursor home, but PRESERVE scrollback so users can scroll up
  // to see previous code edits and output history.
  process.stdout.write("\x1b[2J\x1b[H");
}

export function getTerminalWidth(requested?: number): number {
  if (requested != null && Number.isFinite(requested) && requested > 0) {
    return Math.max(MIN_COCKPIT_FRAME_WIDTH, Math.min(MAX_COCKPIT_FRAME_WIDTH, Math.floor(requested)));
  }
  const cols = process.stdout.columns;
  if (cols && cols > 0) {
    return Math.max(MIN_COCKPIT_FRAME_WIDTH, Math.min(MAX_COCKPIT_FRAME_WIDTH, Math.floor(cols)));
  }
  return 36;
}

export const DEFAULT_COCKPIT_HEIGHT = 32;
export const MIN_COCKPIT_HEIGHT = 14;
export const MAX_COCKPIT_HEIGHT = 96;

export function normalizeCockpitFrameHeight(height?: number): number | undefined {
  const rows = process.stdout.rows;
  if (height != null && Number.isFinite(height)) {
    const max = rows && rows >= MIN_COCKPIT_HEIGHT ? rows : MAX_COCKPIT_HEIGHT;
    return Math.max(MIN_COCKPIT_HEIGHT, Math.min(max, Math.floor(height)));
  }
  if (rows && rows >= MIN_COCKPIT_HEIGHT) {
    return rows;
  }
  return undefined;
}
