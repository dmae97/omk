# OMK//CONTROL Right-Side HUD / Cockpit Recon

> READ-ONLY recon of the live right-hand control column in the OMK chat TUI.  
> Date: 2026-06-10  
> Scope: no edits, no web, local repo only (`rg/sed/cat/jq`).

---

## 1. Main Render Functions — Right-Hand Control Column

The live right-side panel is a **tmux pane** running `omk cockpit --watch`. The split logic lives in two layers: **tmux shell orchestration** (creates the pane) and **terminal renderers** (paint the pane content).

| File | Function | Line | Role |
|------|----------|------|------|
| `src/util/chat-cockpit.ts` | `launchChatCockpit` | ~119 | Creates tmux session, splits window **vertically** (`split-window -h -l <sideWidth>%`) for the right pane, pins `main-vertical` layout. Left = chat REPL, Right = cockpit watch loop. |
| `src/util/chat-cockpit.ts` | `buildRightPaneCommand` | ~94 | Builds the command executed in the right pane: `omk cockpit --run-id <id> --watch --refresh <ms> [--redraw <mode>]`. |
| `src/commands/cockpit/render.ts` | `renderCockpit` | ~242 | **Primary renderer** for the right pane. Builds header → info → workers/TODO → changes/history → footer. Returns a single bordered panel string. |
| `src/hud/render.ts` | `buildHudSidebar` | ~290 | Builds the **"Right Rail"** panel (run progress, TODO list, AGENTS, changed files). Used by the HUD dashboard, not the live cockpit, but shares the same visual vocabulary. |
| `src/hud/render.ts` | `renderHudColumns` | ~370 | Two-column layout compositor: joins `mainPanels[]` (left) + `sidebar` (right) line-by-line with a 2-space gap. Falls back to vertical stack if `terminalWidth < 100`. |
| `src/tui/terminal-frame-renderer.ts` | `TerminalFrameRenderer.render` | ~38 | Frame-diff engine used when `cockpit --redraw diff`. Only rewrites changed lines (`\x1b[H` + per-line `\x1b[K`). |

### Width / Column Split

- **Tmux layer** (`chat-cockpit.ts`): `sideWidth` defaults to 40% (≤80 cols), 45% (120 cols), 50% (≥180 cols). `computeMainPaneWidth` sets `main-pane-width` so the left chat pane keeps the remainder.
- **HUD layer** (`renderHudColumns`): runtime terminal width check. If `terminalWidth < 100` → vertical stack. Else splits into two columns with a gap of 2 spaces and equal `panelWidth = floor((terminalWidth - gap) / 2)`.
- **Cockpit layer** (`renderCockpit`): single-column panel that fills the tmux pane width. No internal left/right split; the pane itself *is* the right control column.

---

## 2. Current Sections & Data Sources

### `renderCockpit` (live right pane) sections

| Section | What it shows | Data source (file:function:line) |
|---------|---------------|----------------------------------|
| **Header** | Matrix rain signal (3 lines) + sparkle title `OMK//CONTROL COCKPIT` + tagline | `src/brand/matrix-rain.ts:renderMatrixRain`, `src/ui/omk-sigil.ts:renderOmkSparkleText` |
| **Sweep / Working HUD** | Animated sweep line showing active node role + phase (`renderWorkingHud`) | `src/ui/omk-working-sweep.ts:renderWorkingHud` called with `vm.activeNode` state |
| **Info block** | run ID, primary OAuth account, 5h/week usage %, sys CPU/mem %, DeepSeek status + live requests, **MCP summary** (connected/tools counts), **runtime contract** (mcp/skills/hooks/workers/steps/gates), **evidence gate tally** (failed/skipped), goal + score, health, progress, active node, next action/ETA/blocker, selected runtime | `src/commands/cockpit/telemetry.ts:buildCockpitSnapshot` aggregates: `getKimiUsage`, `getSystemUsage`, `getCockpitResources`, `getCockpitDeepSeekSnapshot`, `readEvents`, `readSessionMeta`, `buildRunViewModel` |
| **Workers & TODO** | TODO progress bar + up to 6 todos with agent badges; AGENTS progress bar + sorted worker list (state, elapsed, phase, stall warnings, runtime badge, lastEvidence on failure) | `.omk/runs/<run-id>/todos.json` via `loadTodos`; `RunState.nodes` via `buildRunViewModel`; `readEvents` for heartbeat ages |
| **Changes & History** | Git change counts (M/A/D/?/R) + top paths; recent run history (5 runs) with goal titles | `git status --porcelain` via `getGitChanges`; `.omk/runs/*/state.json` + `goal.md` via `listRunCandidates` |
| **Footer** | Key hints (`q`uit, `+/-` height, `a`uto, `space` pause) | static inline in `renderCockpit` |

