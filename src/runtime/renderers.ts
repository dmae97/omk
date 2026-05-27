/**
 * Renderers — three output strategies for OmkEvent consumption.
 *
 * ThemeRenderer: rich terminal output using ThemePalette for semantic colors.
 * NlpRenderer: bilingual (KO/EN) structured NLP output for provider consumption.
 * JsonRenderer: structured JSON output for programmatic consumption.
 *
 * Invariant I-004: provider stdout MUST NOT bypass the router.
 */

import type { OmkEvent, OmkEventData, OutputFormat } from "./contracts/command-envelope.js";
import type { ThemePalette, SemanticToken } from "../cli/theme/theme-registry.js";
import { t } from "../util/i18n.js";

// ─── Fallback ANSI helpers (used when no ThemePalette provided) ─────────────

const ESC = "\x1b[";
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const CYAN = `${ESC}36m`;
const MAGENTA = `${ESC}35m`;

function fallbackColorize(text: string, ...codes: string[]): string {
  return `${codes.join("")}${text}${RESET}`;
}

function padRight(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function progressBar(percent: number, width = 24): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  const bar = `${"█".repeat(filled)}${"░".repeat(empty)}`;
  return `${bar} ${clamped.toFixed(0)}%`;
}

function timestamp(): string {
  return new Date().toISOString().slice(11, 23);
}

// ─── ThemePalette helpers ───────────────────────────────────────────────────

/**
 * Render text with a semantic token from the palette.
 * Falls back to plain text if no palette or palette doesn't support color.
 */
function themed(palette: ThemePalette | undefined, token: SemanticToken, text: string): string {
  if (!palette || !palette.supportsColor) return text;
  return palette.render(token, text);
}

/**
 * Render text with dim styling.
 */
function dim(palette: ThemePalette | undefined, text: string): string {
  if (!palette || !palette.supportsColor) return fallbackColorize(text, DIM);
  return palette.render("dim", text);
}

/**
 * Render text with bold styling.
 */
function bold(palette: ThemePalette | undefined, text: string): string {
  if (!palette || !palette.supportsColor) return fallbackColorize(text, BOLD);
  return palette.render("bold", text);
}

// ─── ThemeRenderer ───────────────────────────────────────────────────────────

export interface ThemeRenderer {
  renderTurnStarted(intent: string, provider: string): void;
  renderProgress(message: string, percent?: number): void;
  renderMcpStatus(server: string, status: string): void;
  renderWarning(message: string): void;
  renderResult(content: string): void;
  renderError(message: string, recoverable: boolean): void;
  renderTurnFinished(durationMs: number): void;
  flush(): void;
}

export function createThemeRenderer(
  write: (text: string) => void = process.stdout.write.bind(process.stdout),
  palette?: ThemePalette,
): ThemeRenderer {
  function emit(line: string): void {
    write(line + "\n");
  }

  return {
    renderTurnStarted(intent: string, provider: string): void {
      const tag = themed(palette, "success", padRight(" START ", 8));
      const ts = dim(palette, timestamp());
      const intentColored = themed(palette, "info", intent);
      const providerColored = themed(palette, "agent", provider);
      emit(`${tag} ${ts} intent=${intentColored} provider=${providerColored}`);
    },

    renderProgress(message: string, percent?: number): void {
      const tag = themed(palette, "warning", padRight(" ... ", 8));
      const ts = dim(palette, timestamp());
      const bar = percent !== undefined ? ` ${progressBar(percent)}` : "";
      emit(`${tag} ${ts} ${message}${bar}`);
    },

    renderMcpStatus(server: string, status: string): void {
      const ts = dim(palette, timestamp());
      let statusColored: string;
      switch (status) {
        case "connected":
          statusColored = themed(palette, "success", status);
          break;
        case "failed":
          statusColored = themed(palette, "error", status);
          break;
        default:
          statusColored = themed(palette, "warning", status);
      }
      const mcpLabel = dim(palette, "MCP");
      const serverColored = themed(palette, "tool", server);
      emit(`  ${mcpLabel}  ${ts} ${serverColored} → ${statusColored}`);
    },

    renderWarning(message: string): void {
      const tag = themed(palette, "warning", padRight(" WARN ", 8));
      const ts = dim(palette, timestamp());
      emit(`${tag} ${ts} ${message}`);
    },

    renderResult(content: string): void {
      const tag = themed(palette, "success", padRight(" OK ", 8));
      const ts = dim(palette, timestamp());
      const lines = content.split("\n");
      for (const line of lines) {
        emit(`${tag} ${ts} ${line}`);
      }
    },

    renderError(message: string, recoverable: boolean): void {
      const label = recoverable ? "RECOVERABLE" : "FATAL";
      const tag = themed(palette, "error", padRight(` ${label} `, 13));
      const ts = dim(palette, timestamp());
      emit(`${tag} ${ts} ${themed(palette, "error", message)}`);
    },

    renderTurnFinished(durationMs: number): void {
      const tag = themed(palette, "success", padRight(" END ", 8));
      const ts = dim(palette, timestamp());
      const dur = durationMs >= 1000
        ? `${(durationMs / 1000).toFixed(1)}s`
        : `${durationMs}ms`;
      emit(`${tag} ${ts} turn finished in ${themed(palette, "info", dur)}`);
    },

    flush(): void {
      // Theme renderer flushes on each emit; nothing buffered.
    },
  };
}

