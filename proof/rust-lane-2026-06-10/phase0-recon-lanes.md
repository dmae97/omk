# Phase 0 — Parallel recon lane evidence (3 subagents)

Orchestration: omk-parallel-orchestrator root; lanes dispatched in parallel with
explicit scope/skill/evidence contracts. MCP servers adaptorch/ouroboros/supermemory are
configured in the runtime; lanes used local rg/sed/cat evidence only (no MCP needed for
local recon; limitation: this tool surface exposes no direct MCP calls — reported, not faked).

## Lane A (omk-explorer · skill: omk-repo-explorer) — redaction
- Canonical deep: secret-scanner.ts:889 redactSecrets → scanText:441 (20 patterns, fresh scanner per call)
- Runtime-fast duplicate: governance.ts:384 (16 shared-registry patterns), called from ToolGovernor.govern:772 per MCP tool result + sanitizeArgs:471
- Object walker: state-persister.ts:16 — every telemetry event (events-logger.ts:101), evidence records, checkpoints
- Stream-chunk path (kimi runner:559,1046) is control-plane-leak *detection* (9 regex .some(test)), not secret redaction
- Inputs bounded: governance maxModelContentChars=4000; events truncated post-redaction

## Lane B (omk-explorer · skill: omk-repo-explorer) — env sanitization
- Canonical: src/runtime/child-env.ts:104 buildChildEnvWithMetadata (23-name allowlist, SECRET_LIKE denylist, 11-regex hard denylist, win32 normalization)
- Call sites all immediately precede spawn: process-session.ts:40, codex-cli-runner.ts:78, agent-worker.ts:40, codex-runtime.ts:153
- Verdict: strictly cold (per spawn, ~µs); Rust gains correctness dedup value only, zero perf value
- Debt: buildSafeKimiChildEnv duplicated src/kimi/runner.ts:98 ↔ src/adapters/kimi/runner.ts:97

## Lane C (omk-security · skill: omk-security-review) — path policy
- src/safety/ has NO per-path verdicts: tool-authority-gate.ts:115,240 are mode-level enum gates (allow|ask|block), no path input
- Only real containment: filesystem-readonly-server.ts:163-175 (realpath → relative → startsWith("..")) — per MCP file op, syscall-bound
- GAP: sandbox-profile.ts:13 writableRoots declared, never consulted against any path
- Rewrite notes: must canonicalize before relative-check; platform-aware case folding on mac/win
