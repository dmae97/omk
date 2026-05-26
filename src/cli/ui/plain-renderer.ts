import type { CliUiEvent } from "./event.js";
import type { CliRenderer } from "./renderer.js";
import { sanitizeUserVisibleOutput } from "../../util/user-visible-output.js";

interface WritableStreamLike {
  write(chunk: string): unknown;
  isTTY?: boolean;
}

export interface PlainRendererStreams {
  stdout?: WritableStreamLike;
  stderr?: WritableStreamLike;
}

export function renderRouteCard(input: Extract<CliUiEvent, { type: "turn:route" }>): string {
  const lines = [
    "◇ Route",
    `  provider  ${input.provider}`,
    `  model     ${input.model ?? "auto"}`,
    `  risk      ${input.risk}`,
    `  sandbox   ${input.sandbox}`,
    input.mcp && input.mcp.length > 0 ? `  mcp       ${input.mcp.join(", ")}` : undefined,
    input.skills && input.skills.length > 0 ? `  skills    ${input.skills.join(", ")}` : undefined,
    input.hooks && input.hooks.length > 0 ? `  hooks     ${input.hooks.join(", ")}` : undefined,
  ].filter((line): line is string => Boolean(line));
  return `${lines.join("\n")}\n`;
}

export function renderAssistantCard(text: string): string {
  const safeText = sanitizeUserVisibleOutput(text);
  const body = safeText.endsWith("\n") ? safeText.slice(0, -1) : safeText;
  return body ? `\n● Assistant\n${body}\n` : "";
}

export class PlainModernRenderer implements CliRenderer {
  private readonly stdout: WritableStreamLike;
  private readonly stderr: WritableStreamLike;
  private heartbeatOpen = false;

  constructor(streams: PlainRendererStreams = {}) {
    this.stdout = streams.stdout ?? process.stdout;
    this.stderr = streams.stderr ?? process.stderr;
  }

  start(): void {}

  emit(event: CliUiEvent): void {
    switch (event.type) {
      case "session:start":
        this.stderr.write(`╭─ OMK Agent Console ─ ${event.runId}\n`);
        this.stderr.write(`│ provider ${event.provider}  model ${event.model ?? "auto"}  layout ${event.layout ?? "plain"}\n`);
        this.stderr.write("╰────────────────────────────────────────\n");
        break;
      case "input:submitted":
        this.stderr.write(`\n› ${event.text}\n\n`);
        break;
      case "prompt:ready":
        this.stderr.write("› ");
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
        const line = `◌ Running ${seconds}s · provider ${event.provider ?? "auto"} · model ${event.model ?? "auto"}`;
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
          this.stderr.write("\n");
          this.heartbeatOpen = false;
        }
        this.stdout.write(renderAssistantCard(event.text));
        break;
      case "turn:error":
        if (this.heartbeatOpen) {
          this.stderr.write("\n");
          this.heartbeatOpen = false;
        }
        this.stderr.write(`✖ Error\n  ${sanitizeUserVisibleOutput(event.message)}\n`);
        break;
      case "turn:finish": {
        if (this.heartbeatOpen) {
          this.stderr.write("\n");
          this.heartbeatOpen = false;
        }
        const seconds = (event.durationMs / 1000).toFixed(1);
        this.stderr.write(`● Finished ${seconds}s · exit ${event.exitCode}\n`);
        break;
      }
      case "turn:start":
        break;
      case "session:stop":
        this.stderr.write(event.exitCode === 0 ? "\nSession ended.\n" : `\nSession ended with exit ${event.exitCode}.\n`);
        break;
    }
  }

  stop(): void {}
}
