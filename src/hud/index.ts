import { hudCommand } from "../commands/hud.js";

export type {
  HudGitChange,
  HudRunCandidate,
  HudCommandOptions,
  HudRenderOptions,
} from "../commands/hud.js";

export {
  parseGitStatusPorcelain,
  buildHudSidebar,
  renderHudColumns,
  renderHudColumnsWithDetectedWidth,
  renderHudDashboard,
  selectLatestRunName,
  hudCommand,
} from "../commands/hud.js";

export interface CreateLiveHudOptions {
  runId?: string;
  refreshMs?: number;
  onRender?: (frame: string) => void;
}

export async function createLiveHud(options: CreateLiveHudOptions = {}): Promise<void> {
  if (options.onRender) {
    const { renderHudDashboard } = await import("../commands/hud.js");
    options.onRender(await renderHudDashboard({ runId: options.runId }));
    return;
  }
  await hudCommand({ runId: options.runId, watch: true, refreshMs: options.refreshMs });
}

export { LiveHudRenderer } from "./live-renderer.js";
