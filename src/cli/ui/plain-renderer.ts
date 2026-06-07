/**
 * PlainModernRenderer — opencode-style minimal CLI output.
 *
 * Pattern: `> provider · model` header + clean output.
 * No route cards, no box drawing, no verbose banners.
 */
import type { CliUiEvent } from "./event.js";
import type { CliRenderer } from "./renderer.js";
import { sanitizeUserVisibleOutput } from "../../util/user-visible-output.js";
import { isUnsupportedRuntimeError, renderRouteBlockedPanel } from "./route-blocked-panel.js";

const ESC = "\x1b[";

interface WritableStreamLike {
  write(chunk: string): unknown;
  isTTY?: boolean;
  rows?: number;
}

export interface PlainRendererStreams {
  stdout?: WritableStreamLike;
  stderr?: WritableStreamLike;
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function termRows(stream: WritableStreamLike): number {
  const rows = stream.rows ?? process.stderr.rows ?? 24;
  return Number.isFinite(rows) ? Math.max(10, rows) : 24;
}

function shouldUseTerminalControls(stream: WritableStreamLike): boolean {
  return stream.isTTY === true && process.env.TERM !== "dumb";
}

function countRows(chunk: string): number {
  return (chunk.match(/\n/g) ?? []).length;
}

function joinList(values: readonly string[] | undefined): string {
  return values && values.length > 0 ? values.join(", ") : "none";
}

export function renderRouteCard(event: Extract<CliUiEvent, { type: "turn:route" }>): string {
  const lines = [
    "◇ Route",
    `provider  ${event.provider}`,
    `model     ${event.model ?? "auto"}`,
    `risk      ${event.risk}`,
    `sandbox   ${event.sandbox}`,
    `mcp       ${joinList(event.mcp)}`,
    `skills    ${joinList(event.skills)}`,
    `hooks     ${joinList(event.hooks)}`,
  ];
  return `${lines.join("\n")}\n`;
}

export function renderAssistantCard(text: string): string {
  return `\n● Assistant\n${ensureTrailingNewline(sanitizeUserVisibleOutput(text))}`;
}

export class PlainModernRenderer implements CliRenderer {
  private readonly stdout: WritableStreamLike;
  private readonly stderr: WritableStreamLike;
  private heartbeatOpen = false;
  private promptOpen = false;
  private alternateScreenActive = false;
  private stickyScrollRegionActive = false;

  constructor(streams: PlainRendererStreams = {}) {
    this.stdout = streams.stdout ?? process.stdout;
    this.stderr = streams.stderr ?? process.stderr;
  }

  start(): void {
    this.stickyScrollRegionActive = false;
    this.alternateScreenActive = shouldUseTerminalControls(this.stderr);
    if (this.alternateScreenActive) {
      this.writeStderrControl(`${ESC}?1049h${ESC}2J${ESC}H`);
    }
  }

  emit(event: CliUiEvent): void {
    switch (event.type) {
      case "session:start": {
        const provider = event.provider === "auto" ? "omk" : event.provider;
        const model = event.model ?? "auto";
        const header = `\nOMK Agent Console\n> ${provider} · ${model}\n\n`;
        this.stderr.write(header);
        this.activateStickyScrollRegion(countRows(header));
        break;
      }
      case "input:submitted":
        if (this.promptOpen) {
          if (!this.stderr.isTTY) this.stderr.write(event.text);
          this.stderr.write("\n\n");
          this.promptOpen = false;
        } else {
          this.stderr.write(`› ${event.text}\n\n`);
        }
        break;
      case "prompt:ready":
        if (!this.promptOpen) {
          this.stderr.write("› ");
          this.promptOpen = true;
        }
        break;
      case "control:output":
        if (this.heartbeatOpen) {
          this.stderr.write("\n");
          this.heartbeatOpen = false;
        }
        this.stderr.write(sanitizeUserVisibleOutput(event.text));
        break;
      case "turn:route":
        this.stderr.write(renderRouteCard(event));
        break;
      case "turn:heartbeat": {
        const seconds = Math.floor(event.elapsedMs / 1000);
        const activity = event.activity ?? `routing ${event.provider ?? "auto"} turn`;
        const truncated = activity.length > 72 ? activity.slice(0, 69) + "..." : activity;
        const line = `◌ ${truncated} · ${seconds}s`;
        if (this.stderr.isTTY) {
          this.stderr.write(`\r${line}   `);
          this.heartbeatOpen = true;
        } else {
          this.stderr.write(`${line}\n`);
        }
        break;
      }
      case "assistant:final":
        if (this.heartbeatOpen) {
          this.stderr.write("\r                    \r");
          this.heartbeatOpen = false;
        }
        this.stdout.write(renderAssistantCard(event.text));
        break;
      case "turn:error":
        if (this.heartbeatOpen) {
          this.stderr.write("\r                    \r");
          this.heartbeatOpen = false;
        }
        {
          const errMsg = sanitizeUserVisibleOutput(event.message);
          const rendered = isUnsupportedRuntimeError(errMsg)
            ? renderRouteBlockedPanel(errMsg)
            : `  ✖ ${errMsg}`;
          this.stderr.write(`\n${rendered}\n\n`);
        }
        break;
      case "turn:finish":
        if (this.heartbeatOpen) {
          this.stderr.write("\r                    \r");
          this.heartbeatOpen = false;
        }
        this.stderr.write(`● Finished ${(event.durationMs / 1000).toFixed(1)}s · exit ${event.exitCode}\n`);
        break;
      case "turn:start":
        break;
      case "session:stop":
        // opencode shows nothing on session end
        break;
    }
  }

  setThinkingSummary(_summary: string | undefined): void {}

  private writeStderrControl(chunk: string): void {
    this.stderr.write(chunk);
  }

  private activateStickyScrollRegion(headerRows: number): void {
    if (!this.alternateScreenActive || this.stickyScrollRegionActive) return;
    const rows = termRows(this.stderr);
    const top = Math.min(rows - 1, Math.max(2, headerRows + 1));
    if (top >= rows) return;
    this.writeStderrControl(`${ESC}${top};${rows}r${ESC}${top};1H`);
    this.stickyScrollRegionActive = true;
  }

  stop(): void {
    if (this.alternateScreenActive) {
      this.writeStderrControl(`${ESC}r${ESC}?1049l`);
      this.alternateScreenActive = false;
      this.stickyScrollRegionActive = false;
    }
  }
}
