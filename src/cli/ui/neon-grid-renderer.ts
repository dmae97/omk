import gradientString from "gradient-string";
import type { CliUiEvent } from "./event.js";
import type { CliRenderer } from "./renderer.js";
import { System24Renderer, type System24RendererStreams } from "./system24-renderer.js";
import { NEON_GRID_THEME, resolveTuiMotion, shouldUseAnsiColor, type OmkTuiMotion } from "../../brand/theme.js";
import { BRAND_HEX } from "../../brand/palette.js";
import { renderOmkSparkleText } from "../../ui/omk-sigil.js";
import { renderChalkAnimationKeyframe, renderInkGradientFallback, renderTerminalKitCapabilityBadge } from "../../theme/library-effects.js";

interface WritableStreamLike {
  write(chunk: string): unknown;
  isTTY?: boolean;
  columns?: number;
  rows?: number;
}

const ESC = "\x1b[";
const RST = `${ESC}0m`;
const SAVE_CURSOR = "\x1b7";
const RESTORE_CURSOR = "\x1b8";

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

function visibleLength(value: string): number {
  return stripAnsi(value).length;
}

function line(stream: WritableStreamLike, text: string, noColor: boolean): void {
  stream.write(`${noColor ? stripAnsi(text) : text}\n`);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
}
function normalizeEntryBrandLabel(value: string | undefined): string | undefined {
  const stripped = stripAnsi(value ?? "")
    .replace(/[\x00-\x1F\x7F]/g, "")
    .trim();
  return stripped.length > 0 ? truncate(stripped, 20) : undefined;
}


function center(text: string, width: number): string {
  const pad = Math.max(0, Math.floor((width - visibleLength(text)) / 2));
  return `${" ".repeat(pad)}${text}`;
}

function signalScanline(seed: string, width: number): string {
  const glyphs = ["◇", "◆", "●", "○", "▣", "⟁", "⟐", "⟡"];
  let hash = 0;
  for (const char of seed) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  const chars: string[] = [];
  for (let i = 0; i < width; i += 1) {
    hash = (hash * 1664525 + 1013904223) >>> 0;
    chars.push(hash % 7 === 0 ? glyphs[hash % glyphs.length] : hash % 5 === 0 ? "─" : " ");
  }
  return chars.join("").trimEnd();
}

function gradientLine(text: string, colors: string[], noColor: boolean): string {
  return noColor ? text : gradientString(colors).multiline(text);
}

export class NeonGridRenderer implements CliRenderer {
  private readonly base: System24Renderer;
  private readonly err: WritableStreamLike;
  private readonly noColor: boolean;
  private readonly motion: OmkTuiMotion;
  private headerTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  constructor(streams: System24RendererStreams = {}) {
    this.err = streams.stderr ?? process.stderr;
    this.noColor = !shouldUseAnsiColor();
    this.motion = resolveTuiMotion();
    this.base = new System24Renderer(streams, NEON_GRID_THEME, {
      sessionHeader: "compact",
      noColor: this.noColor,
      terminalControls: true,
    });
  }

  start(): void {
    this.started = true;
    this.base.start();
  }

  emit(event: CliUiEvent): void {
    if (event.type === "session:start") {
      this.base.setStickyHeaderPrefixRows(this.neonGridHeaderRows());
      this.renderNeonGridHeader(event);
      this.base.emit(event);
      this.startHeaderAnimation(event);
      return;
    }
    this.base.emit(event);
  }

  setThinkingSummary(summary: string | undefined): void {
    this.base.setThinkingSummary(summary);
  }

  stop(): void {
    this.stopHeaderAnimation();
    this.base.stop();
  }

  private neonGridHeaderRows(): number {
    return this.neonGridHeaderLines({
      type: "session:start",
      runId: "",
      provider: "auto",
      model: "auto",
    }).length;
  }

  private canAnimateHeader(): boolean {
    const requested = process.env.OMK_EXPERIMENTAL_HEADER_REPAINT;
    const enabled = /^(1|true|yes|on)$/i.test(requested ?? "");
    return enabled && this.motion !== "off" && this.started && this.err.isTTY === true && !this.noColor;
  }

  private shouldRenderScanline(): boolean {
    return this.motion !== "off" && this.started && this.err.isTTY !== false;
  }

  private currentFrame(): number {
    return Math.floor(Date.now() / 80);
  }

