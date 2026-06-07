/**
 * OMK Chat Cockpit — watch/refresh loop and terminal renderer.
 */

import { enableRawTerminalInput, restoreTerminalInputState, type TerminalInputState } from "../../util/terminal-input.js";
import { clearTerminalScreen, TerminalFrameRenderer } from "../../tui/terminal-frame-renderer.js";
import type { TuiRenderMode } from "../../tui/model.js";
import { MIN_COCKPIT_FRAME_WIDTH, MAX_COCKPIT_FRAME_WIDTH } from "./utils.js";
import {
  parseSgrWheelEvents,
  pointInRect1,
  updateScrollFromWheel,
  enableMouseMode,
  disableMouseMode,
} from "./scroll.js";
import type { CockpitLayout } from "./utils.js";

export type RenderMode = TuiRenderMode;

export class CockpitRenderer {
  private readonly frameRenderer: TerminalFrameRenderer;
  mode: RenderMode = "diff";
  paused = false;
  refreshMs: number;
  showHistory = true;
  stopped = false;
  resized = false;
  height?: number;
  private animFrame = 0;
  private animTimer: ReturnType<typeof setInterval> | null = null;
  private keyHandler?: (chunk: Buffer) => void;
  private terminalInputState?: TerminalInputState;

  // ── Left pane scroll state ──
  leftScrollFromBottom = 0;
  followTail = true;
  leftTranscriptLineCount = 0;
  leftTranscriptHeight = 1;
  lastLeftLineCount = 0;
  lastTranscriptHeight = 1;
  currentLayout: CockpitLayout | null = null;
  private wheelHandler?: (chunk: Buffer) => void;
  private mouseModeEnabled = false;

  constructor(refreshMs: number, height?: number) {
    this.refreshMs = refreshMs;
    this.height = normalizeCockpitWatchFrameHeight(height);
    this.frameRenderer = new TerminalFrameRenderer({ mode: this.mode, height: this.height });
  }

