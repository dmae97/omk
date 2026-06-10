# Goal#1 REMEDIATION Recon (READ-ONLY) — 2026-06-10

Verifier: explorer lane. Tools: rg/sed/cat/git only. No edits.

## Summary verdicts
- B1 (router composite abs-sum=1.20 weight-normalization): STATUS: DONE
- A1 (.gitattributes linguist-vendored for 3 template .js): STATUS: DONE

Weights are now CENTRALIZED in the omk.weights.v1 contract (commit c04766d).
Inline arrays still present in weakness-remediation.ts but explicitly @deprecated.

---

## Item 1 — src/runtime/router-v2-scoring.ts (composite weights)
- No inline coefficient array remains. Weights imported from weights-config.ts.
  - `src/runtime/router-v2-scoring.ts:25` — `import { intentCapabilityWeights, routerV2CompositeEffective } from "./weights-config.js";`
  - `src/runtime/router-v2-scoring.ts:39` — `const COMPOSITE_EFFECTIVE = routerV2CompositeEffective();`
  - `src/runtime/router-v2-scoring.ts:140-149` — composite uses `cw.*` / `cp.*` (effective normalized weights/penalties), not literals.
- Raw historical vector documented in header (`router-v2-scoring.ts:11-13`):
  weights 0.25/0.15/0.20/0.15/0.10/0.10 (Σ=0.95), penalties 0.15/0.10 (Σ=0.25).
  Raw abs-sum = 0.95 + 0.25 = 1.20 (the original B1 figure).

## Item 2 — RELEASE_GATE_WEIGHTS (weakness-remediation.ts)
- `src/runtime/contracts/weakness-remediation.ts:43-54` raw values:
  ci .15, build .10, types .10, tests .10, install .10, demo .15, proof .15,
  maturity .10, docs .10, regression .15.
  Positive weight Σ = 1.05; +regression penalty 0.15 → abs-sum 1.20.
- `weakness-remediation.ts:37-42` marks this @deprecated; source of truth is
  omk.weights.v1 (releaseGateEffective()). Kept for backward-compat only.

## Item 3 — omk.weights.v1 contract (commit c04766d)
- Contract code: `src/runtime/weights-config.ts` (schemaVersion "omk.weights.v1").
- JSON source of truth: `schemas/omk.weights.v1.json` (EXISTS); embedded mirror
  `DEFAULT_WEIGHTS` at `weights-config.ts:142-191`.
  - routerV2Composite (`weights-config.ts:160-170`): normalize:true,
    weights Σ=0.95, penalties recentFailure .15 / blastRadius .10.
  - releaseGate (`weights-config.ts:145-159`): normalize:true,
    weights Σ=1.05, penalty regression .15.
  - intentCapability (`weights-config.ts:172-189`): normalize:false (intentional).
- Normalization (`weights-config.ts:298-330` normalizeVector): ŵ=w/Σw; penalties
  AND thresholds scaled by SAME 1/Σw (pure uniform scaling, ranking-preserving).
  Enforced invariants: throws if Σw≤0 (`:314`) and if |Σŵ-1|>1e-6 (`:322`).
- Result: effective composite weights sum to EXACTLY 1.0 (invariant-enforced);
  penalties become 0.15/0.95=0.1579 + 0.10/0.95=0.1053 (Σ≈0.2632).
  CENTRALIZED: yes. Router/release-gate consume effective normalized vectors;
  consumers: `src/cli/release-promotion-gate.ts:7`, router-v2-scoring.ts.

### B1 conclusion
The 1.20 raw abs-sum no longer drives scoring. Scoring uses normalized weights
(Σŵ=1.0) with an enforced invariant. B1 weight-normalization is FIXED by c04766d.
STATUS: DONE. (Raw 1.20 literals retained only as documented @deprecated history.)

## Item 4 — Hygiene A1 (.gitattributes / linguist-vendored)
- `.gitattributes` EXISTS at repo root.
  - line: `templates/web-bridge/chrome-extension/** linguist-vendored`
- `git ls-files '*.js'` → exactly 3 files, all under that path (covered):
  - templates/web-bridge/chrome-extension/background.js
  - templates/web-bridge/chrome-extension/content-script.js
  - templates/web-bridge/chrome-extension/popup.js
- All 3 template .js are linguist-vendored via the glob. STATUS: DONE.

## Coder-lane note
No remediation action required for B1 or A1 — both already landed in commit
c04766d. Optional cleanup only: the @deprecated raw RELEASE_GATE_WEIGHTS in
weakness-remediation.ts:43-54 could be removed once all callers confirmed on
releaseGateEffective(). Verify before deleting (do not modify in recon).
