/**
 * OMK brand color palette — hex values and conversion helpers.
 */

export const P = {
  purple: { r: 123, g: 91, b: 245 },        // #7B5BF5  Primary brand
  lightPurple: { r: 167, g: 139, b: 250 },  // #A78BFA  Soft highlights
  darkPurple: { r: 91, g: 33, b: 182 },     // #5B21B6  Deep shadows
  pink: { r: 236, g: 72, b: 153 },          // #EC4899  Accent
  hotPink: { r: 236, g: 72, b: 153 },       // #EC4899  Accent (alias)
  mint: { r: 20, g: 184, b: 166 },          // #14B8A6  Success
  darkMint: { r: 13, g: 148, b: 136 },      // #0D9488  Mint shadow
  orange: { r: 251, g: 146, b: 60 },        // #FB923C  Warning
  red: { r: 248, g: 113, b: 113 },          // #F87171  Error
  blue: { r: 96, g: 165, b: 250 },          // #60A5FA  Info
  cream: { r: 243, g: 232, b: 255 },        // #F3E8FF  Bright text
  dark: { r: 36, g: 28, b: 50 },            // #241C32  Background
  gray: { r: 148, g: 163, b: 184 },         // #94A3B8  Muted
  skin: { r: 249, g: 211, b: 197 },         // #F9D3C5  Warm skin tone
  matrixGreen: { r: 0, g: 255, b: 65 },     // #00FF41  Matrix phosphor green
  matrixDark: { r: 0, g: 68, b: 0 },        // #004400  Matrix dark green

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
