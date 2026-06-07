/**
 * OMK Cockpit — scroll utilities for left-pane transcript viewport.
 */

export type Rect1 = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type Rect = Rect1;

export type WheelEvent = {
  x: number;
  y: number;
  deltaY: -1 | 1;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
};

export function pointInRect1(x: number, y: number, rect: Rect1 | null | undefined): boolean {
  if (!rect) return false;

  return (
    x >= rect.x &&
    x <= rect.x + rect.w - 1 &&
    y >= rect.y &&
    y <= rect.y + rect.h - 1
  );
}

export function pointInRect(x: number, y: number, rect: Rect | null | undefined): boolean {
  return pointInRect1(x, y, rect);
}

export function parseSgrWheelEvents(input: Buffer | string): WheelEvent[] {
  const text = Buffer.isBuffer(input) ? input.toString("utf8") : input;
  const events: WheelEvent[] = [];

  const re = /\x1b\[<(\d+);(\d+);(\d+)([mM])/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    const code = Number(match[1]);
    const x = Number(match[2]);
    const y = Number(match[3]);
    const down = match[4] === "M";

    if (!down) continue;

    const isWheel = (code & 64) === 64;
    if (!isWheel) continue;

    const wheelKind = code & 3;
    const deltaY = wheelKind === 0 ? -1 : wheelKind === 1 ? 1 : null;
    if (deltaY == null) continue;

    events.push({
      x,
      y,
      deltaY,
      shiftKey: (code & 4) !== 0,
      altKey: (code & 8) !== 0,
      ctrlKey: (code & 16) !== 0,
    });
  }

  return events;
}

export function maxScrollFromBottom(totalLines: number, viewportHeight: number): number {
  return Math.max(0, totalLines - Math.max(1, viewportHeight));
}

export function updateScrollFromWheel(args: {
  scrollFromBottom: number;
  totalLines: number;
  viewportHeight: number;
  deltaY: -1 | 1;
  step?: number;
}): number {
  const step = args.step ?? 5;
  const max = maxScrollFromBottom(args.totalLines, args.viewportHeight);

  if (args.deltaY < 0) {
    return clamp(args.scrollFromBottom + step, 0, max);
  }

  return clamp(args.scrollFromBottom - step, 0, max);
}

export function sliceFromBottom(args: {
  lines: readonly string[];
  viewportHeight: number;
  scrollFromBottom: number;
}): string[] {
  const height = Math.max(1, args.viewportHeight);
  const max = maxScrollFromBottom(args.lines.length, height);
  const scroll = clamp(args.scrollFromBottom, 0, max);

  const end = args.lines.length - scroll;
  const start = Math.max(0, end - height);
  const visible = args.lines.slice(start, end);

  const padded = [...visible];
  while (padded.length < height) {
    padded.unshift("");
  }

  return padded;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Enable alt screen, hide cursor, and enable SGR mouse mode for wheel events. */
export function enableMouseMode(): void {
  process.stdout.write("\x1b[?1049h"); // alt screen
  process.stdout.write("\x1b[?25l"); // cursor hide
  process.stdout.write("\x1b[?1000h"); // mouse click/wheel
  process.stdout.write("\x1b[?1002h"); // mouse drag
  process.stdout.write("\x1b[?1006h"); // SGR mouse mode
}

/** Restore terminal mouse/cursor/screen mode. */
export function disableMouseMode(): void {
  process.stdout.write("\x1b[?1006l");
  process.stdout.write("\x1b[?1002l");
  process.stdout.write("\x1b[?1000l");
  process.stdout.write("\x1b[?25h");
  process.stdout.write("\x1b[?1049l");
}