### `buildHudSidebar` (HUD “Right Rail”) sections

| Section | What it shows | Data source |
|---------|---------------|-------------|
| Run progress | run ID, settled/total, active count, health, provider routing attempts/fallbacks | `RunViewModel` from `buildRunViewModel` |
| TODO | Sorted todos with role badges (max 9) | `loadTodos` |
| AGENTS | Up to 5 workers with live status and assignment summary (skills/hooks/MCP/tools) | `vm.workers` |
| Changed Files | Git changes with status markers (max 12) | `getGitChanges` |

---

## 3. Layout Primitives — Add-a-Section Recipe

### Available primitives

All live in `src/theme/layout.ts` and are re-exported through `src/theme/hud-theme.ts`.

| Primitive | Signature | Typical use |
|-----------|-----------|-------------|
| `panel(lines, title?)` | `src/theme/layout.ts:72` | Matrix-green bordered box. Used for every major cockpit panel (RUNTIME, CONTEXT, Latest Run, etc.). |
| `box(lines, title?)` | `src/theme/layout.ts:37` | Basic bordered box (phosphor dim). Used in hero banners. |
| `gauge(label, value, max, width?)` | `src/theme/layout.ts:58` | Horizontal bar gauge. Color-codes >70% amber, >90% red. |
| `stat(label, value, unit?)` | `src/theme/layout.ts:115` | `  label: value unit` line. |
| `gradient(text)` | `src/theme/layout.ts:48` | Neon 5-stop gradient (blue→purple→pink→orange→mint). |
| `header(text) / subheader(text) / separator(width)` | `src/theme/layout.ts:10` | Decorative headers. |
| `layoutPanel(title, lines, width)` | `src/util/terminal-layout.ts` | Dark-purple bordered panel used inside `renderCockpit`. |
| `sectionHeader(text)` | `src/util/terminal-layout.ts` | `▸ TEXT` style header. |
| `parallelStatusBadge(status, role)` | `src/theme/parallel.ts:158` | Colored badge `[ROLE] ▶ RUNNING`. |
| `workerOutputBox(lines, id, role)` | `src/theme/parallel.ts:186` | Per-worker bordered output box. |
| `miniProgressBar(done, total, width)` | `src/commands/cockpit/render.ts:165` | `████░░░░░ 45%` compact bar. |

### Recipe: adding a new section to the live cockpit

1. **Collect data** in `src/commands/cockpit/telemetry.ts:buildCockpitSnapshot` (or add a new async helper in `src/commands/cockpit/utils.ts`).
2. **Add a formatter** in `src/commands/cockpit/render.ts` (follow patterns like `formatResourceSummary`, `formatDeepSeekSummary`).
3. **Insert into the `infoLines` / `workerLines` / `changedLines` arrays** inside `renderCockpit`. Use `truncateLine(result, targetWidth)` to respect pane width.
4. **Wrap with a panel title** if it deserves its own rectangle: `layoutPanel("MY SECTION", lines, targetWidth)`.
5. **Add to `activePanels`** (keyed) if it needs responsive budget allocation (`info` / `worker` / `mcp` / `changed`).

### Recipe: adding a new section to the HUD sidebar

