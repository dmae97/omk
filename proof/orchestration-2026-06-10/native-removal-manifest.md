# Native(Rust)-Lane Removal Manifest — READ-ONLY

**Date**: 2026-06-10  
**Status**: READ-ONLY reconnaissance — NO deletions performed.  
**Source ADR**: `proof/rust-lane-2026-06-10/adr-draft-no-native-lane.md`  
**Amdahl ceiling**: all 3 hot-path candidates < 1.004 (max 1.0030) — gate ≥1.15 unreachable.

---

## Section 1: SAFE-TO-DELETE — RUST-LANE allowlist

These are paths that are exclusively Rust binary surface or exist solely to support it.
Verify each has NO transit dependency from PRESERVE-CHROME or PRESERVE-TUI files.

### 1a. Rust crate source

| # | Path | Reason |
|---|------|--------|
| 1 | `crates/` (entire directory) | omk-safety Rust crate: `Cargo.toml`, `src/main.rs`, `src/lib.rs`, `README.md` |
| 2 | `Cargo.toml` (root) | Workspace manifest, single member `crates/omk-safety` |
| 3 | `Cargo.lock` (root) | Lockfile for the workspace above |

### 1b. Build/check/normalize scripts

| # | Path | Reason |
|---|------|--------|
| 4 | `scripts/build-native.mjs` | Invokes `cargo build -p omk-safety --release`, copies to `dist/native/` |
| 5 | `scripts/rust-safety-check.mjs` | Runs `cargo test` + `cargo run -- self-test` + validate-run-artifact |
| 6 | `scripts/normalize-native-artifacts.mjs` | chmod + self-test on `dist/native/` artifacts |

### 1c. TypeScript bridge (only exists to call Rust binary)

| # | Path | Reason |
|---|------|--------|
| 7 | `src/util/native-safety.ts` | `resolveOmkSafetyNative`, `runOmkSafetySelfTest` — searches for `omk-safety` binary, runs it |

### 1d. Tests that exercise the Rust binary directly

| # | Path | Reason |
|---|------|--------|
| 8 | `test/native-safety-loader.test.mjs` | Tests `resolveOmkSafetyNative` from `dist/util/native-safety.js` |
| 9 | `test/rust-safety-harness.test.mjs` | Spawns `cargo run -p omk-safety` for every test case |

### 1e. Build artifacts (git-ignored, remove manually)

| # | Path | Reason |
|---|------|--------|
| 10 | `target/` | Cargo build output directory |
| 11 | `dist/native/` | Compiled binary output from `build-native.mjs` |

---

## Section 2: CONSUMER-UPDATE list

Every file that imports, references, or asserts against a to-be-deleted module,
plus the exact change needed to keep the build green.

### 2a. Direct import of native-safety.ts → DELETE import + remove Rust safety doctor checks

| # | File | Line(s) | Change |
|---|------|---------|--------|
| C1 | `src/commands/doctor/checks.ts` | 5, 253, 358, 377–385 | Remove `import { runOmkSafetySelfTest } from "../../util/native-safety.js"`. Remove `rustSafetyNativeCheck()` function (lines 377–385). In `toolchainChecks()`, remove: `cargoExists`/`rustcExists`/`rustSafetyCrateExists` checks (lines 246–248, 253), remove "Rust Cargo", "Rust Compiler", "Rust Safety Crate" doctor checks (lines 337–359), remove `results.push(await rustSafetyNativeCheck(root))` (line 361). |
| C2 | `src/commands/doctor/report.ts` | 102–107 | Remove `crate`, `native`, `nativeSource`, `nativePlatformArch`, `nativeBuiltFromSource`, `nativePath` meta lookups. |

### 2b. Schema/contract references → remove enum member

| # | File | Line(s) | Change |
|---|------|---------|--------|
| C3 | `src/schema/proof-bundle.schema.ts` | 12 | Remove `"native-safety"` from `ProofBundleScenarioSchema` zod enum. |
| C4 | `src/contracts/proof.ts` | 12 | Remove `\| "native-safety"` from `ProofBundleScenario` type union. |

### 2c. package-audit native validators → remove functions + validator call

