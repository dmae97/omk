import type { TuiRenderMode } from "./model.js";

export interface TerminalFrameRendererOptions {
  mode?: TuiRenderMode;
  height?: number;
  write?: (chunk: string) => void;
  clear?: () => void;
  /** When true (default on main screen), avoid CSI H / CSI 2J which snap the
   * terminal scrollback to the top on drag/scroll. Alternate-screen users can
   * opt out via OMK_TUI_ALT_SCREEN=1. */
  scrollSafe?: boolean;
}

function useScrollSafe(optionsScrollSafe?: boolean): boolean {
  if (optionsScrollSafe !== undefined) return optionsScrollSafe;
  const env = process.env.OMK_TUI_ALT_SCREEN ?? process.env.PI_TUI_ALT_SCREEN ?? "";
  return !/^(1|true|yes|on|full|alt-screen)$/i.test(env);
}

export class TerminalFrameRenderer {
  private prevLines: string[] = [];
  mode: TuiRenderMode;
  height?: number;
  private readonly write: (chunk: string) => void;
  private readonly clearFrame: () => void;
  private readonly scrollSafe: boolean;

  constructor(mode?: TuiRenderMode, height?: number);
  constructor(options: TerminalFrameRendererOptions);
  constructor(modeOrOptions: TuiRenderMode | TerminalFrameRendererOptions = "diff", height?: number) {
    if (typeof modeOrOptions === "string") {
      this.mode = modeOrOptions;
      this.height = height;
      this.write = (chunk) => process.stdout.write(chunk);
      this.scrollSafe = useScrollSafe(undefined);
      this.clearFrame = () => clearTerminalScreen(this.write, this.scrollSafe);
      return;
    }

    this.mode = modeOrOptions.mode ?? "diff";
    this.height = modeOrOptions.height;
    this.write = modeOrOptions.write ?? ((chunk) => process.stdout.write(chunk));
    this.scrollSafe = useScrollSafe(modeOrOptions.scrollSafe);
    this.clearFrame = modeOrOptions.clear ?? (() => clearTerminalScreen(this.write, this.scrollSafe));
  }

  render(frame: string): void {
    const newLines = frame.split("\n");

    if (this.mode === "full") {
      this.renderFull(newLines, frame);
      return;
    }

    if (this.mode === "append") {
      this.write(`${frame}\n`);
      this.prevLines = [...newLines];
      return;
    }

    if (this.scrollSafe) {
      this.renderDiffScrollSafe(newLines);
    } else {
      this.renderDiffAltScreen(newLines);
    }
  }

  private renderFull(newLines: string[], frame: string): void {
    if (this.scrollSafe) {
      // On the main screen, do not clear+home. Start a fresh frame below the
      // current cursor so the user's scrollback position is preserved.
      if (this.prevLines.length > 0) {
        this.write("\n\n");
      }
    } else {
      this.clear();
    }
    const fillsFixedFrame = this.height != null && newLines.length >= Math.max(1, Math.floor(this.height));
    this.write(fillsFixedFrame ? frame : `${frame}\n`);
    this.prevLines = [...newLines];
  }

  private renderDiffScrollSafe(newLines: string[]): void {
    // First render: just output the frame and remember its line count.
    if (this.prevLines.length === 0) {
      this.write(newLines.join("\r\n") + "\r\n");
      this.prevLines = [...newLines];
      return;
    }

    // Move cursor from the end of the previous frame back to its first line.
    const parts: string[] = [];
    const moveUp = this.prevLines.length - 1;
    if (moveUp > 0) {
      parts.push(`\x1b[${moveUp}A`);
    }
    parts.push("\r");

    const maxLen = Math.max(newLines.length, this.prevLines.length);
    for (let i = 0; i < maxLen; i++) {
      const newLine = newLines[i] ?? "";
      const oldLine = this.prevLines[i] ?? "";

      if (i < newLines.length) {
        if (newLine !== oldLine) {
          parts.push(`${newLine}\x1b[K`);
        }
      } else {
        // Old line no longer exists: clear it.
        parts.push("\x1b[K");
      }

      if (i < maxLen - 1) {
        parts.push("\r\n");
      }
    }

    this.write(parts.join(""));
    this.prevLines = [...newLines];
  }

  private renderDiffAltScreen(newLines: string[]): void {
    const parts: string[] = ["\x1b[H"];
    const maxLen = Math.max(newLines.length, this.prevLines.length);

    for (let i = 0; i < maxLen; i++) {
      const newLine = newLines[i] ?? "";
      const oldLine = this.prevLines[i] ?? "";

      if (i < newLines.length) {
        if (newLine !== oldLine) {
          parts.push(`${newLine}\x1b[K`);
        }
      } else {
        parts.push("\x1b[K");
      }

      if (i < maxLen - 1) {
        parts.push("\r\n");
      }
    }

    this.write(parts.join(""));
    this.prevLines = [...newLines];
  }

  clear(): void {
    this.clearFrame();
  }
}

export function clearTerminalScreen(
  write: (chunk: string) => void = (chunk) => process.stdout.write(chunk),
  scrollSafe?: boolean,
): void {
  const safe = scrollSafe ?? useScrollSafe(undefined);
  if (safe) {
    // Main-screen safe: append blank lines to push old content up instead of
    // snapping the viewport to the top with clear+home.
    write("\n\n");
    return;
  }
  write("\x1b[2J\x1b[H");
}
