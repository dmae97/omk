# Goal#3 SAFETY KILL GATE — Recon (READ-ONLY)
Date: 2026-06-10 | Mode: read-only (rg/sed/cat/jq/git). No edits, no web.

## STATUS summary
- ADR: PARTIAL
- native-removal: OPEN
- secret-perf: OPEN
- writableRoots: OPEN (defined, NOT enforced in tool dispatch)

---

## 1. Native (Rust) surface still present — ALL still exist
git ls-files | rg -i 'native|rust|crates|cargo' confirms every target file is still tracked:
- crates/omk-safety/{Cargo.toml,README.md,src/lib.rs,src/main.rs}
- Cargo.toml, Cargo.lock
- scripts/build-native.mjs
- scripts/rust-safety-check.mjs
- scripts/normalize-native-artifacts.mjs
- src/util/native-safety.ts
Additional native-coupled surface (not in original list, in scope for removal):
- src/cli/ui/rust-forge-renderer.ts
- src/commands/chat/native-root-loop.ts
- src/web-bridge/native-host.ts
- docs/native-root-runtime-algorithms.md, docs/native-root-runtime-hardening.md
- tests: test/native-safety-loader.test.mjs, test/no-kimi-native-turn.test.mjs,
  test/rust-forge-renderer.test.mjs, test/rust-safety-harness.test.mjs
Result: 7/7 listed native files EXIST. STATUS=OPEN.

## 2. package.json + CI references (native/rust still wired)
package.json scripts:
- :49 "rust:check": node scripts/rust-safety-check.mjs
- :50 "rust:build": cargo build -p omk-safety
- :51 "native:build": node scripts/build-native.mjs
- :52 "native:normalize": node scripts/normalize-native-artifacts.mjs
- :53 "native:no-kimi:turn": node --test test/no-kimi-native-turn.test.mjs
- :48 verify:no-kimi -> invokes native:no-kimi:turn
- :41 release:check / :42 release:full / :44 release:rc -> ALL invoke native:build
CI invoking them:
- .github/workflows/ci.yml:42, :151 -> npm run native:build (rust-toolchain :28,:150,:162)
- .github/workflows/release.yml:46 rust:check, :74 native:build, :103 native:normalize (rust-toolchain :45,:73)
- .github/workflows/smoke-test.yml:33 native:build, :72 native:normalize (rust-toolchain :32)
Result: release + 3 CI workflows depend on native lane. STATUS=OPEN.

## 3. ADR
- ADR draft EXISTS (tracked): proof/rust-lane-2026-06-10/adr-draft-no-native-lane.md (2677 bytes)
- docs/adr/ : MISSING — not created, not committed.
- Note: an unrelated ADR lives at docs/decisions/ADR-theme-dark-only-assets.md (different dir).
Result: draft present but no committed docs/adr/. STATUS=PARTIAL.

## 4. Secret scanner O(matches x n) perf bug — CONFIRMED present
File: src/mcp/secret-scanner.ts
- getLineColumn defined at :729 (loops i=0..offset for EVERY call -> O(n) per match)
- Called inside per-match loops at :454 and :696 -> overall O(matches x n).
Result: pattern still exists. STATUS=OPEN. Fix point: src/mcp/secret-scanner.ts:729 (precompute newline offsets / binary search).

## 5. writableRoots — defined but NOT enforced in OMK tool dispatch
- Defined: src/runtime/sandbox-profile.ts:13 (interface), :24 (option), :40 (default),
  defaultWritableRoots() :48-55 (returns [cwd] only when mode=workspace-write & enforcement=provider-native, else []).
- Consumed only by provider runtimes as descriptive metadata passed to external sandboxes:
  - src/runtime/codex-runtime.ts:186 writableRoots = workspace-write ? [cwd] : []
  - src/runtime/external-cli-adapter.ts:296 writableRoots: []
- No internal enforcement: rg found NO isPathWritable/assertWritable/withinWritable in src.
  OMK write/edit tool dispatch does not check writableRoots.
Result: metadata-only, not enforced. STATUS=OPEN.
