# Phase 0 — Recon & Baseline (rust-lane evaluation)

Date: 2026-06-10 · repo: open-multi-agent-kit v0.78.6 · node v22.22.3 · cargo 1.93.1

## What exists in `crates/omk-safety` today

- `crates/omk-safety/{Cargo.toml,README.md,src/lib.rs,src/main.rs}` — **zero dependencies, `publish = false`**.
- Contents are NOT the three safety functions: `lib.rs` holds theme-color tables
  (`NIGHT_CITY_RUST_COLORS`), run-id/artifact-path validation; `main.rs` is a `--self-test` binary.
- Already wired into the repo: `scripts/build-native.mjs` (npm `native:build`, in `release:check/full/rc`),
  `scripts/rust-safety-check.mjs`, `scripts/normalize-native-artifacts.mjs`, `scripts/package-audit.mjs`,
  `src/util/native-safety.ts` (lane resolution), `src/commands/doctor/checks.ts:253,358` (doctor reports lane),
  CI: `.github/workflows/{ci,release,smoke-test}.yml`. No `rust-toolchain.toml` exists.

## Candidate hot paths (recon by 3 parallel lanes: omk-explorer ×2, omk-security)

| Candidate | Canonical implementation | Call frequency | Notes |
|---|---|---|---|
| redact_stream | `src/mcp/governance.ts:384` `redactSecrets` (16 patterns, fast lane, per MCP tool result) + `src/mcp/secret-scanner.ts:441 scanText` (20 patterns, deep lane, per event/record via `state-persister.ts:16` walker) | per tool result / per telemetry event | inputs bounded: tool text later truncated to 4000 chars (`governance.ts:162`); events truncated post-redaction |
| sanitize_env | `src/runtime/child-env.ts:104` `buildChildEnvWithMetadata` (23-name allowlist + 11-regex denylist) | **once per child spawn** (cold) | dup in `src/{kimi,adapters/kimi}/runner.ts:97-98` |
| check_path_policy | `src/safety/tool-authority-gate.ts:115,240` (mode-level enum gate, **no path input**); only real path containment: `src/mcp/filesystem-readonly-server.ts:163-175` (`realpath` + `relative`) | per tool call / per MCP file op | syscall-bound (`realpath`); `sandbox-profile.ts:13` `writableRoots` declared but **never consulted** (gap) |

## Measured baseline table

Representative offline runs (live chat runs are network-dominated; p there is strictly lower):

- Run A: `node --cpu-prof scripts/run-benchmark.mjs --shadow` → wall 0.109 s (gates passed)
- Run B: `node --cpu-prof --test test/no-kimi-native-turn.test.mjs` → wall 1.757 s (full native turn)
- Profiles + analysis: `cpuprofile/`, `cpuprofile-analysis.txt`

| candidate path | file | p (% end-to-end wall, Run B) | p (Run A) | bytes/sec today (TS) |
|---|---|---|---|---|
| redact (gov fast lane + scanner) | src/mcp/governance.ts, src/mcp/secret-scanner.ts | **0.297%** | 0.000% | gov lane: 65.8 MB/s @4KiB clean · 23.8 MB/s @4KiB w/secrets · 93–248 MB/s @64KiB · 254–428 MB/s @1MiB |
| sanitize_env | src/runtime/child-env.ts | **0.018%** | 0.000% | n/a (≈0.3 ms total per spawn batch; O(env×11 regex)) |
| check_path_policy | src/safety/tool-authority-gate.ts (+ fs-readonly-server) | **0.000%** (below sampling resolution) | 0.000% | syscall-bound (realpath dominates) |

Throughput bench: `ts-throughput-bench.txt` (dist build of the actual shipped functions).

## Critical incidental finding (independent of Rust)

`SecretScanner.scanText` is **superlinear**: `getLineColumn` (`secret-scanner.ts:729-741`) rescans
text from offset 0 for every match → O(matches × n):

- 64 KiB with secrets: 13.6 ms/call (4.8 MB/s) — below the 32 MB/s floor
- 1 MiB with secrets: **3 404 ms/call (0.3 MB/s)**

Root-cause fix is ~20 lines of TS (precompute newline offsets once + binary search), not a native lane.

**Phase-0 threshold check: no candidate reaches p = 5%. Highest is 0.297%. → proceed to Kill Gate math.**