| # | File | Line(s) | Change |
|---|------|---------|--------|
| C5 | `scripts/package-audit.mjs` | 116, 364–396, 814, 877 | Remove comment on line 116. Remove functions `nativePlatformArch`, `nativeBinaryName`, `expectedNativeSafetyPath`, `validateNativeSafety` (lines 364–396). Remove `runValidator("NATIVE_SAFETY", ...)` call (line 814). Remove native safety line from summary (line 877). |
| C6 | `test/package-audit.test.mjs` | 20, 24, 451–486 | Remove `validateNativeSafety` and `expectedNativeSafetyPath` from import; remove `describe("validateNativeSafety", ...)` block (lines 454–486); remove `nativeBinaryName` test assertions (line 458–459). |

### 2d. Test contracts that assert native:* scripts exist → weaken/split assertions

| # | File | Line(s) | Change |
|---|------|---------|--------|
| C7 | `test/no-kimi-verification-contract.test.mjs` | 11, 13, 20, 53 | Remove assertions about `native:no-kimi:turn` exist/position. Keep `verify:no-kimi` structural checks but drop the `native:no-kimi:turn` member requirement. |
| C8 | `test/workflow-harness.test.mjs` | 24, 33–35, 37, 49, 51–52, 54, 67, 70 | Remove all `assert.match(workflow, /npm run native:build/)`, `/npm run native:normalize/`, `/npm run native:no-kimi:turn/`, `/pattern: native-\*/`, `/native:/` assertions. Keep non-native assertions intact. |

### 2e. Init/docs changelog references → rewrite without native claims

| # | File | Line(s) | Change |
|---|------|---------|--------|
| C9 | `src/commands/init.ts` | 457, 501 | Remove "native safety build" and "Rust native safety loader" from changelog/phase text. |
| C10 | `src/commands/init/content.ts` | 372, 383, 388, 428 | Remove "P0: native runtime safety hardening" section and native safety references. |

### 2f. No-Kimi native turn test → the test itself is a proper smoke test; rename + remove package.json script

| # | File | Change |
|---|------|--------|
| C11 | `test/no-kimi-native-turn.test.mjs` | File does NOT import native-safety.ts — it tests RuntimeBackedTaskRunner worker context. Keep file, but no changes needed beyond removing the `native:no-kimi:turn` script entry. |

---

## Section 3: package.json script lines to remove

### 3a. Standalone scripts to delete entirely

```json
"rust:check": "node scripts/rust-safety-check.mjs",
"rust:build": "cargo build -p omk-safety",
"native:build": "node scripts/build-native.mjs",
"native:normalize": "node scripts/normalize-native-artifacts.mjs",
"native:no-kimi:turn": "OMK_MCP_PREFLIGHT=off OMK_PROJECT_ROOT=\"$PWD\" node --test test/no-kimi-native-turn.test.mjs",
```

### 3b. Composite scripts to modify (remove native steps)

**`release:check`** (line 41):
- Remove: `&& npm run native:build`

**`release:full`** (line 42):
- Remove: `&& npm run native:build`

**`release:rc`** (line 44):
- Remove: `&& npm run native:build`

**`verify:no-kimi`** (line 48):
- Remove: `&& npm run native:no-kimi:turn`
- Note: `test:no-kimi:runtime-routing` already covers runtime routing independently.

---

## Section 4: CI workflow steps to remove

### 4a. `.github/workflows/ci.yml`

| Job | Line ref | Change |
|-----|----------|--------|
| `fast-gate` | `- uses: dtolnay/rust-toolchain@stable` (line 28) | Remove entire step |
| `fast-gate` | `- run: npm run native:build` (line 44) | Remove entire step |
| `build` (matrix) | `- uses: dtolnay/rust-toolchain@stable` (line 150) | Remove entire step |
| `build` (matrix) | `- run: npm run native:build` (line 151) | Remove entire step |
| `release-check` | `- uses: dtolnay/rust-toolchain@stable` (line 162) | Remove entire step |

### 4b. `.github/workflows/release.yml`

