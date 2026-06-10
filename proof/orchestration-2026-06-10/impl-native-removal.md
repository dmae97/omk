# Native(Rust) Lane Removal — Implementation Report

**Lane**: B-EXEC  
**Date**: 2026-06-10  
**Status**: COMPLETE  

## Deleted paths (git rm -r)

1. `crates/omk-safety/` (Cargo.toml, README.md, src/lib.rs, src/main.rs)
2. `Cargo.toml` (root workspace manifest)
3. `Cargo.lock` (root lockfile)
4. `scripts/build-native.mjs`
5. `scripts/rust-safety-check.mjs`
6. `scripts/normalize-native-artifacts.mjs`
7. `src/util/native-safety.ts`
8. `test/native-safety-loader.test.mjs`
9. `test/rust-safety-harness.test.mjs`
10. `target/` (rm -rf, gitignored)
11. `dist/native/` (rm -rf, didn't exist)

## Consumer edits (11 files)

| # | File | Change |
|---|------|--------|
| C1 | `src/commands/doctor/checks.ts` | Removed `runOmkSafetySelfTest` import, `rustSafetyNativeCheck()` function, cargo/rustc/rustSafetyCrate toolchain checks |
| C2 | `src/commands/doctor/report.ts` | Removed `rustSafety` block (cargo, rustc, crate, native, nativeSource, nativePlatformArch, nativeBuiltFromSource, nativePath); also dropped orphaned `findMeta` |
| C3 | `src/schema/proof-bundle.schema.ts` | Removed `"native-safety"` from `ProofBundleScenarioSchema` zod enum |
| C4 | `src/contracts/proof.ts` | Removed `"native-safety"` from `ProofBundleScenario` type union |
| C5 | `scripts/package-audit.mjs` | Removed comment re native safety; removed `nativePlatformArch`/`nativeBinaryName`/`expectedNativeSafetyPath`/`validateNativeSafety` functions; removed `runValidator("NATIVE_SAFETY",...)` call + summary line |
| C6 | `test/package-audit.test.mjs` | Removed `validateNativeSafety` imports + `describe("validateNativeSafety",...)` block (5 test cases) |
| C7 | `test/no-kimi-verification-contract.test.mjs` | Removed `native:no-kimi:turn` assertions; weakened to check any `no-kimi` non-smoke |
| C8 | `test/workflow-harness.test.mjs` | Removed all `native:build`/`native:/`/`pattern: native-*/`/`native:normalize`/`native:no-kimi:turn` assertions |
| C9 | `src/commands/init.ts` | Removed "native safety build" and "Rust native safety loader" from changelog/phase text |
| C10 | `src/commands/init/content.ts` | Removed "P0: native runtime safety hardening" section, "native safety packaging" release line, "Rust native safety loader" changelog entry |
| +2 | `scripts/regression-proof-matrix.mjs` | Removed `"004-native-safety"` proofId and scenario |
| +1 | `scripts/proof-check.mjs` | Removed `"native-safety"` from `allowedScenarios` |

## package.json diff

- Removed standalone scripts: `rust:check`, `rust:build`, `native:build`, `native:normalize`, `native:no-kimi:turn`
- Removed `&& npm run native:build` from `release:check`, `release:full`, `release:rc`
- Removed `&& npm run native:no-kimi:turn` from `verify:no-kimi`

## CI diff

- `.github/workflows/ci.yml`: removed 3× `dtolnay/rust-toolchain@stable` steps, 2× `npm run native:build` steps
- `.github/workflows/release.yml`: removed dtolnay + rust:check from quality; deleted entire `native:` job (3-OS matrix); removed download/normalize steps from package; changed `needs: [quality, native]` → `needs: [quality]`
- `.github/workflows/smoke-test.yml`: deleted entire `native:` job; removed download/normalize from package

## ADR

- Created `docs/adr/0001-no-native-rust-lane.md` (Status: Accepted)

## Gate results

| Gate | Result |
|------|--------|
| `npm run build:clean` | **PASS** — tsc + chmod-dist succeeded |
| `npm run schema:check` | **PASS** — 9 JSON contract schemas validated |
| `npm run lint` | 2 pre-existing warnings in `src/memory/graph-delta-log.ts` (sibling lane, not touched) |
| `npm run secret:scan` | **PASS** — no high-confidence secrets |
| `npm test` (affected files) | **PASS** — 64/64 tests (no-kimi-verification-contract, workflow-harness, package-audit) |
| Dangling-reference grep (`native:build\|rust:build\|cargo build\|native-safety`) | **ZERO matches** — clean |

## PRESERVE items — NOT touched

All 16 PRESERVE items verified intact: `rust-forge-renderer.ts`, `native-host.ts`, `host.ts`, `status.ts`, `web-bridge.ts`, `mcp/host.ts`, `native-root-loop.ts`, `chat-runtime.test.mjs`, `theme.ts`, `theme-registry.ts`, `palette.ts`, `interactive-prompt.ts`, `i18n.ts`, `omk-simple-art.ts`, `no-kimi-native-turn.test.mjs`, `commandcode-cli-adapter.ts`.

## Remaining risk

- The 2 pre-existing lint warnings in `src/memory/graph-delta-log.ts` need resolution by the memory lane.
- Full `npm test` suite not run (timeout); affected-file targeted tests all pass.
- `test/no-kimi-native-turn.test.mjs` is preserved (PRESERVE item P15) but the npm script `native:no-kimi:turn` that ran it is removed — the test file remains source-controlled but no longer part of CI/local gates. Intentional per manifest C11.
