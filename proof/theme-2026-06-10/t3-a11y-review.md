# T3 — Adversarial a11y/contrast review · night-city theme contract (T3–T5 lane)

- Reviewer lane: READ-ONLY a11y/contrast review (OMK reviewer subagent)
- Date: 2026-06-10
- Inputs: `themes/night-city.theme.json`, `scripts/theme-check.mjs`,
  `schemas/omk.theme.v1.schema.json`,
  `proof/theme-2026-06-10/{contrast-matrix.csv,t1-t2-summary.md,oklch-selftest.txt}`
- Method: independent Node re-implementation of WCAG 2.x relative-luminance contrast
  and OKLab (Björn Ottosson) nearest-neighbor quantization to xterm-256
  (cube 6×6×6 levels [0,95,135,175,215,255] = idx 16–231; grayscale ramp 8+10n = idx 232–255;
  indexes 0–15 excluded per T3 spec). All commands read-only.

---

## 1. T2 matrix audit — 5 spot-checks re-derived

Independent recomputation from the raw hexes in `contrast-matrix.csv`.
Tolerance: flag if |Δ| > 0.05.

| # | pair | published CR | re-derived CR | Δ | verdict |
|---|------|--------------|---------------|----|---------|
| 1 | route.active `#00D6FF` on dark `#070B14` | 11.31 | 11.3051 | 0.005 | ✓ confirmed |
| 2 | route.dead `#FF5874` on surface `#101826` | 5.84 | 5.8442 | 0.004 | ✓ confirmed |
| 3 | control.accent `#9D4EDD` on dark `#070B14` (gate 3.0) | 4.28 | 4.2806 | 0.001 | ✓ confirmed |
| 4 | dag.lane.queued `#9DB3C7` on surface `#101826` | 8.22 | 8.2210 | 0.001 | ✓ confirmed |
| 5 | fallback16 control.dim white `#AAAAAA` on black | 9.04 | 9.0396 | 0.000 | ✓ confirmed |

Discrepancies > 0.05: **none.** Side note: t1-t2-summary.md cites brightBlack `#555555`
on black as "CR 2.81"; re-derived 2.8163 (rounds to 2.82). Δ = 0.006 against the unrounded
value — within tolerance; the rejection rationale (fails 3.0 gate) is unaffected and correct.

## 2. xterm-256 quantization risk (OKLab NN, idx 16–255)

