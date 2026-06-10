/**
 * CLI Theme — Representative Status Frame
 * Renders the ONE representative TUI status frame shared by the four-tier
 * degradation snapshots (test/theme-degradation.test.mjs) and the
 * `omk theme preview <name>` CLI surface. Keeping a single renderer
 * guarantees the CLI preview shows exactly the snapshot-gated frame.
 */

import type { CompiledTheme } from "./render-table.js";

function paintWithGlyph(ct: CompiledTheme, role: string, text: string): string {
  const entry = ct.tokens[role];
  const glyph = entry?.glyph ?? "";
  return ct.paint(role, glyph === "" ? text : `${glyph} ${text}`);
}

/** One representative TUI status frame built from theme tokens + glyphs. */
export function renderStatusFrame(ct: CompiledTheme): string {
  const p = (role: string, text: string): string => paintWithGlyph(ct, role, text);
  return [
    `${p("control.accent", "OMK//CONTROL")} ${p("control.dim", "night-city ops console")}`,
    `${p("dag.lane.running", "lane compile")}  ${p("dag.lane.done", "lane schema")}  ${p("dag.lane.queued", "lane docs")}`,
    `${p("evidence.pass", "contrast 48/48")}  ${p("evidence.pending", "snapshots")}  ${p("route.fallback", "provider kimi")}`,
    `${p("telemetry.warn", "headroom 81%")}  ${p("control.fg", "tier ready")}`,
  ].join("\n");
}