  setupKeyboard(): void {
    if (!process.stdin.isTTY) return;

    // Enable mouse/wheel mode in alt screen
    this.enableMouse();

    this.terminalInputState = enableRawTerminalInput(process.stdin);

    // Route raw stdin globally before ordinary keyboard/composer-like handlers.
    this.wheelHandler = (chunk: Buffer) => {
      this.handleStdin(chunk);
    };

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
        const rows = process.stdout.rows;
        const max = rows && rows > 0 ? Math.min(MAX_COCKPIT_HEIGHT, rows) : MAX_COCKPIT_HEIGHT;
        const current = this.height ?? normalizeCockpitFrameHeight(undefined) ?? DEFAULT_COCKPIT_HEIGHT;
        this.height = Math.min(max, current + 1);
        this.resized = true;
      } else if (char === "-") {
        const rows = process.stdout.rows;
        const floor = rows && rows > 0 ? Math.min(MIN_COCKPIT_HEIGHT, rows) : MIN_COCKPIT_HEIGHT;
        const current = this.height ?? normalizeCockpitFrameHeight(undefined) ?? DEFAULT_COCKPIT_HEIGHT;
        this.height = Math.max(floor, current - 1);
        this.resized = true;
      } else if (char === "a") {
        this.height = undefined;
        this.resized = true;
      } else if (char === "f") {
        this.mode = this.mode === "diff" ? "full" : this.mode === "full" ? "append" : "diff";
        this.resized = true;
      } else if (char === "h") {
        this.showHistory = !this.showHistory;
        this.resized = true;
      }
    };
    process.stdin.on("data", this.wheelHandler);
    this.startAnimation();
  }

  private handleStdin(chunk: Buffer): void {
    this.debugInput(chunk);

    if (this.handleMouseWheelBeforeComposer(chunk)) {
      return;
    }

    if (this.handleTranscriptPagingBeforeComposer(chunk)) {
      return;
    }

    this.keyHandler?.(chunk);
  }

  private handleMouseWheelBeforeComposer(chunk: Buffer): boolean {
    const wheelEvents = parseSgrWheelEvents(chunk);
    if (wheelEvents.length === 0) {
      return false;
    }

    for (const event of wheelEvents) {
      const before = this.leftScrollFromBottom;
      const target = this.wheelTarget(event.x, event.y);
      const handled = this.handleWheel(event.x, event.y, event.deltaY, event.ctrlKey ? 14 : 6);
      if (handled) {
        this.requestRender();
      }
      this.debugWheel(event.x, event.y, event.deltaY, target, before, this.leftScrollFromBottom);
    }

    // Always consume wheel chunks so they never fall through to composer/input history.
    return true;
  }

  private handleTranscriptPagingBeforeComposer(chunk: Buffer): boolean {
    const input = chunk.toString("utf8");
    const isPageUp = input === "\x1b[5~";
    const isPageDown = input === "\x1b[6~";
    const isHome = input === "\x1b[H" || input === "\x1b[1~" || input === "\x1bOH";
    const isEnd = input === "\x1b[F" || input === "\x1b[4~" || input === "\x1bOF";

    if (!isPageUp && !isPageDown && !isHome && !isEnd) {
      return false;
    }

    const viewportStep = Math.max(1, this.leftTranscriptHeight - 3);
    const max = Math.max(0, this.leftTranscriptLineCount - this.leftTranscriptHeight);

    if (isPageUp) {
      this.leftScrollFromBottom = Math.min(max, this.leftScrollFromBottom + viewportStep);
    } else if (isPageDown) {
      this.leftScrollFromBottom = Math.max(0, this.leftScrollFromBottom - viewportStep);
    } else if (isHome) {
      this.leftScrollFromBottom = max;
    } else if (isEnd) {
      this.leftScrollFromBottom = 0;
    }

    this.followTail = this.leftScrollFromBottom === 0;
    this.requestRender();
    return true;
  }

  private debugInput(chunk: Buffer): void {
    if (process.env.OMK_DEBUG_INPUT !== "1") {
      return;
    }

    const hex = chunk.toString("hex");
    const utf8 = chunk.toString("utf8").replace(/\x1b/g, "\\x1b");
    process.stderr.write(`[input] hex=${hex} utf8=${utf8}\n`);
  }

  private debugWheel(
    x: number,
    y: number,
    deltaY: -1 | 1,
    target: "leftTranscript" | "rightRail" | "none",
    before: number,
    after: number,
  ): void {
    if (process.env.OMK_DEBUG_INPUT !== "1") {
      return;
    }

    const max = Math.max(0, this.leftTranscriptLineCount - this.leftTranscriptHeight);
    const direction = deltaY < 0 ? "up" : "down";
    const changed = before === after ? "stable" : "changed";
    process.stderr.write(
      `[input] wheel ${direction} x=${x} y=${y} target=${target} scroll=${after}/${max} ` +
        `leftTranscriptLineCount=${this.leftTranscriptLineCount} ` +
        `leftTranscriptHeight=${this.leftTranscriptHeight} followTail=${this.followTail} ${changed}\n`,
    );
  }

  private enableMouse(): void {
    if (this.mouseModeEnabled) return;
    enableMouseMode();
    this.mouseModeEnabled = true;
  }

  private disableMouse(): void {
    if (!this.mouseModeEnabled) return;
    disableMouseMode();
    this.mouseModeEnabled = false;
  }

  private wheelTarget(x: number, y: number): "leftTranscript" | "rightRail" | "none" {
    const layout = this.currentLayout;
    if (!layout) return "none";

    if (pointInRect1(x, y, layout.rightRail)) {
      return "rightRail";
    }

    const overLeft =
      pointInRect1(x, y, layout.transcript) ||
      pointInRect1(x, y, layout.working) ||
      pointInRect1(x, y, layout.composer) ||
      pointInRect1(x, y, layout.leftPane);

    return overLeft ? "leftTranscript" : "none";
  }

  private handleWheel(x: number, y: number, deltaY: -1 | 1, step = 6): boolean {
    if (this.wheelTarget(x, y) !== "leftTranscript") {
      return false;
    }

    this.leftScrollFromBottom = updateScrollFromWheel({
      scrollFromBottom: this.leftScrollFromBottom,
      totalLines: this.leftTranscriptLineCount,
      viewportHeight: this.leftTranscriptHeight,
      deltaY,
      step,
    });

    this.followTail = this.leftScrollFromBottom === 0;
    return true;
  }

  requestRender(): void {
    this.resized = true;
  }

  onLeftContentChanged(): void {
    if (this.followTail) {
      this.leftScrollFromBottom = 0;
    } else {
      const max = Math.max(0, this.leftTranscriptLineCount - this.leftTranscriptHeight);
      this.leftScrollFromBottom = Math.min(this.leftScrollFromBottom, max);
    }
  }

  getAnimFrame(): number {
    return this.animFrame;
  }

  startAnimation(): void {
    if (this.animTimer) return;
    if (process.env.OMK_ANIM === "0") return;
    const fps = Number(process.env.OMK_ANIM_FPS ?? "12");
    const intervalMs = Math.max(50, Math.floor(1000 / Math.max(1, fps)));
    this.animTimer = setInterval(() => {
      this.animFrame += 1;
      this.resized = true;
    }, intervalMs);
    this.animTimer.unref?.();
  }

  stopAnimation(): void {
    if (this.animTimer) {
      clearInterval(this.animTimer);
      this.animTimer = null;
    }
  }

  teardown(): void {
    this.stopAnimation();
    this.disableMouse();
    if (this.wheelHandler) {
      process.stdin.off("data", this.wheelHandler);
      this.wheelHandler = undefined;
    }
    if (this.keyHandler) {
      this.keyHandler = undefined;
      if (this.terminalInputState) {
        restoreTerminalInputState(process.stdin, this.terminalInputState);
        this.terminalInputState = undefined;
      }
    }
  }

  render(frame: string): void {
    this.frameRenderer.mode = this.mode;
    this.frameRenderer.height = this.height ?? frame.split("\n").length;
    this.frameRenderer.render(frame);
  }
}

export function clearScreen(): void {
  // Clear screen + move cursor home, but PRESERVE scrollback so users can scroll up
  // to see previous code edits and output history.
  clearTerminalScreen();
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
  const hasRows = typeof rows === "number" && Number.isFinite(rows) && rows > 0;
  const max = hasRows ? Math.floor(rows) : MAX_COCKPIT_HEIGHT;
  const min = hasRows ? Math.min(MIN_COCKPIT_HEIGHT, max) : MIN_COCKPIT_HEIGHT;

  if (height != null && Number.isFinite(height)) {
    return Math.max(min, Math.min(max, Math.floor(height)));
  }
  return hasRows ? max : undefined;
}

export function normalizeCockpitWatchFrameHeight(height?: number): number {
  return normalizeCockpitFrameHeight(height) ?? DEFAULT_COCKPIT_HEIGHT;
}
