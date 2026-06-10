/**
 * OMK Theme — Extended palette (data-only color module).
 *
 * Single declared home for color VALUES that have no matching night-city
 * primitive and therefore cannot derive from `src/brand` theme tokens:
 *   - sigil/working-sweep neon ramps (bespoke UI animation colors),
 *   - the ontology graph-viewer web/SVG palette (HTML document colors),
 *   - the `omk design init` DESIGN.md scaffold defaults (generated-project
 *     content written into a user repo, not OMK render debt).
 *
 * Every other module imports these tokens instead of inlining hex literals, so
 * the literals live here exactly ONCE. `BRAND_HEX` is imported as the
 * theme-derived base: any extended token that coincides with a night-city
 * value (sparkle white/gold) is re-derived from BRAND_HEX rather than
 * re-declared, keeping the night-city document the single source of truth.
 *
 * This file is intentionally data-only and is the sole `permanent` color
 * allowlist entry outside `src/cli/theme/**` (see scripts/color-allowlist.json).
 * Do NOT add render logic here, and do NOT widen BRAND_HEX (frozen elsewhere).
 */

import { BRAND_HEX } from "../brand/palette.js";

/**
 * Neon ramp shared by src/ui/omk-sigil.ts and src/ui/omk-working-sweep.ts.
 * These hues are deliberately brighter/saturated than the night-city console
 * primitives (e.g. cyan #00FFD1 ≠ night-city cyan #00D6FF) and must stay byte
 * stable for the deterministic sweep animation. `amber`/`white` coincide with
 * the night-city sparkle ramp and are re-derived from BRAND_HEX.
 */
export const SIGIL_NEON = {
  red: "#ff1b1b",
  hot: "#ff315d",
  orange: "#ff7a18",
  amber: BRAND_HEX.sparkleGold, // #FFD166 — night-city sparkle gold
  cyan: "#00ffd1",
  cyan2: "#00aaff",
  green: "#00ff88",
  magenta: "#ff2bd6",
  white: BRAND_HEX.sparkleWhite, // #F4FFFF — night-city sparkle white
  dim: "#2b6f6a",
  dim2: "#13403d",
  darkRed: "#6d1717",
} as const;

/**
 * Ontology graph-viewer (src/memory/graph-viewer.ts) palette. These are HTML
 * document / cytoscape stylesheet colors (web design system, not terminal
 * brand), emitted verbatim into the generated .html file.
 */
export const GRAPH_VIEWER = {
  /** Node fill keyed by ontology node type. */
  typeColors: {
    Project: "#7c3aed",
    Session: "#2563eb",
    Memory: "#059669",
    MemoryVersion: "#6b7280",
    Run: "#14b8a6",
    Goal: "#f59e0b",
    Topic: "#64748b",
    Decision: "#dc2626",
    Task: "#ea580c",
    Risk: "#be123c",
    Command: "#0f766e",
    File: "#0891b2",
    Evidence: "#16a34a",
    Provider: "#a855f7",
    ProviderRoute: "#8b5cf6",
    ProviderFallback: "#f97316",
    AuditLink: "#eab308",
    Constraint: "#9333ea",
    Question: "#0284c7",
    Answer: "#22c55e",
    Concept: "#4f46e5",
  } as Record<string, string>,
  /** Fallback node fill for unknown types. */
  defaultNode: "#94a3b8",
  /** HTML/cytoscape chrome colors. */
  ui: {
    bodyBg: "#0f172a",
    bodyFg: "#e5e7eb",
    topBg: "#111827",
    topBorder: "#334155",
    inputBg: "#020617",
    inputBorder: "#475569",
    statText: "#94a3b8",
    pillText: "#c4b5fd",
    pillBg: "#312e81",
    pillBorder: "#4c1d95",
    nodeLabel: "#e5e7eb",
    nodeBorder: "#f8fafc",
    edgeLine: "#64748b",
    edgeLabel: "#94a3b8",
    selected: "#facc15",
  },
} as const;

/**
 * Default color tokens written into a freshly scaffolded DESIGN.md by
 * `omk design init`. Generated-project content (a neutral starter palette for
 * the USER's project), not OMK's own render surface.
 */
export const DESIGN_SCAFFOLD = {
  primary: "#111827",
  secondary: "#4B5563",
  accent: "#7C3AED",
  success: "#059669",
  warning: "#D97706",
  danger: "#DC2626",
  background: "#F9FAFB",
  surface: "#FFFFFF",
} as const;
