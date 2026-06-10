# Lane TEST-HEALTH — Cockpit Timeout + Quantizer Drift Guard

Date: 2026-06-10

## 1. Cockpit Render Suite Timeout Fix

### Problem
`test/cockpit-render.test.mjs` timed out at the file level (~300s budget). All 33 subtests passed individually, but the monolithic file accumulated ~197s of sequential work, leaving no headroom for CI variance.

### Root Cause
- 33 subtests in a single file run sequentially under Node `--test`.
- Temp-directory tests (file I/O + renderCockpit) average ~3-5s each.
- Iteration-heavy geometry tests (width matrix 8×, height matrix 18×, stability 15×) add ~50 renders.
- Total wall time: ~197s; too close to the 300s file-level timeout.

### Fix Chosen
**Split the monolithic file into 3 focused suites.** Node `--test` runs test files in parallel by default, so splitting is the most effective fix without weakening any assertions.

- `test/cockpit-render-core.test.mjs` — 13 tests: geometry, dimensions, watch renderer, width/height matrices, stability, Korean/emoji, ANSI
- `test/cockpit-render-state.test.mjs` — 14 tests: state-based rendering requiring temp dirs (idle, stale, auto-expand, DeepSeek, todos, MCP, privacy, secrets)
- `test/cockpit-render-rail.test.mjs` — 6 tests: rail view dimensions, content, and clamping

### Before/After Timing
| Metric | Before | After |
|--------|--------|-------|
| Wall time (single file) | ~197s | — |
| Wall time (3 files, parallel) | — | **~114s** |
| Slowest file | ~197s | **~104s** |
| Improvement | — | **~42% faster** |

All 33 subtests pass; zero assertions deleted or weakened.

### Additional Cleanup
- Removed unused `CockpitRenderer` import from `cockpit-render-state.test.mjs`.
- Removed unused `CockpitRenderer` and `maxVisibleWidth` from `cockpit-render-rail.test.mjs`.
- Deleted the stale `test/cockpit-render.test.mjs` (untracked working-tree leftover from pre-split state).

---

## 2. Quantizer Twin-Drift Guard Test

### Risk
`src/cli/theme/oklab-quantize.ts` (runtime) and `scripts/theme-check.mjs` (CI gate) are **intentional twins**: same cube levels `[0, 95, 135, 175, 215, 255]`, same grayscale ramp `8 + 10n`, same OKLab nearest-neighbor math, same restriction to indexes `16-255`. Silent drift between them would cause the CI gate to approve colors that the runtime quantizes differently, breaking contrast guarantees in production.

### Fix
Added `test/theme-quantizer-drift.test.mjs` with 5 subtests:

1. **Cube-level constant equality** — asserts `CUBE_LEVELS === [0, 95, 135, 175, 215, 255]` on the gate side.
2. **Runtime dist constant presence** — reads `dist/cli/theme/oklab-quantize.js` and asserts the exact cube-levels array literal and grayscale ramp formula are present.
3. **Night-city primitives** — every hex in `themes/night-city.theme.json` primitives yields identical indexes from both sides.
4. **240-entry round-trip** — for each xterm index `16..255`, `xterm256Hex(i)` fed back into both quantizers returns exactly `i`.
5. **64 seeded pseudo-random RGBs** — deterministic `mulberry32(0xdeadbeef)` stream; every random color yields identical indexes from both sides.

All assertions also enforce `index >= 16 && index <= 255` on both sides.

### Export Change to scripts/theme-check.mjs
The script did not previously export its quantizer. Added a minimal `isMain` guard (`process.argv[1] === fileURLToPath(import.meta.url)`) so the CLI behavior is unchanged, and exported:
- `CUBE_LEVELS`
- `quantizeXterm256`
- `xterm256Hex`

`npm run theme:check` still exits `0`.

### Result
```
node --test test/theme-quantizer-drift.test.mjs
# tests 5
# suites 1
# pass 5
# fail 0
# duration_ms ~60-190
```

---

## 3. Commands Run + Exit Codes

```bash
# Drift test
node --test test/theme-quantizer-drift.test.mjs          # exit 0

# Reshaped cockpit suites (parallel)
node --test test/cockpit-render-core.test.mjs \
            test/cockpit-render-state.test.mjs \
            test/cockpit-render-rail.test.mjs            # exit 0

# Theme CI gate
npm run theme:check                                       # exit 0

# Project lint (src/ only, per existing config)
npm run lint                                              # exit 0
```

ESLint via the project’s flat-config (`eslint.config.mjs`) ignores `test/*.test.mjs` and targets `src/` only; running `npx eslint` directly on `.mjs` files outside `src/` hits TypeScript `projectService` parsing errors because `tsconfig.json` only includes `src/**/*`. The temp-config run showed only pre-existing `no-control-regex` warnings (disabled in the real config) and unused-variable noise from the split, which were cleaned up.

---

## 4. Files Changed (for `test(health):` commit)

- `test/cockpit-render-core.test.mjs` — existing split suite (cleaned from working-tree stale state)
- `test/cockpit-render-state.test.mjs` — removed unused `CockpitRenderer` import
- `test/cockpit-render-rail.test.mjs` — removed unused `CockpitRenderer` and `maxVisibleWidth`
- `test/theme-quantizer-drift.test.mjs` — **new** quantizer twin-drift guard
- `scripts/theme-check.mjs` — added named exports (`CUBE_LEVELS`, `quantizeXterm256`, `xterm256Hex`) behind `isMain` guard
- `test/cockpit-render.test.mjs` — **deleted** (stale monolithic leftover)
- `proof/theme-2026-06-10/hygiene-test-health.md` — this evidence doc

---

## 5. Remaining Risk

- **Cockpit state suite is still the slowest file** (~104s). If CI machines are slower or the timeout budget shrinks, further wins would require reducing temp-dir test count or caching the `OMK_PROJECT_ROOT` sandbox across tests. Both options sacrifice isolation; acceptable for now because the file is well under 300s.
- **ESLint coverage gap**: test scripts and `scripts/*.mjs` are outside the TypeScript project and therefore not linted by `npm run lint`. This is a pre-existing repo-wide gap, not introduced by this change.
- **Runtime quantizer source drift**: the drift test reads `dist/cli/theme/oklab-quantize.js`, not `src/cli/theme/oklab-quantize.ts`. If the TS source changes but `dist/` is not rebuilt, the drift test would test stale compiled code. This is mitigated by the fact that `npm run build` is part of the standard verify pipeline.
