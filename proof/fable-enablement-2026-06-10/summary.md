# Goal: make `fable` work in OMK — evidence (2026-06-10)

## Goal
Make the `fable` model (alias of `anthropic/claude-fable-5`) fully usable in the OMK runtime.

## Orchestration
Root coordinator dispatched 2 parallel `omk-explorer` lanes (read-only, ≤6 files each):
- Lane A (skills: omk-repo-explorer; MCP: understand-anything, memory) → openrouter enablement path.
- Lane B (skills: omk-repo-explorer; MCP: understand-anything, adaptorch) → `--model fable` dispatch path.
Both completed; findings cross-checked before any edit.

## Findings
1. `fable` resolution is already correct: `normalizeModelAlias`/`parseProviderModelArg` map
   `fable | fable-5 | claude-fable-5 | anthropic/claude-fable-5` → provider `openrouter`,
   model `anthropic/claude-fable-5` (`src/providers/model-registry.ts:181-184,277,283`).
2. openrouter is an **intentionally read-only/advisory** OpenAI-compatible provider. The
   `routing:"advisory"` + capabilities + read-only runner (`openai-compatible-runner.ts:47-57`)
   are a deliberate safety boundary, not a bug. Write/shell/MCP authority stays on the
   configured authority provider by design.
3. Activation uses an intentional **two-factor contract**: a provider must be explicitly
   enabled AND have its API key env set. A key alone is not enough
   (asserted by existing test `provider-routing.test.mjs`).

## Decision
Do NOT relax the read-only boundary and do NOT auto-enable-on-key. An initial auto-enable
experiment broke two existing contract tests (one triggered real network I/O), confirming the
gate is load-bearing. Reverted to the supported mechanism.

## State in this environment
- `~/.config/omk/providers.json` already has `openrouter.enabled = true`.
- `OPENROUTER_API_KEY` is exported.
- `omk provider doctor openrouter --json` → `enabled:true, available:true, apiKeySet:true`,
  health `runtimeOk/authOk/modelOk/quotaOk` all true, `authority:"advisory"`.
  ⇒ The fable provider path is fully wired and available now.

## Net repo change
- Added `test/provider-openrouter-fable-activation.test.mjs` (4 tests) documenting fable
  alias resolution + the two-factor activation contract. No source change (none needed).
- Other uncommitted files (secret-scanner.ts, sandbox-profile.ts, proof/orchestration-2026-06-10)
  are concurrent work and were left untouched.

## Quality gates
- `tsc --noEmit` → exit 0
- targeted provider tests → 77/77 pass (incl. previously env-sensitive tests 20 & 39)
- new fable test → 4/4 pass
- `secret-scan` → pass

## Remaining runtime dependency (out of code scope)
`anthropic/claude-fable-5` must be a model slug that OpenRouter actually serves. The OMK wiring
is correct regardless; if a live call returns "model not found", map `fable` to a real OpenRouter
Anthropic slug in `model-registry.ts`. Live smoke test (not auto-run; costs credits):
`OPENROUTER_API_KEY=… node dist/cli.js run --model fable "ping"`