| Job | Line ref | Change |
|-----|----------|--------|
| `quality` | `- uses: dtolnay/rust-toolchain@stable` (line 45) | Remove entire step |
| `quality` | `- run: npm run rust:check` (line 46) | Remove entire step |
| `native` | Entire job (lines 58–76) | **Delete the entire `native:` job** — 3-OS matrix building native binaries |
| `package` | `- name: Download native safety artifacts` step + `- name: Normalize native safety artifact modes` step | Remove both steps; remove `needs: [quality, native]` → change to `needs: [quality]` |

### 4c. `.github/workflows/smoke-test.yml`

| Job | Line ref | Change |
|-----|----------|--------|
| `native` | Entire job (lines 23–39) | **Delete the entire `native:` job** — 3-OS matrix building native binaries |
| `package` | `- uses: dtolnay/rust-toolchain@stable` (line 32) | Already removed with job |
| `package` | `- name: Download native safety artifacts` + `- name: Normalize native safety artifact modes` steps | Remove both steps; change `needs: [native]` → remove `needs` or chain differently |

---

## Section 5: PRESERVE list — MUST NOT be deleted

These files contain the token "native" or "rust" but are UNRELATED to the Rust binary.

### 5a. Chrome Native Messaging (web-bridge)

| # | Path | Reason |
|---|------|--------|
| P1 | `src/web-bridge/native-host.ts` | Chrome extension native messaging host. Uses `Buffer.readUInt32LE` for Chrome's message framing protocol. Zero relation to Rust. |
| P2 | `src/web-bridge/host.ts` | Web-bridge request handler imported by native-host.ts |
| P3 | `src/web-bridge/status.ts` | Web-bridge status module |
| P4 | `src/contracts/web-bridge.ts` | Web-bridge contract types (`WEB_BRIDGE_MAX_PAYLOAD_BYTES`) |
| P5 | `src/mcp/host.ts` | MCP host server (separate from web-bridge) |

**Verification**: `native-host.ts` imports only `process.stdin/stdout`, `../contracts/web-bridge.js`, and `./host.js`. No transit to `native-safety.ts`, `crates/`, `Cargo.toml`, or any Rust script. ✅

### 5b. Terminal TUI root loop (chat)

| # | Path | Reason |
|---|------|--------|
| P6 | `src/commands/chat/native-root-loop.ts` | OMK's interactive chat REPL — the "native" in its name means "terminal-native" (vs. web or VS Code). ~1200 lines of readline/slash-command/parallel-turn orchestration. ZERO Rust imports. |
| P7 | `test/chat-runtime.test.mjs` | Tests native-root-loop.ts (chat REPL). All "native" references are to the chat loop, not Rust. |

**Verification**: `native-root-loop.ts` imports: `orchestration.js`, `runtime-bootstrap.js`, `dag.js`, `capability-injection.js`, `debloat-nlp.js`, `prompt-envelope.js`, `input-envelope.js`, `terminal-owner.js`, `renderer.js`, `harness/execute-harness-run.js`, providers, slash commands, TUI model, brand theme. No import of `native-safety.ts`, `crates/`, or Rust scripts. ✅

### 5c. Rust-themed branding/UI (visual only, zero Rust dependency)

| # | Path | Reason |
|---|------|--------|
| P8 | `src/cli/ui/rust-forge-renderer.ts` | Visual renderer using `RUST_FORGE_THEME` from `brand/theme.ts`. Imports: `event.js`, `renderer.js`, `system24-renderer.js`, `brand/theme.js`, `brand/palette.js`, `ui/omk-sigil.js`. ZERO imports from `native-safety.ts` or any Rust-related module. Purely decorative "forge" aesthetic. |
| P9 | `src/brand/theme.ts` | Defines `RUST_FORGE_THEME` object with color/symbol/motto constants. Tagline "Rust-native safety console" is theming only. Imports: `palette.js`, `theme-compiled.js`. |
| P10 | `src/cli/theme/theme-registry.ts` | `rust-forge` palette entry (lines 178–319). Themed color rendering. |
| P11 | `src/brand/palette.ts` | Color tokens: `rustOrange`, `rustOxide`, `cargoGreen`, `rustEmber`, `rustCrimson` — these are hex colors, not Rust code. |
| P12 | `src/cli/v2/interactive-prompt.ts` (line 66) | `{ value: "rust-forge", label: "Rust Forge", hint: "Rust/native safety console" }` — UI option label. |
| P13 | `src/util/i18n.ts` (lines 101, 113, 537, 551) | `"chat.intro.rustForge": "OMK Rust Forge ready"` — i18n banner strings. Themed naming. |
| P14 | `src/brand/omk-simple-art.ts` | ASCII art with OMK branding. Themed. |

