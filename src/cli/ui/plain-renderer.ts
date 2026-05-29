/**
 * PlainModernRenderer — opencode-style minimal CLI output.
 *
 * Pattern: `> provider · model` header + clean output.
 * No route cards, no box drawing, no verbose banners.
 */
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

export class PlainModernRenderer implements CliRenderer {
  private readonly stdout: WritableStreamLike;
  private readonly stderr: WritableStreamLike;
  private heartbeatOpen = false;
  private headerShown = false;

  constructor(streams: PlainRendererStreams = {}) {
    this.stdout = streams.stdout ?? process.stdout;
    this.stderr = streams.stderr ?? process.stderr;
  }

  start(): void {}

  emit(event: CliUiEvent): void {
    switch (event.type) {
      case "session:start": {
        // opencode style: `> provider · model` — show once before first response
        const provider = event.provider === "auto" ? "omk" : event.provider;
        const model = event.model ?? "auto";
        this.stderr.write(`\n> ${provider} · ${model}\n\n`);
        this.headerShown = true;
        break;
      }
      case "input:submitted":
        this.stderr.write(`› ${event.text}\n\n`);
        break;
      case "prompt:ready":
        // No prompt indicator — opencode style is clean
        break;
      case "control:output":
        if (this.heartbeatOpen) {
          this.stderr.write("\n");
          this.heartbeatOpen = false;
        }
        this.stderr.write(sanitizeUserVisibleOutput(event.text));
        break;
      case "turn:route":
        // opencode shows no route card — skip entirely
        break;
      case "turn:heartbeat": {
        const seconds = Math.floor(event.elapsedMs / 1000);
        const line = `  ⠋ ${seconds}s`;
        if (this.stderr.isTTY) {
          this.stderr.write(`\r${line}   `);
          this.heartbeatOpen = true;
        }
        break;
      }
      case "assistant:final":
        if (this.heartbeatOpen) {
          this.stderr.write("\r                    \r");
          this.heartbeatOpen = false;
        }
        this.stdout.write(event.text.endsWith("\n") ? event.text : `${event.text}\n`);
        break;
      case "turn:error":
        if (this.heartbeatOpen) {
          this.stderr.write("\r                    \r");
          this.heartbeatOpen = false;
        }
        this.stderr.write(`\n  ✖ ${sanitizeUserVisibleOutput(event.message)}\n\n`);
        break;
      case "turn:finish":
        if (this.heartbeatOpen) {
          this.stderr.write("\r                    \r");
          this.heartbeatOpen = false;
        }
        // opencode shows nothing on finish — clean exit
        break;
      case "turn:start":
        break;
      case "session:stop":
        // opencode shows nothing on session end
        break;
    }
  }

  setThinkingSummary(_summary: string | undefined): void {}
  stop(): void {}
}