// ─── NlpRenderer (bilingual KO/EN) ──────────────────────────────────────────

export interface NlpRenderer {
  render(event: OmkEvent): string;
  flush(): string;
}

/**
 * Bilingual NLP message templates.
 * Uses the existing i18n system (t()) for KO/EN support.
 */
const nlpMessages = {
  turnStarted: (intent: string, provider: string) =>
    t("nlp.turnStarted", intent, provider),
  progress: (message: string) =>
    t("nlp.progress", message),
  progressWithPercent: (message: string, percent: string) =>
    t("nlp.progressWithPercent", message, percent),
  mcpStatus: (server: string, status: string) =>
    t("nlp.mcpStatus", server, status),
  warning: (message: string) =>
    t("nlp.warning", message),
  result: (content: string) =>
    t("nlp.result", content),
  recoverableError: (message: string) =>
    t("nlp.recoverableError", message),
  fatalError: (message: string) =>
    t("nlp.fatalError", message),
  turnFinished: (duration: string) =>
    t("nlp.turnFinished", duration),
  event: (type: string) =>
    t("nlp.event", type),
};

export function createNlpRenderer(): NlpRenderer {
  const lines: string[] = [];

  function renderEventData(data: OmkEventData): string {
    switch (data.kind) {
      case "turn_started":
        return nlpMessages.turnStarted(data.intent, data.provider);
      case "progress":
        return data.percent !== undefined
          ? nlpMessages.progressWithPercent(data.message, data.percent.toFixed(0))
          : nlpMessages.progress(data.message);
      case "mcp_status":
        return nlpMessages.mcpStatus(data.server, data.status);
      case "warning":
        return nlpMessages.warning(data.message);
      case "result":
        return nlpMessages.result(data.content);
      case "error":
        return data.recoverable
          ? nlpMessages.recoverableError(data.message)
          : nlpMessages.fatalError(data.message);
      case "turn_finished": {
        const dur = data.durationMs >= 1000
          ? `${(data.durationMs / 1000).toFixed(1)}s`
          : `${data.durationMs}ms`;
        return nlpMessages.turnFinished(dur);
      }
    }
  }

  return {
    render(event: OmkEvent): string {
      const text = event.data
        ? renderEventData(event.data)
        : nlpMessages.event(event.type);
      lines.push(text);
      return text;
    },

    flush(): string {
      const output = lines.join("\n");
      lines.length = 0;
      return output;
    },
  };
}

// ─── JsonRenderer ────────────────────────────────────────────────────────────

export interface JsonRenderer {
  render(event: OmkEvent): object;
  flush(): object[];
}

export function createJsonRenderer(): JsonRenderer {
  const records: object[] = [];

  return {
    render(event: OmkEvent): object {
      const record = {
        type: event.type,
        timestamp: event.timestamp,
        ...(event.turnId !== undefined ? { turnId: event.turnId } : {}),
        ...(event.data !== undefined ? { data: event.data } : {}),
      };
      records.push(record);
      return record;
    },

    flush(): object[] {
      const output = [...records];
      records.length = 0;
      return output;
    },
  };
}