Quantization of all 11 primitives (independent of the coder lane's implementation):

| token | hex | → idx | quantized hex |
|-------|-----|-------|---------------|
| dark | #070B14 | 232 | #080808 |
| surface | #101826 | 234 | #1C1C1C |
| cyan | #00D6FF | 45 | #00D7FF |
| mint | #00FFC2 | 49 | #00FFAF |
| magenta | #FF47B2 | 205 | #FF5FAF |
| purple | #9D4EDD | 98 | #875FD7 |
| amber | #FFB000 | 214 | #FFAF00 |
| red | #FF5874 | 204 | #FF5F87 |
| cream | #E8F8FF | 195 | #D7FFFF |
| muted | #9DB3C7 | 145 | #AFAFAF |
| gray | #758FA8 | 103 | #8787AF |

Gate re-check of all 32 semantic pairs at the 256 tier (quantized fg vs quantized bg):
**0 of 32 pairs degrade below gate.** Pairs that degrade below their gate: **NONE.**

Tightest post-quantization margins (MUST be re-verified after any hand-tuning):

| pair | orig CR | quant CR | gate | margin |
|------|---------|----------|------|--------|
| control.dim gray@103 on surface@234 | 5.29 | 4.96 | 4.5 | +0.46 |
| control.accent purple@98 on surface@234 | 3.87 | 3.77 | 3.0 | +0.77 |
| route.dead / evidence.fail / telemetry.error red@204 on surface@234 | 5.84 | 5.87 | 4.5 | +1.37 |
| dag.lane.queued muted@145 on surface@234 | 8.22 | 7.77 | 4.5 | +3.27 |

Perceptual-fidelity risks for the coder lane (contrast passes, hue does not):

- **muted #9DB3C7 → idx 145 #AFAFAF**: chroma 0.038 → 0.000 — the blue-gray collapses to
  pure gray (OKLab hue meaningless at C=0). Contrast fine; brand tint lost. If hand-tuning,
  candidates like 146 (#AFAFD7) restore tint — re-gate before adopting.
- **cream #E8F8FF → idx 195 #D7FFFF**: hue drift −29.2°, chroma 0.019 → 0.041 (cyan-cast).
- **purple #9D4EDD → idx 98 #875FD7**: hue drift −10.5°, chroma −0.035 (bluer, duller accent).
- cyan/amber are near-exact (drift < 0.7°); mint −6.1°, red −5.9° acceptable.
- Backgrounds lose blue tint entirely (232/234 are grayscale-ramp grays). Acceptable at this
  tier; do NOT "fix" by picking cube blue 17 (#00005F) without re-gating — it is lighter
  blue-channel-heavy and erodes margins on cream/muted pairs.

## 3. 16-color tier — fallback16 vs summary rationale

Verified `themes/night-city.theme.json` `fallback16` against the t1-t2-summary.md rationale
and the CSV's 16 VGA rows:

- ✓ `control.dim → white` (#AAAAAA, CR 9.04 re-derived) NOT `brightBlack` (#555555,
  CR 2.82 re-derived, fails both 4.5 and 3.0) — matches the summary's stated rationale.
- ✓ All 17 semantic roles covered (16 fg roles + control.bg → black); no role missing,
  matching the schema's full-coverage requirement enforced in `validateTheme()`.
- ✓ Semantic hue-family preserved: cyan→brightCyan, amber→brightYellow, red→brightRed,
  mint→brightGreen, purple→brightMagenta, cream→brightWhite, muted/gray→white. Sensible.
- ✓ Min CR at this tier is brightRed on black = 6.68 (text gate 4.5) — re-derivation of
  the CSV spot rows confirms the published values.
- ⚠ Limitation (informational): the VGA gate assumes stock xterm ANSI values. Users with
  remapped ANSI-16 palettes (e.g., Solarized) are outside the contract. Glyphs are the
  safety net; worth one line in T5 docs.

## 4. NO_COLOR tier — semantic distinguishability

Schema clause (`schemas/omk.theme.v1.schema.json`):

- Top-level `description`: "Every semantic state pairs color with a glyph so NO_COLOR tiers
  keep meaning."
- `semantics.patternProperties[…].if/then`: if `kind` is not `chrome`/`background`, then
  `required: ["color", "glyph", "usage"]` — i.e. **glyph is mandatory for kind=state**.
- Executable twin in `scripts/theme-check.mjs` `validateTheme()`:
  `if (kind === "state" && !spec.glyph) err(...)`.

Verification: all 13 kind=state roles carry glyphs; state is never color-only. ✓
Glyph distinctness audit across all roles:

- ⚠ **Collision found: `telemetry.info` and `control.dim` both use glyph `·`.** Both appear
  as sibling slots in the `logStream` component (info vs dim). At the NO_COLOR tier these two
  rows render identically. Mitigating: control.dim is kind=chrome (not state), so no *state*
  is color-only and the schema is satisfied — but the info/dim distinction in logStream does
  silently collapse. Recommend a distinct dim glyph (e.g. `┊` or none) or a documented
  acceptance note.
- All state-vs-state glyphs within a component are distinct (✓/✗/◐, ▸/↻/✕, ▶/⏸/●/◌, ·/▲/✖).
  Minor: ● vs ◌ (done/queued) relies on fill rendering; acceptable in practice.

## 5. Additional adversarial findings

- **[MINOR] Unused primitive**: `magenta #FF47B2` is declared but referenced by no semantic
  role, so it is never contrast-gated. If a future role adopts it the gate will catch it
  (quantizes cleanly to idx 205, CR 7.07/6.39 on quantized dark/surface — would pass). Remove
  or document as reserved.
- **[MAJOR→condition] 256 tier is ungated in CI**: `theme:check` gates truecolor + VGA-16
  only. T3 introduces a third color tier with its own failure surface (esp. lookup overrides
  / hand-tuning). This review proves today's NN mapping passes, but nothing prevents a future
  regression. The 256-tier matrix must join the CI gate.

## Verdict — Ouroboros-style QA

| # | criterion | evidence | verdict |
|---|-----------|----------|---------|
| 1 | T2 published CRs accurate (Δ ≤ 0.05) | 5/5 spot-checks, max Δ 0.005 (§1) | PASS |
| 2 | 256-tier quantized pairs hold gates (text ≥ 4.5, indicator ≥ 3.0) | 32/32 pass; min margins +0.46 / +0.77 (§2) | PASS |
| 3 | fallback16 matches measured rationale (control.dim→white etc.) | theme JSON + re-derived 9.04 vs 2.82 (§3) | PASS |
| 4 | NO_COLOR: state never color-only; schema clause enforced | if/then clause + validateTheme(); 13/13 state glyphs (§4) | PASS |
| 5 | NO_COLOR: zero ambiguity across all rendered slots | `·` collision telemetry.info vs control.dim in logStream (§4) | FAIL (minor) |
| 6 | 256 tier protected against future regression | tier absent from theme:check CI gate (§5) | FAIL (process) |

**VERDICT: PASS-WITH-CONDITIONS**

1. **(MUST, T3 coder lane)** Add the 256-tier quantized contrast matrix to `theme:check`
   so hand-tuned index overrides are CI-gated like the other two tiers. Re-verify the two
   tight pairs after any override: gray@103 on surface@234 (4.96/4.5), purple@98 on
   surface@234 (3.77/3.0).
2. **(MUST, before tuning)** Any hand-tuning for hue fidelity (muted→145 achromatic,
   cream→195 cyan-cast, purple→98 blue-shift) must re-run the gate; do not trade contrast
   margin for tint without a recorded matrix row.
3. **(SHOULD)** Resolve the `·` glyph collision (telemetry.info vs control.dim) or document
   acceptance that logStream info/dim collapse at NO_COLOR tier.
4. **(SHOULD, T5 docs)** Note the VGA-palette assumption for the 16-color tier and the
   unused `magenta` primitive (reserved or remove).

**256-tier degrading pairs (below gate): NONE.** (Closest: control.dim 5.29→4.96 vs 4.5;
control.accent 3.87→3.77 vs 3.0 — pass with margin.)

---
Evidence checked: contrast-matrix.csv (48 rows), theme JSON, schema if/then clause,
theme-check.mjs gate logic, oklch-selftest.txt. Not checked: T3 coder-lane code (not yet
landed in this worktree at review time), real-terminal rendering screenshots.
