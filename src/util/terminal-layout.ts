/**
 * Terminal layout utilities — visible-width-aware helpers for CLI rendering.
 */

import { style, box, subheader, sanitizeTerminalText } from "./theme.js";

const ANSI_REGEX = /\x1B(?:[@-Z\-_]|\[[0-?]*[ -/]*[@-~])/g;

function isCombiningCodePoint(codePoint: number): boolean {
  return (
    codePoint === 0x200d ||
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
  );
}

function isWideCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x2600 && codePoint <= 0x27bf)
  );
}

function terminalCharWidth(char: string): number {
  const codePoint = char.codePointAt(0);
  if (codePoint === undefined) return 0;
  if (codePoint === 0 || codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
  if (isCombiningCodePoint(codePoint)) return 0;
  return isWideCodePoint(codePoint) ? 2 : 1;
}

export function visibleTerminalWidth(value: string): number {
  return [...sanitizeTerminalText(value)].reduce((width, char) => width + terminalCharWidth(char), 0);
}

/** Truncate visible text while preserving ANSI escape sequences. */
export function truncateLine(line: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (visibleTerminalWidth(line) <= maxWidth) return line;

  const ellipsis = style.gray("…");
  const limit = Math.max(0, maxWidth - 1);
  let currentWidth = 0;
  let result = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const appendText = (text: string): boolean => {
    for (const char of text) {
      const charWidth = terminalCharWidth(char);
      if (currentWidth + charWidth > limit) return false;
      result += char;
      currentWidth += charWidth;
    }
    return true;
  };

  ANSI_REGEX.lastIndex = 0;
  while ((match = ANSI_REGEX.exec(line)) !== null) {
    const textBefore = line.slice(lastIndex, match.index);
    if (!appendText(textBefore)) return result + ellipsis;
    result += match[0];
    lastIndex = ANSI_REGEX.lastIndex;
  }

  const remaining = line.slice(lastIndex);
  if (!appendText(remaining)) return result + ellipsis;

  return result;
}

export function padEndVisible(value: string, targetWidth: number): string {
  return value + " ".repeat(Math.max(0, targetWidth - visibleTerminalWidth(value)));
}

export function padStartVisible(value: string, targetWidth: number): string {
  return " ".repeat(Math.max(0, targetWidth - visibleTerminalWidth(value))) + value;
}

/** Ensure an array of lines exactly matches a target count (truncate or pad). */
export function fitLines(lines: string[], count: number): string[] {
  const result = lines.slice(0, count);
  while (result.length < count) result.push("");
  return result;
}

/** Ensure an array of lines fits a target height (truncate or pad). */
export function fitHeight(lines: string[], height?: number): string[] {
  if (height == null) return lines;
  const result = lines.slice(0, height);
  while (result.length < height) result.push("");
  return result;
}

/** Wrap lines in a themed box panel. */
export function panel(title: string, lines: string[], width: number): string {
  const processed = lines.map((line) => {
    const truncated = truncateLine(line, width);
    const vw = visibleTerminalWidth(truncated);
    return vw < width ? truncated + " ".repeat(width - vw) : truncated;
  });
  return box(processed, title || undefined);
}

/** Render a section header. */
export function sectionHeader(title: string): string {
  return subheader(title);
}

export { sanitizeTerminalText };
