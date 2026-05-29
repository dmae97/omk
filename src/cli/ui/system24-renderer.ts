/**
 * System24Renderer — OMK-optimized TUI renderer.
 *
 * Design language:
 * - oklch gray-scale backgrounds (near-black base)
 * - Square borders, no rounding
 * - Panel labels, ASCII art headers
 * - Monospace typography (terminal-native)
 * - Minimal color accents on neutral base
 *
 * Panels:
 * ┌─ session ──────────────────────────────────────┐
 * │  ◆ OMK · mimo · mimo-v2.5-pro    run#abc123   │
 * └────────────────────────────────────────────────┘
 * ┌─ turn ─────────────────────────────────────────┐
 * │  ▸ user input                                   │
 * │  ▸ assistant output with markdown                │
 * │  ┌─ code: ts ──────────────────────────────────┐│
 * │  │  const x = 1;                               ││
 * │  └─────────────────────────────────────────────┘│
 * │  🧠 reasoning summary                           │
 * ├─ status ───────────────────────────────────────┤
 * │  ⚙ [context7,gh_grep] ⟨karpathy,…+2⟩ ─ 2.3s   │
 * └────────────────────────────────────────────────┘
 */
import type { CliUiEvent } from "./event.js";
import type { CliRenderer } from "./renderer.js";
import { sanitizeUserVisibleOutput } from "../../util/user-visible-output.js";

// ── ANSI Helpers ───────────────────────────────────────────────────────────

const ESC = "\x1b[";
const RST = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const ITALIC = `${ESC}3m`;

// system24-inspired gray palette (oklch → approximated for 256-color terminals)
const C = {
  // Backgrounds (dark to light)
  bg1: `${ESC}232;232;232m`,  // ~oklch(31%) - deepest panel bg
  bg2: `${ESC}218;218;218m`,  // ~oklch(27%) - secondary bg
  bg3: `${ESC}204;204;204m`,  // ~oklch(23%) - spacing
  bg4: `${ESC}190;190;190m`,  // ~oklch(19%) - main bg (darkest)

  // Text
  text0: `${ESC}153;153;153m`, // ~oklch(60%) - muted
  text1: `${ESC}242;242;242m`, // ~oklch(95%) - brightest
  text2: `${ESC}217;217;217m`, // ~oklch(85%) - headings
  text3: `${ESC}191;191;191m`, // ~oklch(75%) - normal
  text4: `${ESC}153;153;153m`, // ~oklch(60%) - icons/channels
  text5: `${ESC}102;102;102m`, // ~oklch(40%) - muted/timestamps

  // Accents (from OMK palette, desaturated to match system24)
  accent: `${ESC}167;139;250m`,  // lightPurple - primary accent
  green: `${ESC}102;204;153m`,   // success
  amber: `${ESC}245;191;102m`,  // warning
  red: `${ESC}242;143;143m`,    // error
  cyan: `${ESC}102;204;217m`,   // info

  // Borders
  border: `${ESC}85;85;85m`,     // border color (~oklch(40%))
  borderHL: `${ESC}140;140;140m`, // highlighted border
} as const;

const SEP_CHAR = "─";
const BORDER_V = "│";
const BORDER_TL = "┌";
const BORDER_TR = "┐";
const BORDER_BL = "└";
const BORDER_BR = "┘";
const BORDER_ML = "├";
const BORDER_MR = "┤";

// ── Layout Helpers ─────────────────────────────────────────────────────────

interface WritableStreamLike {
  write(chunk: string): unknown;
  isTTY?: boolean;
  columns?: number;
}

