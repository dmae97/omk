# Lane WEIGHTS-PERSONA — Verification Report

Date: 2026-06-10
Verifier: omk-quality-gate + omk-evidence-contract

---

## 1. Per-File Slice Classification

| File | Slice | Evidence / Reason |
|------|-------|-------------------|
| `schemas/omk.weights.v1.json` | **A** | New weights contract (data contract, not JSON Schema). |
| `src/runtime/weights-config.ts` | **A** | Loads/normalizes the contract; exports `releaseGateEffective`, `routerV2CompositeEffective`, `intentCapabilityWeights`. |
| `test/weights-config.test.mjs` | **A** | Contract tests: normalization invariants, JSON-vs-embedded parity, release-gate verdict parity (300 inputs), Router V2 ranking parity (50 inputs). |
| `src/runtime/router-v2-scoring.ts` | **A** | Imports `weights-config.js` (`intentCapabilityWeights`, `routerV2CompositeEffective`) and replaces inline raw weights with normalized effective weights. Diff adds `import { intentCapabilityWeights, routerV2CompositeEffective } from "./weights-config.js";` and replaces all magic numbers. |
| `src/runtime/contracts/weakness-remediation.ts` | **A** | Adds `@deprecated` JSDoc pointing to `omk.weights.v1` contract and `weights-config.ts`. Does NOT change behavior; purely documentation migration. Part of the weights-config workstream because it retires the old inline constant. |
| `src/cli/release-promotion-gate.ts` | **A** | Imports `releaseGateEffective` from `weights-config.js`; replaces `RELEASE_GATE_WEIGHTS` consumption with normalized effective weights + dynamic thresholds. Verdict logic mathematically identical (uniform scaling). |
| `scripts/verify-no-persona.mjs` | **B** | New deploy-exclusion guard. Scans publishable artifacts for 11 persona-leak markers. |
| `package.json` (diff hunk) | **B** | Exactly 4 persona lines: `"verify:no-persona"` script definition + insertion into `release:check`, `release:full`, `release:rc`. Theme lines already committed per context. |

> **Rationale for `weakness-remediation.ts` and `release-promotion-gate.ts`:** Both files are changed ONLY to migrate their weight constants into the centralized `omk.weights.v1` contract consumed via `weights-config.ts`. They contain no persona-related logic. Therefore they belong to Slice A, not B.

---

## 2. Slice A Verification (weights-config)

### 2a Schema registration in `scripts/validate-json-contracts.mjs`
- **Status:** NOT registered; `omk.weights.v1.json` is **silently skipped** by `npm run schema:check`.
- **Root cause:** `validate-json-contracts.mjs` validates JSON Schema files (`.schema.json`) with required fields `$schema`, `$id`, and `properties.schemaVersion.const`. `omk.weights.v1.json` is a **data contract**, not a JSON Schema. Registering it in the same loop would fail those checks.
- **Action taken:** None (see risk note). The contract is validated by `test/weights-config.test.mjs` instead.
- **Re-run after no-op:** `npm run schema:check` → `validated 9 OMK JSON contract schemas` ✅ (exit 0)

### 2b Contract tests
```bash
node --test test/weights-config.test.mjs
```
- **Exit code:** 0
- **Results:** 7/7 passed
  - normalize:true vectors satisfy Σŵ = 1 ± 1e-6 ✅
  - normalizeVector scales penalties and thresholds by the same factor ✅
  - normalizeVector throws the invariant error for a violating vector ✅
  - schemas/omk.weights.v1.json deep-equals embedded DEFAULT_WEIGHTS ✅
  - loadWeightsConfig returns the contract (file or embedded) ✅
  - release gate verdict parity: 300 seeded random inputs ✅
  - router V2 ranking parity: 50 seeded random runtime/score sets ✅

### 2c Router V2 scoring tests
```bash
node --test test/router-v2-scoring.test.mjs
```
- **Exit code:** 0
- **Results:** 14/14 passed ✅

### 2d TypeScript compilation
```bash
npx tsc --noEmit
```
- **Exit code:** 0 ✅

---

## 3. Slice B Verification (verify-no-persona)

