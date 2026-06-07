/**
 * OMK Chat Cockpit — compatibility facade for the modular cockpit runtime.
 */

export type {
  CockpitCache,
  CockpitCommandOptions,
  CockpitRenderOptions,
} from "./cockpit/utils.js";

export { cockpitCommand } from "./cockpit/core.js";
export { renderCockpit } from "./cockpit/render.js";
export {
  CockpitRenderer,
  DEFAULT_COCKPIT_HEIGHT,
  MAX_COCKPIT_HEIGHT,
  MIN_COCKPIT_HEIGHT,
  clearScreen,
  getTerminalWidth,
  normalizeCockpitFrameHeight,
  normalizeCockpitWatchFrameHeight,
} from "./cockpit/update-loop.js";
export { visibleTerminalWidth } from "../util/terminal-layout.js";