function termWidth(stream: WritableStreamLike): number {
  return stream.columns ?? process.stdout.columns ?? 80;
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function visibleLen(s: string): number {
  return stripAnsi(s).length;
}

function padRight(s: string, width: number): string {
  const len = visibleLen(s);
  return len >= width ? s : s + " ".repeat(width - len);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rs = Math.floor(s % 60);
  return `${m}m${rs}s`;
}

// ── Panel Rendering ────────────────────────────────────────────────────────

function renderPanelTop(width: number, label?: string): string {
  const inner = width - 2;
  if (label) {
    const labelText = ` ${label} `;
    const left = SEP_CHAR.repeat(2);
    const right = SEP_CHAR.repeat(Math.max(0, inner - visibleLen(labelText) - left.length));
    return C.border + BORDER_TL + left + C.text5 + labelText + C.border + right + BORDER_TR + RST;
  }
  return C.border + BORDER_TL + SEP_CHAR.repeat(inner) + BORDER_TR + RST;
}

function renderPanelBottom(width: number): string {
  return C.border + BORDER_BL + SEP_CHAR.repeat(width - 2) + BORDER_BR + RST;
}

function renderPanelDivider(width: number, label?: string): string {
  const inner = width - 2;
  if (label) {
    const labelText = ` ${label} `;
    const left = SEP_CHAR.repeat(2);
    const right = SEP_CHAR.repeat(Math.max(0, inner - visibleLen(labelText) - left.length));
    return C.border + BORDER_ML + left + C.text5 + labelText + C.border + right + BORDER_MR + RST;
  }
  return C.border + BORDER_ML + SEP_CHAR.repeat(inner) + BORDER_MR + RST;
}

function renderPanelLine(content: string, width: number): string {
  const inner = width - 2;
  const padded = padRight(content, inner);
  return C.border + BORDER_V + RST + padded + C.border + BORDER_V + RST;
}

// ── Code Block Rendering ───────────────────────────────────────────────────

function renderCodeBlock(codeLines: string[], lang: string, width: number): string[] {
  const inner = width - 2;
  const codeInner = inner - 4; // 2 chars padding each side
  const label = lang || "code";
  const topBorder =
    C.border + " " + BORDER_TL + SEP_CHAR.repeat(2) +
    C.text5 + ` ${label} ` +
    C.border + SEP_CHAR.repeat(Math.max(0, codeInner - visibleLen(` ${label} `) - 2)) +
    BORDER_TR + RST;
  const bottomBorder =
    C.border + " " + BORDER_BL + SEP_CHAR.repeat(codeInner) + BORDER_BR + RST;

  const result: string[] = [renderPanelLine(topBorder, width)];
  for (const line of codeLines) {
    const codeLine = C.bg3 + C.text1 + " " + padRight(line, codeInner - 2) + " " + RST;
    result.push(C.border + BORDER_V + RST + " " + codeLine + " " + C.border + BORDER_V + RST);
  }
  result.push(renderPanelLine(bottomBorder, width));
  return result;
}

// ── Inline Markdown (system24 style) ───────────────────────────────────────

function renderInline(text: string): string {
  // Bold
  let s = text.replace(/\*\*(.+?)\*\*/g, (_, m) => BOLD + C.text1 + m + RST);
  s = s.replace(/__(.+?)__/g, (_, m) => BOLD + C.text1 + m + RST);
  // Italic
  s = s.replace(/(?<!\w)\*(.+?)\*(?!\w)/g, (_, m) => ITALIC + C.text3 + m + RST);
  // Inline code
  s = s.replace(/`([^`]+)`/g, (_, m) => C.bg3 + C.text1 + " " + m + " " + RST);
  // Links
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, (_, m) => C.cyan + m + RST);
  return s;
}

// ── Thinking Animation ─────────────────────────────────────────────────────

const SPIN = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];
let spinIdx = 0;

function renderThinking(summary: string | undefined, elapsedMs: number, todoPercent?: number): string {
  const frame = SPIN[spinIdx++ % SPIN.length];
  const time = `${DIM}${C.text5}${formatElapsed(elapsedMs)}${RST}`;
  const parts: string[] = [`  ${C.accent}${frame}${RST}`];

  if (todoPercent !== undefined && todoPercent >= 0) {
    const barLen = 8;
    const filled = Math.round((todoPercent / 100) * barLen);
    const bar = C.green + "█".repeat(filled) + C.text5 + "░".repeat(barLen - filled) + RST;
    parts.push(`${C.text5}TODO${RST} ${bar} ${C.text3}${todoPercent}%${RST}`);
  }

  if (summary) {
    parts.push(DIM + C.text5 + truncate(summary, 40) + RST);
  } else {
    parts.push(DIM + C.text5 + "thinking..." + RST);
  }

  parts.push(time);
  return parts.join(" ");
}

// ── MCP/Skill Name Formatting ──────────────────────────────────────────────

function formatMcpNames(names: readonly string[] | undefined): string {
  if (!names || names.length === 0) return "";
  const max = 3;
  const shown = names.slice(0, max).map(n => truncate(n, 12));
  const rest = names.length - max;
  const label = rest > 0 ? shown.join(",") + `,…+${rest}` : shown.join(",");
  return `${C.cyan}[${label}]${RST}`;
}

function formatSkillNames(names: readonly string[] | undefined): string {
  if (!names || names.length === 0) return "";
  const max = 2;
  const shown = names.slice(0, max).map(n => truncate(n, 12));
  const rest = names.length - max;
  const label = rest > 0 ? shown.join(",") + `,…+${rest}` : shown.join(",");
  return `${C.accent}⟨${label}⟩${RST}`;
}

// ── System24Renderer ───────────────────────────────────────────────────────

export interface System24RendererStreams {
  stdout?: WritableStreamLike;
  stderr?: WritableStreamLike;
}

export class System24Renderer implements CliRenderer {
  private readonly out: WritableStreamLike;
  private readonly err: WritableStreamLike;
  private heartbeatOpen = false;
  private thinkingSummary: string | undefined;
  private lastRoute: { provider: string; model?: string; risk: string; sandbox: string; mcp?: readonly string[]; skills?: readonly string[] } | null = null;
  private turnStartTime = 0;
  private sessionStartTime = 0;
  private runId = "";
  private panelWidth = 72;
  private todoPercent = -1;
  private inCodeBlock = false;
  private codeBlockLang = "";
  private codeBlockLines: string[] = [];

  constructor(streams: System24RendererStreams = {}) {
    this.out = streams.stdout ?? process.stdout;
    this.err = streams.stderr ?? process.stderr;
  }

  start(): void {
    this.panelWidth = Math.min(76, termWidth(this.out) - 2);
    this.sessionStartTime = Date.now();
  }

  emit(event: CliUiEvent): void {
    const w = this.panelWidth;

    switch (event.type) {
      case "session:start": {
        this.runId = event.runId;
        const provider = event.provider === "auto" ? "omk" : event.provider;
        const model = event.model ?? "auto";
        const runShort = event.runId.slice(0, 7);
        const titleLine =
          C.accent + BOLD + "◆" + RST + " " +
          C.accent + "OMK" + RST + C.text5 + " · " + RST +
          C.text3 + provider + RST + C.text5 + " · " + RST +
          C.text2 + model + RST;
        const runLabel = C.text5 + "run#" + runShort + RST;

        this.err.write("\n");
        this.err.write(renderPanelTop(w, "session"));
        this.err.write("\n");
        this.err.write(renderPanelLine("  " + titleLine + "  " + runLabel, w));
        this.err.write("\n");
        this.err.write(renderPanelBottom(w));
        this.err.write("\n\n");
        break;
      }

      case "input:submitted": {
        const text = event.text.length > w - 8 ? event.text.slice(0, w - 11) + "..." : event.text;
        this.err.write(renderPanelLine(C.cyan + "  › " + RST + C.text2 + text + RST, w));
        this.err.write("\n\n");
        break;
      }

      case "prompt:ready":
        break;

      case "control:output": {
        if (this.heartbeatOpen) {
          this.err.write("\r" + " ".repeat(w) + "\r");
          this.heartbeatOpen = false;
        }
        const sanitized = stripAnsi(sanitizeUserVisibleOutput(event.text));
        for (const line of sanitized.split("\n")) {
          this.err.write(renderPanelLine("  " + renderInline(line), w) + "\n");
        }
        break;
      }

      case "turn:route": {
        this.lastRoute = {
          provider: event.provider,
          model: event.model,
          risk: event.risk,
          sandbox: event.sandbox,
          mcp: event.mcp,
          skills: event.skills,
        };
        break;
      }

      case "turn:start":
        this.thinkingSummary = undefined;
        this.todoPercent = -1;
        this.inCodeBlock = false;
        this.codeBlockLines = [];
        this.turnStartTime = Date.now();
        this.err.write(renderPanelTop(w, "turn"));
        this.err.write("\n");
        break;

      case "turn:heartbeat": {
        const line = renderThinking(this.thinkingSummary, event.elapsedMs, this.todoPercent >= 0 ? this.todoPercent : undefined);
        if (this.err.isTTY) {
          this.err.write("\r" + " ".repeat(w) + "\r");
          this.err.write(C.border + BORDER_V + RST + line);
          this.heartbeatOpen = true;
        }
        break;
      }

      case "turn:todo": {
        const total = event.total;
        const done = event.done;
        this.todoPercent = total > 0 ? Math.round((done / total) * 100) : 0;
        break;
      }

      case "turn:reasoning": {
        if (event.summary) {
          this.err.write(renderPanelLine("  " + C.accent + "🧠 " + RST + DIM + C.text5 + truncate(event.summary, 60) + RST, w));
          this.err.write("\n");
        }
        break;
      }

      case "assistant:final": {
        if (this.heartbeatOpen) {
          this.err.write("\r" + " ".repeat(w) + "\r");
          this.heartbeatOpen = false;
        }
        const lines = event.text.split("\n");
        for (const line of lines) {
          // Code block toggle
          if (line.startsWith("```")) {
            if (this.inCodeBlock) {
              // End code block — flush
              const rendered = renderCodeBlock(this.codeBlockLines, this.codeBlockLang, w);
              for (const rl of rendered) this.out.write(rl + "\n");
              this.codeBlockLines = [];
              this.codeBlockLang = "";
              this.inCodeBlock = false;
            } else {
              // Start code block
              this.inCodeBlock = true;
              this.codeBlockLang = line.slice(3).trim();
            }
            continue;
          }

          if (this.inCodeBlock) {
            this.codeBlockLines.push(line);
            continue;
          }

          // Headers
          const hMatch = line.match(/^(#{1,3})\s+(.+)$/);
          if (hMatch) {
            const level = hMatch[1].length;
            const text = hMatch[2];
            if (level === 1) this.out.write(renderPanelLine("  " + BOLD + C.accent + "▋ " + text + RST, w) + "\n");
            else if (level === 2) this.out.write(renderPanelLine("  " + C.green + "▸ " + text + RST, w) + "\n");
            else this.out.write(renderPanelLine("  " + C.cyan + "  · " + text + RST, w) + "\n");
            continue;
          }
          // List items
          const lMatch = line.match(/^(\s*)[-*]\s+(.+)$/);
          if (lMatch) {
            this.out.write(renderPanelLine("  " + C.accent + "◆" + RST + " " + renderInline(lMatch[2]), w) + "\n");
            continue;
          }
          // Horizontal rule
          if (/^[-*_]{3,}$/.test(line.trim())) {
            this.out.write(renderPanelLine("  " + C.text5 + SEP_CHAR.repeat(Math.min(w - 6, 40)) + RST, w) + "\n");
            continue;
          }
          // Empty
          if (line.trim() === "") {
            this.out.write(renderPanelLine("", w) + "\n");
            continue;
          }
          // Regular text
          this.out.write(renderPanelLine("  " + renderInline(line), w) + "\n");
        }

        // Flush unclosed code block
        if (this.inCodeBlock && this.codeBlockLines.length > 0) {
          const rendered = renderCodeBlock(this.codeBlockLines, this.codeBlockLang, w);
          for (const rl of rendered) this.out.write(rl + "\n");
          this.codeBlockLines = [];
          this.codeBlockLang = "";
          this.inCodeBlock = false;
        }
        break;
      }

      case "turn:error": {
        if (this.heartbeatOpen) {
          this.err.write("\r" + " ".repeat(w) + "\r");
          this.heartbeatOpen = false;
        }
        const errMsg = sanitizeUserVisibleOutput(event.message);
        this.err.write("\n");
        this.err.write(renderPanelLine(C.red + "  ✖ " + RST + C.text2 + errMsg + RST, w));
        this.err.write("\n");
        break;
      }

      case "turn:finish": {
        if (this.heartbeatOpen) {
          this.err.write("\r" + " ".repeat(w) + "\r");
          this.heartbeatOpen = false;
        }
        // Flush unclosed code block if any
        if (this.inCodeBlock && this.codeBlockLines.length > 0) {
          const rendered = renderCodeBlock(this.codeBlockLines, this.codeBlockLang, w);
          for (const rl of rendered) this.out.write(rl + "\n");
          this.codeBlockLines = [];
          this.codeBlockLang = "";
          this.inCodeBlock = false;
        }
        const elapsed = formatElapsed(event.durationMs);

        // Status bar with MCP names, skill names, timing
        const parts: string[] = [];
        if (this.lastRoute) {
          parts.push(C.text5 + this.lastRoute.provider + RST);
          if (this.lastRoute.model) parts.push(C.text5 + truncate(this.lastRoute.model, 16) + RST);
          if (this.lastRoute.risk !== "safe") parts.push(C.amber + this.lastRoute.risk + RST);
          if (this.lastRoute.sandbox !== "none") parts.push(C.green + this.lastRoute.sandbox + RST);

          const mcpStr = formatMcpNames(this.lastRoute.mcp);
          if (mcpStr) parts.push(mcpStr);

          const skStr = formatSkillNames(this.lastRoute.skills);
          if (skStr) parts.push(skStr);
        }

        const uptime = formatElapsed(Date.now() - this.sessionStartTime);
        const statusLine =
          parts.join(C.text5 + " · " + RST) +
          "  " + C.text5 + "─ " + elapsed + " ─" + RST +
          "  " + DIM + C.text5 + "⏱" + uptime + RST;

        this.err.write(renderPanelDivider(w, "status"));
        this.err.write("\n");
        this.err.write(renderPanelLine("  " + statusLine, w));
        this.err.write("\n");
        this.err.write(renderPanelBottom(w));
        this.err.write("\n");
        // Input prompt at bottom
        this.err.write(renderPanelTop(w, "input"));
        this.err.write("\n");
        this.err.write(renderPanelLine(C.cyan + "  › " + RST + DIM + "type your message..." + RST, w));
        this.err.write("\n");
        this.err.write(renderPanelBottom(w));
        this.err.write("\n\n");
        this.err.write("\n\n");
        break;
      }

      case "session:stop":
        break;
    }
  }

  setThinkingSummary(summary: string | undefined): void {
    this.thinkingSummary = summary;
  }

  stop(): void {}
}
