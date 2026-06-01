import type { MetricSnapshot, HudRenderer } from "../contracts/hud.js";
import type { RunState } from "../contracts/orchestration.js";
import { renderHudDashboard } from "../commands/hud.js";

export interface LiveHudRendererOptions {
  runId?: string;
  refreshMs?: number;
}

export class LiveHudRenderer implements HudRenderer {
  private runId?: string;
  private refreshMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private renderSeq = 0;

  constructor(options: LiveHudRendererOptions = {}) {
    this.runId = options.runId;
    this.refreshMs = options.refreshMs ?? 5000;
  }

  async start(): Promise<void> {
    await this.renderFrame();
    this.timer = setInterval(() => {
      void this.renderFrame();
    }, this.refreshMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  render(state: RunState | null, metrics: MetricSnapshot): void {
    if (this.renderSeq >= 10000) {
      this.stop();
      console.warn("[LiveHudRenderer] max render iterations exceeded (10000); stopping to prevent runaway");
      return;
    }
    const seq = ++this.renderSeq;
    void renderHudDashboard({ runId: state?.runId }).then((frame) => {
      if (seq !== this.renderSeq) return;
      process.stdout.write(frame + "\n");
    });
    void state;
    void metrics;
  }

  private async renderFrame(): Promise<void> {
    if (this.renderSeq >= 10000) {
      this.stop();
      console.warn("[LiveHudRenderer] max render iterations exceeded (10000); stopping to prevent runaway");
      return;
    }
    const seq = ++this.renderSeq;
    process.stdout.write("\x1b[2J\x1b[H");
    const frame = await renderHudDashboard({ runId: this.runId, footerRefreshMs: this.refreshMs });
    if (seq !== this.renderSeq) return;
    process.stdout.write(frame + "\n");
  }
}
