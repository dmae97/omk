/**
 * OMK brand color palette — hex values and conversion helpers.
 */

export const P = {
  purple: { r: 157, g: 78, b: 221 },        // #9D4EDD  orchestration/control accent
  lightPurple: { r: 214, g: 108, b: 255 },  // #D66CFF  neon highlight
  darkPurple: { r: 64, g: 18, b: 133 },     // #401285  deep control shadow
  pink: { r: 255, g: 71, b: 178 },          // #FF47B2  control/focus accent
  hotPink: { r: 255, g: 71, b: 178 },       // #FF47B2  hot accent (alias)
  mint: { r: 0, g: 255, b: 194 },           // #00FFC2  telemetry/success
  darkMint: { r: 0, g: 196, b: 153 },       // #00C499  telemetry shadow
  orange: { r: 255, g: 176, b: 0 },         // #FFB000  warning/pending
  red: { r: 255, g: 88, b: 116 },           // #FF5874  fault/danger
  blue: { r: 0, g: 214, b: 255 },           // #00D6FF  route/signal/info
  cream: { r: 232, g: 248, b: 255 },        // #E8F8FF  bright console text
  dark: { r: 7, g: 11, b: 20 },             // #070B14  cockpit background
  gray: { r: 117, g: 143, b: 168 },         // #758FA8  muted telemetry
  skin: { r: 255, g: 214, b: 102 },         // #FFD666  metric gold
  rustOrange: { r: 249, g: 115, b: 22 },    // #F97316  Rust/native toolchain accent
  rustOxide: { r: 124, g: 45, b: 18 },      // #7C2D12  Rust/native warning shadow
  cargoGreen: { r: 0, g: 255, b: 194 },     // #00FFC2  verified native check
  matrixGreen: { r: 0, g: 255, b: 194 },    // #00FFC2  OMK signal phosphor
  matrixDark: { r: 8, g: 39, b: 31 },       // #08271F  success/signal background
  matrixRainGreen: { r: 0, g: 255, b: 65 },  // #00FF41  iconic Matrix rain code green
  matrixDeepBg: { r: 0, g: 8, b: 0 },       // #000800  matrix rain deep background
  matrixRainDim: { r: 0, g: 95, b: 25 },    // #005F19  matrix rain dark green
  matrixWarningAmber: { r: 255, g: 176, b: 0 }, // #FFB000  matrix warning amber
  matrixErrorRed: { r: 255, g: 50, b: 50 }, // #FF3232  matrix error red

  // ── Metrics theme (professional dashboard) ──
  metricsCyan: { r: 6, g: 182, b: 212 },    // #06B6D4  Metrics primary
  metricsTeal: { r: 20, g: 184, b: 166 },   // #14B8A6  Metrics secondary (same as mint)
  metricsNavy: { r: 10, g: 25, b: 41 },     // #0A1929  Metrics bg dark
  metricsSlate: { r: 30, g: 41, b: 59 },    // #1E293B  Metrics bg light
  metricsSilver: { r: 203, g: 213, b: 225 }, // #CBD5E1  Metrics muted text
  metricsWhite: { r: 241, g: 245, b: 249 }, // #F1F5F9  Metrics bright
  metricsAmber: { r: 245, g: 158, b: 11 },  // #F59E0B  Metrics warning
  metricsGreen: { r: 34, g: 197, b: 94 },   // #22C55E  Metrics success
  metricsRed: { r: 239, g: 68, b: 68 },     // #EF4444  Metrics error
  metricsBlue: { r: 59, g: 130, b: 246 },   // #3B82F6  Metrics info
  metricsViolet: { r: 139, g: 92, b: 246 }, // #8B5CF6  Metrics highlight
} as const;

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.replace("#", "").trim();
  const m = normalized.match(/^(?:[0-9a-fA-F]{3}){1,2}$/);
  if (!m) return null;
  const full = normalized.length === 3 ? normalized.split("").map((c) => c + c).join("") : normalized;
  const num = parseInt(full, 16);
  return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff };
}

export function colorFromHex(
  hex: string | undefined,
  fallback: { r: number; g: number; b: number }
): { r: number; g: number; b: number } {
  return hexToRgb(hex ?? "") ?? fallback;
}
