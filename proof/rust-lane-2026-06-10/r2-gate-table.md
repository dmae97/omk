# Phase R2 — Ship-gate table (Amdahl / capability / latency)

Gate: ship native only if measured S_overall ≥ 1.15, OR capability unlock
(θ ≥ 200 MB/s sustained where TS cannot hold the 32 MB/s floor / 2 ms p99 per 64 KiB chunk).

S_overall = 1 / ((1 − p) + p/s); ceiling as s→∞ is 1/(1−p).

| Candidate | p (measured) | ceiling 1/(1−p) | s (Rust vs TS) | S_overall | n* (FFI break-even) | Verdict |
|---|---|---|---|---|---|---|
| redact_stream | 0.00297 | **1.0030** | not built — moot (ceiling ≪ 1.15) | ≤ 1.0030 | n/a | **TS-ONLY** |
| sanitize_env | 0.00018 | **1.0002** | moot | ≤ 1.0002 | n/a | **TS-ONLY** |
| check_path_policy | < 0.0006 (below sampling resolution) | **≈ 1.0000** | moot | ≈ 1.0000 | n/a | **TS-ONLY** |

## Why s and n* are reported as moot (honest-asymptote rule)

The prompt's own asymptote note applies: at p = 0.297% the theoretical ceiling is 1.0030×.
Even an infinitely fast Rust implementation cannot reach the 1.15× gate. Measuring s or
T_ffi (which requires building a napi-rs no-op binding) cannot change the verdict, so the
expense was not incurred. This is the Amdahl gate working as designed.

## Capability gate check (the escape hatch) — also fails

- Hot lane (governance redactSecrets, the per-tool-result path): TS already delivers
  65.8–428 MB/s on dist builds; p99 added latency per 64 KiB chunk = 0.26–0.70 ms ≤ 2 ms
  budget; ≥ 200 MB/s capability target is already met by TS at ≥ 64 KiB buffers.
- Deep lane (SecretScanner.scanText) falls below the 32 MB/s floor on match-heavy input
  (4.8 MB/s @64 KiB, 0.3 MB/s @1 MiB) — but the cause is an O(matches × n) `getLineColumn`
  loop (secret-scanner.ts:729). A 20-line TS fix (newline-offset index) restores linearity.
  Rust would mask an algorithmic bug with a faster constant: explicitly rejected.
- Volume argument: redaction inputs are bounded by design (tool text truncated to
  4 000 chars at governance.ts:162; event strings truncated). Sustained-throughput
  capability has no production consumer.
- Production a-fortiori: representative offline runs maximize p; live turns add seconds of
  model/network latency per turn, driving p further down.

## Decision

**No candidate passes the Amdahl gate or the capability gate. → KILL GATE.**

Follow-ups that carry the actual value found by this evaluation (all TS):
1. fix `SecretScanner.getLineColumn` superlinearity (release-blocker quality bug under
   secret-heavy logs; measured 3.4 s/call at 1 MiB),
2. consult `writableRoots` (sandbox-profile.ts:13) in tool dispatch — declared, never
   enforced (security gap found by omk-security lane),
3. deduplicate `buildSafeKimiChildEnv` clones (src/kimi/runner.ts ↔ src/adapters/kimi/runner.ts).

Per the execution prompt, STOPPED here for reviewer sign-off before executing the Kill
Gate (ADR + removal). Draft ADR: `adr-draft-no-native-lane.md`.
