/**
 * OMK Chat Cockpit — compact read-only run-state sidecar.
 * Barrel re-exporting all public surfaces from the cockpit/ submodules.
 */

export { visibleTerminalWidth } from "../util/terminal-layout.js";

export type {
  CockpitCommandOptions,
  CockpitRenderOptions,
  CockpitCache,
  CockpitResourceEntry,
  CockpitResourceSnapshot,
  CockpitDeepSeekBalanceLine,
  CockpitDeepSeekSnapshot,
} from "./cockpit/utils.js";

export type { RenderMode } from "./cockpit/update-loop.js";
export { CockpitRenderer } from "./cockpit/update-loop.js";

export { renderCockpit } from "./cockpit/render.js";

export { cockpitCommand } from "./cockpit/core.js";
