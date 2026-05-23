import { hudCommand } from "../commands/hud.js";

export type {
  HudGitChange,
  HudRunCandidate,
  HudCommandOptions,
  HudRenderOptions,
} from "./render.js";

export {
  parseGitStatusPorcelain,
  buildHudSidebar,
  renderHudColumns,
  renderHudColumnsWithDetectedWidth,
  renderHudDashboard,
  selectLatestRunName,
} from "./render.js";

export interface CreateLiveHudOptions {
  runId?: string;
  refreshMs?: number;
  onRender?: (frame: string) => void;
}

export async function createLiveHud(options: CreateLiveHudOptions = {}): Promise<void> {
  if (options.onRender) {
    const { renderHudDashboard } = await import("./render.js");
    options.onRender(await renderHudDashboard({ runId: options.runId }));
    return;
  }
  await hudCommand({ runId: options.runId, watch: true, refreshMs: options.refreshMs });
}

export { LiveHudRenderer } from "./live-renderer.js";