**Verification**: All rust-forge themed files trace only to `brand/theme.ts` → `brand/palette.ts` + `brand/theme-compiled.ts`. No transit to `native-safety.ts`, `crates/`, `Cargo.toml`, or Rust scripts. ✅

### 5d. Other files with coincidental "native"/"rust" in name

| # | Path | Reason |
|---|------|--------|
| P15 | `test/no-kimi-native-turn.test.mjs` | Tests RuntimeBackedTaskRunner worker context. The word "native" in the name refers to the chat native-root-loop, not Rust. No import of `native-safety.ts`. |
| P16 | `src/adapters/commandcode/commandcode-cli-adapter.ts` | Has a `rustVersion` field in a package-info struct — purely coincidental data field. |

---

## Section 6: GREEN-BUILD ordering (delete after consumer updates)

**Phase 1 — Consumer prep** (make build green BEFORE touching Rust files):
1. C3, C4: Remove `"native-safety"` from proof schema + contract
2. C1, C2: Doctor checks — remove Rust safety import + function + report meta
3. C5: package-audit.mjs — remove native validator functions + call
4. C6: package-audit.test.mjs — remove native safety test block
5. C7, C8: no-kimi-verification-contract + workflow-harness tests — weaken assertions
6. C9, C10: Init docs — remove native changelog entries

**Phase 2 — Script surgery**:
7. Remove standalone npm scripts: `rust:check`, `rust:build`, `native:build`, `native:normalize`, `native:no-kimi:turn`
8. Remove `&& npm run native:build` from `release:check`, `release:full`, `release:rc`
9. Remove `&& npm run native:no-kimi:turn` from `verify:no-kimi`

**Phase 3 — CI de-wiring**:
10. ci.yml: remove `dtolnay/rust-toolchain@stable` steps (×3), remove `npm run native:build` steps (×2)
11. release.yml: remove `dtolnay/rust-toolchain@stable` + `npm run rust:check` from quality, delete `native:` job, remove download/normalize from package
12. smoke-test.yml: delete `native:` job, remove download/normalize from package

**Phase 4 — File deletion** (last, after all consumers are updated):
13. Delete: `crates/`, `Cargo.toml`, `Cargo.lock`
14. Delete: `scripts/build-native.mjs`, `scripts/rust-safety-check.mjs`, `scripts/normalize-native-artifacts.mjs`
15. Delete: `src/util/native-safety.ts`
16. Delete: `test/native-safety-loader.test.mjs`, `test/rust-safety-harness.test.mjs`
17. Delete: `target/`, `dist/native/`

**Verification after all phases**:
```bash
npm run check        # tsc --noEmit
npm run build:clean  # clean dist + full TS build
npm run lint         # eslint
npm run test         # run-tests.mjs
```

---

## Appendix: Amdahl evidence summary

| candidate | p (wall fraction) | ceiling 1/(1−p) | gate ≥1.15 | verdict |
|---|---|---|---|---|
| redact_stream | 0.297% | 1.0030 | FAIL | TS hot lane already 65–428 MB/s |
| sanitize_env | 0.018% | 1.0002 | FAIL | Cold path, once per spawn |
| check_path_policy | <0.06% | ≈1.0000 | FAIL | Realpath syscall-bound |

No speedup s can satisfy the gate for any candidate; the Rust surface's maximum theoretical benefit is +0.30%.
Full profiles at `proof/rust-lane-2026-06-10/`.

---

## Reclassification note

| File | Initially | Final classification | Reason |
|------|-----------|---------------------|--------|
| `src/cli/ui/rust-forge-renderer.ts` | INVESTIGATE | PRESERVE | Themed naming only; imports `brand/theme.ts`, not `native-safety.ts`. |
| `test/no-kimi-native-turn.test.mjs` | RUST-LANE suspect | PRESERVE (no-op change) | Tests worker context in chat loop, not Rust. No native-safety import. Only the npm script referencing it is removed. |