### 3a Script execution
```bash
node scripts/verify-no-persona.mjs
```
- **Exit code:** 0
- **Output:** `PERSONA ISOLATION OK (1462 publishable file(s) scanned; 11 markers).`
- **Scan scope:** Exactly the `package.json` `files` whitelist (directories walked recursively; root files scanned directly). Binary files and missing paths skipped gracefully.

### 3b package.json wiring audit
Diff inspection confirms **exactly 4 persona-related lines** in `package.json`:
1. `"verify:no-persona": "node scripts/verify-no-persona.mjs",` (added)
2. `release:check` → `verify:no-persona && ` inserted
3. `release:full` → `verify:no-persona && ` inserted
4. `release:rc` → `verify:no-persona && ` inserted

No unrelated changes in the package.json diff hunk.

### 3c Legacy-identity surface guard
```bash
node scripts/no-legacy-identity-surface.mjs
```
- **Exit code:** 0
- **Output:** `Default OMK public surface contains no legacy identity markers (947 files checked).` ✅
- **Banned tokens:** `verify-no-persona.mjs` introduces NO banned legacy-identity tokens (markers are leak-detection patterns, not identity declarations).

---

## 4. ESLint Results

```bash
# Slice A src files
npx eslint src/runtime/weights-config.ts src/runtime/router-v2-scoring.ts \
  src/runtime/contracts/weakness-remediation.ts src/cli/release-promotion-gate.ts
```
- **Exit code:** 0 ✅

```bash
# Slice B script (outside src/; tsconfig excludes scripts/)
npx eslint --parser-options=projectService:false scripts/verify-no-persona.mjs
```
- **Exit code:** 0 ✅

```bash
# test file is explicitly ignored by eslint.config.mjs
npx eslint test/weights-config.test.mjs
```
- **Result:** File ignored by matching ignore pattern (expected; no error) ✅

---

## 5. Exact Commit File Lists for Root

### Commit 1 — `feat(runtime): weights config contract`
```
schemas/omk.weights.v1.json
src/runtime/weights-config.ts
test/weights-config.test.mjs
src/runtime/router-v2-scoring.ts
src/runtime/contracts/weakness-remediation.ts
src/cli/release-promotion-gate.ts
```

### Commit 2 — `feat(release): persona truth gate`
```
scripts/verify-no-persona.mjs
package.json
```

---

## 6. UNSAFE / Broken / Incomplete Flags

| Item | Severity | Details |
|------|----------|---------|
| `omk.weights.v1.json` not in `validate-json-contracts.mjs` | ⚠️ Low / Documented | It is a data contract, not a JSON Schema. The existing `schema:check` script validates `.schema.json` files. The contract is covered by `test/weights-config.test.mjs` (deep-equal + parity tests). **Not a blocker**, but a future enhancement could add a dedicated data-contract validator. |
| `scripts/verify-no-persona.mjs` outside `tsconfig.json` | ⚠️ Low | `tsconfig.json` only includes `src/**/*`. The script is plain Node.js ESM with no type dependencies. ESLint requires `--parser-options=projectService:false` to lint it. This is consistent with other scripts. Not a runtime issue. |
| No changes required | — | All other surfaces pass. |

---

## 7. Remaining Risk

1. **Schema registration gap:** If future engineers assume `schema:check` validates ALL schema files, they may miss that `omk.weights.v1.json` is excluded from `validate-json-contracts.mjs`. Mitigation: the test file enforces parity; consider a comment in `validate-json-contracts.mjs` noting the data-contract vs JSON-schema distinction.
2. **Persona marker drift:** `verify-no-persona.mjs` relies on a hardcoded marker list. If new persona vocabulary is introduced in source files, the marker list must be updated. Mitigation: the script is wired into `release:check`, so any leak that matches existing markers will block release.
3. **Default weights drift:** `DEFAULT_WEIGHTS` in `weights-config.ts` must stay byte-identical to `schemas/omk.weights.v1.json`. This is enforced by test, but if someone edits one without the other, the test will catch it.

---

**Overall verdict:** Both slices are clean, tested, and safe to commit. No mutations required beyond the no-op schema registration investigation.