  private startHeaderAnimation(event: Extract<CliUiEvent, { type: "session:start" }>): void {
    this.stopHeaderAnimation();
    if (!this.canAnimateHeader()) return;
    this.headerTimer = setInterval(() => this.repaintNeonGridHeader(event), 120);
    this.headerTimer.unref?.();
  }

  private stopHeaderAnimation(): void {
    if (!this.headerTimer) return;
    clearInterval(this.headerTimer);
    this.headerTimer = null;
  }

  private repaintNeonGridHeader(event: Extract<CliUiEvent, { type: "session:start" }>): void {
    if (!this.canAnimateHeader()) return;
    const maxRows = Math.max(0, (this.err.rows ?? process.stderr.rows ?? Number.POSITIVE_INFINITY) - 1);
    const rows = this.neonGridHeaderLines(event, this.currentFrame()).slice(0, maxRows);
    const repaint = rows
      .map((row, index) => `${ESC}${index + 1};1H${ESC}2K${row}`)
      .join("");
    this.err.write(SAVE_CURSOR + repaint + RESTORE_CURSOR);
  }

  private renderNeonGridHeader(event: Extract<CliUiEvent, { type: "session:start" }>): void {
    for (const row of this.neonGridHeaderLines(event, this.currentFrame())) {
      line(this.err, row, this.noColor);
    }
  }

  private neonGridHeaderLines(event: Extract<CliUiEvent, { type: "session:start" }>, frame = 0): string[] {
    const width = Math.min(76, Math.max(40, this.err.columns ?? process.stderr.columns ?? 80) - 2);
    const dim = NEON_GRID_THEME.colors.muted;
    const run = event.runId ? `run#${event.runId.slice(0, 7)}` : "run#pending";
    const root = event.root ? truncate(event.root, Math.max(12, width - 16)) : "root:unknown";
    const entryBrand = normalizeEntryBrandLabel(event.brandLabel);
    const titleLine = center(entryBrand ? `◢█ ${entryBrand} █◣` : "◢█ OMK//CONTROL █◣", width);
    const controlLine = center(entryBrand ? `${entryBrand}://CONTROL` : "OMK://CONTROL", width);
    const coreLine = center("CYBERPUNK OPS CORE", width);
    const gridLine = center("MATRIX RAIN // NEON GRID ONLINE", width);
    const variantLine = center("NIGHT-CITY-MATRIX-V3", width);
    const mottoLine = center(truncate(NEON_GRID_THEME.motto, width), width);
    const stateLine = truncate(`state: ● ready · route: route · evidence · loop · control`, Math.max(12, width - 18));
    const routeLine = truncate(`${NEON_GRID_THEME.symbols.signal} ROUTE ${run} · provider:${event.provider} · model:${event.model ?? "auto"}`, width);
    const rootLine = truncate(`${NEON_GRID_THEME.symbols.pending} PENDING root ${root}`, width);
    const rows: string[] = [];

    if (this.shouldRenderScanline()) {
      const seed = `${event.runId ?? (entryBrand ? `${entryBrand}-control` : "omk-control")}:${frame}`;
      rows.push(`${dim}${signalScanline(seed, width)}${RST}`);
    }
    rows.push(renderOmkSparkleText(titleLine, {
      frame,
      noColor: this.noColor,
      colors: [BRAND_HEX.cyan, BRAND_HEX.sparkleWhite, BRAND_HEX.sparkleGold, BRAND_HEX.magenta, BRAND_HEX.mint],
    }));
    rows.push(renderChalkAnimationKeyframe(controlLine, "rainbow", frame, { noColor: this.noColor }));
    rows.push(renderChalkAnimationKeyframe(coreLine, "karaoke", frame, { noColor: this.noColor }));
    rows.push(renderInkGradientFallback(gridLine, "pastel", { noColor: this.noColor }));
    rows.push(`${dim}${variantLine}${RST}`);
    rows.push(renderInkGradientFallback(mottoLine, "cristal", { noColor: this.noColor }));
    rows.push(this.noColor
      ? gradientLine(stateLine, [BRAND_HEX.mint, BRAND_HEX.cyan], this.noColor)
      : renderTerminalKitCapabilityBadge(gradientLine(stateLine, [BRAND_HEX.mint, BRAND_HEX.cyan], this.noColor))
    );
    rows.push(`${dim}${routeLine}${RST}`);
    rows.push(`${dim}${rootLine}${RST}`);
    return rows;
  }
}
