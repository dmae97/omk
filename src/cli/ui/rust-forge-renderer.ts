import type { CliUiEvent } from "./event.js";
import type { CliRenderer } from "./renderer.js";
import { System24Renderer, type System24RendererStreams } from "./system24-renderer.js";
import { RUST_FORGE_THEME, resolveTuiMotion, shouldUseAnsiColor, type OmkTuiMotion } from "../../brand/theme.js";
import { BRAND_HEX } from "../../brand/palette.js";
import { renderOmkSigil, renderOmkSparkleText } from "../../ui/omk-sigil.js";

interface WritableStreamLike {
  write(chunk: string): unknown;
  isTTY?: boolean;
  columns?: number;
  rows?: number;
}

const ESC = "\x1b[";
const RST = `${ESC}0m`;

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

function center(text: string, width: number): string {
  const pad = Math.max(0, Math.floor((width - visibleLength(text)) / 2));
  return `${" ".repeat(pad)}${text}`;
}

function forgeScanline(seed: string, width: number): string {
  const glyphs = ["═", "─", "■", "▣", "◉", "◆"];
  let hash = 0;
  for (const char of seed) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  const chars: string[] = [];
  for (let i = 0; i < width; i += 1) {
    hash = (hash * 1103515245 + 12345) >>> 0;
    chars.push(hash % 6 === 0 ? glyphs[hash % glyphs.length] : hash % 4 === 0 ? "·" : " ");
  }
  return chars.join("").trimEnd();
}

export class RustForgeRenderer implements CliRenderer {
  private readonly base: System24Renderer;
  private readonly err: WritableStreamLike;
  private readonly noColor: boolean;
  private readonly motion: OmkTuiMotion;
  private started = false;

  constructor(streams: System24RendererStreams = {}) {
    this.err = streams.stderr ?? process.stderr;
    this.noColor = !shouldUseAnsiColor();
    this.motion = resolveTuiMotion();
    this.base = new System24Renderer(streams, RUST_FORGE_THEME, {
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
      this.base.setStickyHeaderPrefixRows(this.rustForgeHeaderRows());
      this.renderRustForgeHeader(event);
    }
    this.base.emit(event);
  }

  setThinkingSummary(summary: string | undefined): void {
    this.base.setThinkingSummary(summary);
  }

  stop(): void {
    this.base.stop();
  }

  private rustForgeHeaderRows(): number {
    const shouldRenderScanline = this.motion !== "off" && this.started && this.err.isTTY !== false;
    const sigilName = this.resolveSigilName();
    const sigilRows = sigilName !== "none" ? this.sigilHeight(sigilName) : 0;
    return (shouldRenderScanline ? 1 : 0) + 5 + sigilRows;
  }

  private resolveSigilName(): string {
    const env = process.env.OMK_SIGIL?.trim().toLowerCase();
    if (env === "off" || env === "none" || env === "0" || env === "false") return "none";
    if (env === "forge" || env === "control" || env === "omk" || env === "grid" || env === "gate") return env;
    // Default: OMK wordmark; pass unknown names through so renderOmkSigil normalizes safely.
    if (env) return env;
    return "omk";
  }

  private sigilHeight(name: string): number {
    // Height estimation — renderOmkSigil returns normalized lines
    // All sigils are 6-10 lines; default OMK wordmark is 6.
    const heights: Record<string, number> = { forge: 6, control: 8, omk: 6, grid: 8, gate: 10 };
    return heights[name] ?? 6;
  }

  private renderRustForgeHeader(event: Extract<CliUiEvent, { type: "session:start" }>): void {
    const width = Math.min(76, Math.max(40, this.err.columns ?? process.stderr.columns ?? 80) - 2);
    const dim = RUST_FORGE_THEME.colors.muted;
    const hot = RUST_FORGE_THEME.colors.borderHot;
    const success = RUST_FORGE_THEME.colors.success;
    const run = event.runId ? `run#${event.runId.slice(0, 7)}` : "run#pending";
    const root = event.root ? truncate(event.root, Math.max(12, width - 16)) : "root:unknown";
    const shouldRenderScanline = this.motion !== "off" && this.started && this.err.isTTY !== false;
    const routeLine = truncate(`${RUST_FORGE_THEME.symbols.signal} FORGE ${run} · provider:${event.provider} · model:${event.model ?? "auto"}`, width);
    const statusLine = truncate(`■ CARGO safety armed · VERIFY native evidence · SCOPE MCP/skills/hooks`, width);
    const rootLine = truncate(`${RUST_FORGE_THEME.symbols.pending} PENDING root ${root}`, width);

    const sigilName = this.resolveSigilName();
    const showSigil = sigilName !== "none";
    const sigilWidth = Math.min(64, Math.max(30, width - 4));
    const sigilFrame = Math.floor(Date.now() / 80); // ~80ms per frame for sweep animation

    if (shouldRenderScanline) {
      line(this.err, `${dim}${forgeScanline(event.runId ?? "omk-rust-forge", width)}${RST}`, this.noColor);
    }
    line(this.err, renderOmkSparkleText(center(RUST_FORGE_THEME.label.toUpperCase(), width), {
      frame: sigilFrame,
      noColor: this.noColor,
      colors: [hot, BRAND_HEX.sparkleWhite, BRAND_HEX.sparkleGold, BRAND_HEX.rustEmber, BRAND_HEX.rustCrimson],
    }), this.noColor);
    line(this.err, `${success}${center(truncate(RUST_FORGE_THEME.motto, width), width)}${RST}`, this.noColor);

    // Render sigil art with animated sweep
    if (showSigil) {
      const sigilLines = renderOmkSigil({
        name: sigilName,
        width: sigilWidth,
        frame: sigilFrame,
      });
      for (const sigilLine of sigilLines) {
        line(this.err, `${sigilLine}`, this.noColor);
      }
    }

    line(this.err, `${dim}${routeLine}${RST}`, this.noColor);
    line(this.err, `${success}${statusLine}${RST}`, this.noColor);
    line(this.err, `${dim}${rootLine}${RST}`, this.noColor);
  }
}
