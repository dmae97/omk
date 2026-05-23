import { getKimiUsage, type UsageStats } from "../kimi/usage.js";
import {
  renderHudDashboard,
  normalizeRefreshMs,
  sleep,
  clearScreen,
  enterAlternateScreen,
  leaveAlternateScreen,
  type HudRenderOptions,
  type HudCommandOptions,
} from "../hud/render.js";

export type {
  HudGitChange,
  HudRunCandidate,
  HudSection,
  HudRenderOptions,
  HudCommandOptions,
} from "../hud/render.js";

export {
  parseGitStatusPorcelain,
  buildHudSidebar,
  renderHudColumns,
  renderHudColumnsWithDetectedWidth,
  renderHudDashboard,
  selectLatestRunName,
  listRunCandidates,
} from "../hud/render.js";

export async function hudCommand(options: HudCommandOptions = {}): Promise<void> {
  const refreshMs = normalizeRefreshMs(options.refreshMs);

  if (!options.watch) {
    console.log(await renderHudDashboard(options));
    return;
  }

  let stopped = false;
  const stop = (): void => {
    stopped = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  let cachedUsage: UsageStats | undefined;
  let lastUsageRefreshMs = 0;
  const usageRefreshMs = Math.max(60_000, refreshMs);

  const useAlternateScreen = options.alternateScreen ?? false;
  const shouldClear = !(options.noClear ?? false) && (options.clear ?? true);

  if (useAlternateScreen) {
    enterAlternateScreen();
  }

  try {
    let lastFrame = "";
    while (!stopped) {
      const now = Date.now();
      if (!cachedUsage || now - lastUsageRefreshMs >= usageRefreshMs) {
        cachedUsage = await getKimiUsage();
        lastUsageRefreshMs = now;
      }
      const frame = await renderHudDashboard({ ...options, kimiUsage: cachedUsage, footerRefreshMs: refreshMs });
      if (frame !== lastFrame) {
        lastFrame = frame;
        if (shouldClear) clearScreen();
        process.stdout.write(frame + "\n");
      }
      if (stopped) break;
      await sleep(refreshMs);
    }
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    if (useAlternateScreen) {
      leaveAlternateScreen();
    }
  }
}
