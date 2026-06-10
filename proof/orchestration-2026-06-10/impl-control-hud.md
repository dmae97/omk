# OMK//CONTROL Cockpit Enhancement — impl-control-hud

## Sections Added

### 1. MCP HEALTH row/panel (Resources)
- **Location:** `src/commands/cockpit/render.ts` — `formatMcpHealth()`
- **Data:** `CockpitResourceSnapshot.mcpServers[]` (already collected by `getCockpitResources`)
- **Render:** compact status summary with semantic glyphs
  - `●N` green = connected (or undefined status in run scope)
  - `◐N` amber = connecting
  - `✕N` red = failed
  - top-offenders line listing up to 3 failed server names
- **Constraint respected:** no live network probes triggered in render path.

### 2. EVIDENCE-GATE tally panel (Evidence)
- **Location:** `src/commands/cockpit/render.ts` — `formatEvidenceGate()`
- **Data:** `RunViewModel.workers[].lastEvidence` + `snapshot.evidence`
- **Render:** pass/fail/pending counts with theme evidence glyphs
  - `✓N` mint = passed
  - `✗N` red = failed
  - `◐N` amber = pending
  - optional `latest` line showing most recent verification message

### 3. Team Runtime block (Workers & TODO)
- **Location:** `src/commands/cockpit/render.ts` — `buildTeamRuntimeLines()`
- **Data:** `RunViewModel.teamRuntime` (zero-effort port from `src/hud/render.ts:buildLatestRunPanel`)
- **Render:** session id, window present/missing counts, worker/reviewer counts, coordinator panes, missing-window warnings.

## Data Sources

| Section | Source file:function | Key fields |
|---------|----------------------|------------|
| MCP HEALTH | `src/commands/cockpit/utils.ts:getCockpitResources` | `mcpServers[].status`, `mcpServers[].name` |
| EVIDENCE-GATE | `src/util/run-view-model.ts:buildRunViewModel` | `workers[].lastEvidence.passed` |
| EVIDENCE-GATE | `src/commands/cockpit/telemetry.ts:buildCockpitSnapshot` | `evidence.failedGates`, `evidence.latestVerification` |
| Team Runtime | `src/util/run-view-model.ts:buildRunViewModel` | `teamRuntime.session`, `teamRuntime.windows[]`, `teamRuntime.workerCount` |

## Before vs After

**Before:** the live cockpit showed a single-line MCP summary (`formatResourceSummary`) embedded inside the Run panel, plus a short evidence-failed/skipped note. Team Runtime was absent entirely.

**After:** dedicated Resources panel with MCP health glyph summary (`●/◐/✕`), a new Evidence panel with gate tally (`✓/✗/◐`), and Team Runtime surfaced inside Workers & TODO.

## Rendered Frame Snapshot (after — width 80, height 40)

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃                                                                              ┃
┃ ◢█ OMK//CONTROL COCKPIT █◣                                                   ┃
┃ NEON GRID · GREEN RAIN · METRICS WALL                                        ┃
┃ route · verify · loop · control · evidence gated                             ┃
┃                                                                              ┃
┃ ▌ WORKING LOOP :: explorer · Node Three 0s ▐                                 ┃
┃ ──────────────────────────────────────────────────────────────────────────── ┃
┃ ╔══ Run ═══════════════════════════════════════════════════════════════════… ┃
┃ ║ run fixture-run                                                          … ┃
┃ ║ primary unavailable  sys --                                              … ┃
┃ ║ deepseek checking use:0 fb:0                                             … ┃
┃ ║ dur 776h57m                                                              … ┃
┃ ║ health FAILED  progress 2/3 settled, 1 active  active ▶ Node Three       … ┃
┃ ║ next omk goal continue fixture-run  blocker ■ secret leaked (n2)         … ┃
┃ ╚══════════════════════════════════════════════════════════════════════════… ┃
┃ ╔══ Resources ═════════════════════════════════════════════════════════════… ┃
┃ ║ MCP ●14 ◐2 ✕1 /17 fail: server-16                                       … ┃
┃ ╚══════════════════════════════════════════════════════════════════════════… ┃
┃ ╔══ Evidence ══════════════════════════════════════════════════════════════… ┃
┃ ║ evidence ✓1 ✗1 ◐1 of 3                                                 … ┃
┃ ╚══════════════════════════════════════════════════════════════════════════… ┃
┃ ╔══ Workers & TODO ════════════════════════════════════════════════════════… ┃
┃ ║ Team Runtime                                                             … ┃
┃ ║   session team-42 status ready                                           … ┃
┃ ║   windows 2/3 present · workers 3 · reviewer 1                           … ┃
┃ ║   coordinator panes 2                                                    ┃
┃ ║   1 expected window(s) missing                                           … ┃
┃ ║                                                                          … ┃
┃ ║ ▸ TODO not recorded                                                      … ┃
┃ ║ ▸ AGENTS █████░░░ 67% (1▶ 1✓ 1✕ 0■ 0⊘ / 3)                             … ┃
┃ ║   RUNNING running-silent 0s Node Three                                   … ┃
┃ ║     → Node Three                                                         … ┃
┃ ║   FAILED 0s Node Two                                                     … ┃
┃ ╚══════════════════════════════════════════════════════════════════════════… ┃
┃ ╔══ Changes & History ═════════════════════════════════════════════════════… ┃
┃ ║ ✓ clean worktree                                                        … ┃
┃ ╚══════════════════════════════════════════════════════════════════════════… ┃
┃ [h]istory [+/-]height [a]auto [space]pause [q]uit height:40                  ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

## Determinism Note

- No wall-clock or random values introduced in the new formatters.
- `Date.now()` is used only in existing patterns (`elapsed` duration, sweep animation frame).
- The new sections rely solely on already-collected snapshot data (`resources`, `vm.workers`, `vm.teamRuntime`), so rendered bytes are reproducible for identical fixture state.

## Test Results

- `node --test test/cockpit-render-core.test.mjs` — **14/14 pass**
- `npx tsc --noEmit` — **0 errors**
- `npm run lint` — **0 warnings**
- `npm run color:gate` — **passed** (no new raw color literals)

## Commands Run

```bash
npm run build
npx tsc --noEmit
npm run lint
npm run color:gate
node --test test/cockpit-render-core.test.mjs
```

## Files Changed

- `src/commands/cockpit/render.ts` — added `formatMcpHealth`, `formatEvidenceGate`, `buildTeamRuntimeLines`; rewired `mcpLines`, `evidenceLines`, `workerLines`, `activePanels`, responsive budget allocation.
- `test/cockpit-render-core.test.mjs` — added fixture-state test asserting MCP health glyphs, evidence gate counts, and Team Runtime presence.
