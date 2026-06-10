# ADR-0001: No native Rust lane for omk-safety

Status: Accepted
Date: 2026-06-10

## Context

`crates/omk-safety` was scaffolded as a future native lane for safety hot paths
(redact_stream / sanitize_env / check_path_policy). Remediation item A4 required either
building it into a measured, shippable lane or killing it with evidence.

## Decision

Remove the Rust surface. Keep TypeScript as the only implementation.

## Evidence (measured, not estimated)

| candidate | p (wall fraction, representative run) | Amdahl ceiling 1/(1−p) | gate (≥1.15) | capability gate |
|---|---|---|---|---|
| redact_stream | 0.297% | 1.0030 | FAIL (unreachable even at s=∞) | FAIL — TS hot lane already 65–428 MB/s; 0.26–0.70 ms per 64 KiB ≤ 2 ms budget |
| sanitize_env | 0.018% | 1.0002 | FAIL | FAIL — cold path, once per spawn |
| check_path_policy | <0.06% (below sampler resolution) | ≈1.0000 | FAIL | FAIL — realpath syscall-bound |

s (local Rust speedup) was not measured: with all ceilings < 1.004, no finite or infinite
s can satisfy the gate; building napi bindings to measure it cannot change the outcome.

Profiles, throughput benches, and analysis: `proof/rust-lane-2026-06-10/`.

## Removal scope (larger than "delete crates/" — wired surfaces)

- `crates/`, root `Cargo.toml`, `Cargo.lock` (no rust-toolchain.toml exists)
- package.json: `rust:build`, `native:build`, and `native:build` steps inside
  `release:check`, `release:full`, `release:rc`; `native:no-kimi:turn` reference check
- `scripts/build-native.mjs`, `scripts/rust-safety-check.mjs`,
  `scripts/normalize-native-artifacts.mjs`, native branch of `scripts/package-audit.mjs`
- `src/util/native-safety.ts` + doctor lane report (`src/commands/doctor/checks.ts:253,358`)
- CI: rust/cargo steps in `.github/workflows/{ci,release,smoke-test}.yml`
- README/CHANGELOG native-lane claims; SECURITY.md stays unchanged (it never claimed
  native sandboxing — verify on execution)

## What we keep instead (TS follow-ups carrying the real value)

1. Fix O(matches × n) `SecretScanner.getLineColumn` (secret-scanner.ts:729) — measured
   3 404 ms/call at 1 MiB match-heavy input vs 11.7 ms clean.
2. Enforce `writableRoots` (src/runtime/sandbox-profile.ts:13) in tool dispatch — currently
   declared but never consulted against any path.
3. Deduplicate child-env sanitizer clones (kimi runner ↔ adapter).

## Consequences

- No supply-chain surface from prebuilds; `--ignore-scripts` installs remain trivially safe.
- A future native lane proposal must re-run this gate with new measured p.
