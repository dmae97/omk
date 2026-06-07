/**
 * OMK Theme — Barrel export for all theme modules
 * Replaces util/theme.ts God Module with focused submodules
 */

// ANSI & text utilities
export {
  colorEnabled,
  isColorEnabled,
  esc,
  rgb,
  bgRgb,
  sanitizeTerminalText,
  visibleTerminalWidth,
  stripAnsi,
  stripBrokenAnsi,
  padEndAnsi,
} from "./ansi.js";

// Brand colors & semantic status
export { style, status, glyph } from "./colors.js";

// Layout primitives
export {
  header,
  subheader,
  separator,
  bullet,
  label,
  box,
  gradient,
  gauge,
  panel,
  sparkleHeader,
  matrixHeader,
  omkHudHeader,
  stat,
} from "./layout.js";

// Metrics panels & system usage
export {
  metricsPanel,
  metricsGauge,
  metricsGradient,
  metricsHeader,
  metricsStat,
  metricsMatrixHeader,
  getSystemUsage,
} from "./metrics.js";

// Parallel execution UI, banners, badges
export {
  emoji,
  omkStatusChips,
  omkCliHero,
  omkMetaBox,
  OmkThemeConfig,
  loadThemeConfig,
  omkBanner,
  roleColor,
  parallelStatusBadge,
  workerLabel,
  safetyChip,
  ensembleQuorumBar,
  workerOutputBox,
  approvalPromptBox,
  orangeBold,
} from "./parallel.js";

// Re-export palette symbols used by consumers
export { P, hexToRgb, colorFromHex } from "../brand/palette.js";

// HUD Theme contract implementation
export { hudTheme } from "./hud-theme.js";

// Working indicator — gradient-animated status line
export {
  renderWorkingIndicator,
  renderCompactWorking,
  renderWorkingPanel,
  type WorkingPhase,
  type WorkingSpinner,
} from "./working-indicator.js";