1. Build lines array in `buildHudSidebar` (`src/hud/render.ts`).
2. Use `theme.style.*` colors + `truncateText` for safe widths.
3. Return `theme.panel(contentLines, "TITLE")`.
4. If using `renderHudColumns`, the sidebar string is already passed in; no extra wiring needed.

---

## 4. Ranked Enhancement Opportunities

| Rank | Enhancement | Value | Effort | Data source | Slot location |
|------|-------------|-------|--------|-------------|---------------|
| 1 | **MCP health row** — expand the 1-line MCP summary into a per-server status list (17 servers: connected/connecting/failed + tool count). | High (17 servers, frequent failure mode) | Low | `getCockpitResources` → `resources.mcpServers[]` (`src/commands/cockpit/utils.ts`) | After `formatResourceSummary` in `infoLines`; or new dedicated `mcpLines` pushed to `activePanels` with key `"mcp"`. |
| 2 | **Evidence-gate tally panel** — currently only shows `failedGates` / `skippedGates` counts. Expand to list each failed gate + worker + message. | High (quality-gate visibility) | Low | `snapshot.evidence` + `vm.workers[].lastEvidence` (`src/commands/cockpit/telemetry.ts:buildCockpitSnapshot`) | New `evidenceLines` array → `activePanels` key `"evidence"`; render between `infoLines` and `workerLines`. |
| 3 | **DAG lane live status** — mini ASCII or indented tree of lane dependencies from `RunState.nodes[].dependsOn`. Show blocked chains. | High (orchestration UX) | Medium | `RunState.nodes` (`src/contracts/orchestration.ts`) + `vm.workers` | New formatter in `renderCockpit` → append to `workerLines` before the AGENTS list. |
| 4 | **Headroom gauge** — context-compaction pressure meter (tokens/s, compaction events, estimated turn budget). | Medium (context health) | Medium | Headroom utility (not yet exposed to cockpit; see `src/util/headroom.ts` if it exists, else add to `context-broker`) | Add to `buildSystemPanel` or `infoLines` as `gauge("Headroom", pressurePct, 100, 20)`. |
| 5 | **Reasoning-trace mini** — latest intent, plan, tools-used count, evidence count from the reasoning trace engine. | Medium (transparency) | Low-Medium | `src/runtime/reasoning-trace.ts` (`createReasoningTrace`, `summarizeTrace`) | Insert into `infoLines` after intent/mode rows. |
| 6 | **Theme / tier indicator** — show active `ThemePalette` name + tier (e.g., `omk-parallel-orchestrator` / tier `pro`). | Low (polish) | Low | `src/cli/theme/theme-registry.ts` (`ThemePalette`, tier from `tier-explain.ts`) | Add to `headerLines` or first `infoLines` row as a compact badge. |
| 7 | **Provider route timeline** — richer than `formatProviderMetricLine`: show last route decision, fallback reason, advisory vs direct counts per model. | Low-Medium | Low | `vm.providerRouting` + `RunState.routeDecision` (`src/util/run-view-model.ts`) | Replace/extend existing provider line in `infoLines`. |

### Bonus: already-implemented but not surfaced everywhere

- `vm.teamRuntime` (team session, window presence, coordinator panes) is rendered in `buildLatestRunPanel` (`src/hud/render.ts`) but **absent** from `renderCockpit` (`src/commands/cockpit/render.ts`). Porting the Team Runtime block to the cockpit info block is a zero-effort data win.

---

## Files touched in this recon

```
src/util/chat-cockpit.ts
src/commands/cockpit/render.ts
src/commands/cockpit/telemetry.ts
src/commands/cockpit/utils.ts
src/hud/render.ts
src/hud/live-renderer.ts
src/theme/layout.ts
src/theme/hud-theme.ts
src/theme/parallel.ts
src/tui/terminal-frame-renderer.ts
src/cockpit/views/rail-view.ts
src/cockpit/types.ts
src/contracts/hud.ts
```
