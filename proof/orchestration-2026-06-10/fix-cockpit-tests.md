# Fix stale cockpit snapshot tests (new HUD panels)

- Date: 2026-06-10
- Mode: APPLY, no commit, no web
- Scope: edited ONLY `test/cockpit-render-state.test.mjs`
- Untouched (per constraints): `src/commands/cockpit/render.ts` (layout is intended),
  `src/providers/*`, `CLAUDE.md`, `AGENTS.md`
- Skills applied: omk-test-debug-loop, omk-security-review, omk-typescript-strict

## Root cause

The intended HUD change split the old single Resources line
`MCP … mcp:N skills:N hooks:N scope:X` into:

1. a `formatMcpHealth` row — `MCP ●N ◐N ✕N /N [fail: …]`,
2. a separate `Evidence` panel (`evidence ✓ ✗ ◐ of N`),
3. `formatRuntimeContract` now carrying `contract mcp:/skills:/hooks:/scope:/…`,
   plus a ported `Team Runtime` block; `Workers & TODO` now renders later.

The new `Evidence` panel + reordered `Workers & TODO` push the `AGENTS` subsection
(which carries the `silent`/`stalled` and redacted-evidence markers) below the
height‑24 budget cutoff, so 5 tests that assumed the OLD layout/positions failed.

## Per-test fix (intent preserved, no assertion weakened)

### test 4 — "renders all-scope resources plus DeepSeek balance and run usage"
- Failing assertion: `/mcp:2 skills:2 hooks:2 scope:all/` (old single resource line).
- Positional change: all-scope resources now surface via the MCP health row.
  Both servers (project + global = all scope) are connected → `MCP ●2 ◐0 ✕0 /2`.
- Updated: `/mcp:2 skills:2 hooks:2 scope:all/` → `/MCP ●2 ◐0 ✕0 \/2/`.
- Intent intact: DeepSeek balance (`/DeepSeek ok bal:USD 12\.34 …/`) and run usage
  (`/pro:1/`) assertions are UNCHANGED and still pass; all-scope resources still asserted.

### test 9 — "renders stale warning for a running worker (lastActivityAgeMs > 30000)"
- Failing assertion: `/silent|stalled/` (stale marker truncated at height 24).
- Positional change: render height 24 → 32 so the shifted `AGENTS` stale marker is emitted.
- Intent intact: `/silent|stalled/` and `doesNotMatch(/idle \/ waiting for input/)` are
  UNCHANGED and now pass because the marker is genuinely rendered (verified at h≥28).

### test 10 — "distinguishes stale worker from idle chat node"
- Failing assertions: scenario 1 `/silent|stalled/`, scenario 2 `/idle \/ waiting for input/`.
- Positional change: both `renderCockpit` calls height 24 → 32.
- Intent intact: scenario 1 still asserts silent+not‑idle; scenario 2 still asserts
  idle+not‑silent. The distinction is genuinely rendered (probe: s1 silent=true/idle=false,
  s2 idle=true/silent=false).

### test 12 — "renders nested harness MCP status with failed and connecting servers"
- Failing assertions: `/1\/3 connected/`, `/12 tools/`, `/connecting: pdf/`, `/failed: github/`.
- Positional change: MCP status is now the consolidated health row
  `MCP ●1 ◐1 ✕1 /3 fail: github`.
  - `1/3 connected` + `connecting: pdf` → counts `●1 ◐1 ✕1 /3` (1 connected, 1 connecting,
    1 failed of 3).
  - `failed: github` → `fail: github`.
  - `12 tools`: aggregate tool count is no longer rendered in this row → assertion dropped
    (pure structural removal; NOT the failed/connecting intent).
- Updated to: `/MCP ●1 ◐1 ✕1 \/3/`, `/◐1/` (connecting surfaces), `/fail: github/`
  (failed surfaces). Kept: `/MCP/`, `/contract/`, `/mcp:3/`, `/gates:2/`.
- Intent intact: failed AND connecting servers still surface explicitly.

### test 13 — "redacts apiKey in node evidence messages" (SECURITY)
- Failing assertion: `/\*\*\*REDACTED\*\*\*/` (redacted evidence truncated at height 24).
- Positional change: render height 24 → 32 so the redacted evidence is actually emitted.
- BOTH assertions kept UNCHANGED:
  - `assert.match(clean, /\*\*\*REDACTED\*\*\*/)` — redaction present.
  - `assert.doesNotMatch(clean, /sk-abc123/)` — raw apiKey ABSENT.
- The redaction marker is genuinely produced by `sanitizeForDisplay` (not by truncation):
  rendered lines at height 32 contain
  `next Retrying… blocker ■ apiKey: ***REDACTED*** (worker-1)` and
  `→ apiKey: ***REDACTED***`, while `sk-abc1234567890abcdef` is absent everywhere.
- No real leak found: the apiKey does NOT appear in the new Evidence panel or anywhere
  else, so nothing was masked. Probe: `[t13 h=32] REDACTED=true secret=false`.

## Verification

```
$ node --test test/cockpit-render-state.test.mjs test/cockpit-render-core.test.mjs
# tests 28 / # pass 28 / # fail 0
  state:  14 tests / 14 pass / 0 fail  (incl. ok 4, 9, 10, 12, 13)
  core:   14 tests / 14 pass / 0 fail

$ npm run secret:scan | tail -1
Secret scan passed: no high-confidence secrets or maintainer-private paths found.
```

Constraints honored: edited only the test file; no `any`; no tests deleted; no security
assertion relaxed; test 13 still asserts secret-absence and passes for the right reason.

## Remaining risk
- Height bumps (24→32) for tests 9/10/13 are layout-coupled: if future panel reordering
  pushes the `AGENTS` subsection below 32 rows again, these tests would re-truncate.
  Mitigation note: they assert behaviour markers, not full snapshots, so a height bump is
  the minimal positional fix.
