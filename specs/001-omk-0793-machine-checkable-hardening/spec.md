# Feature Specification: OMK 0.79.3 Machine-Checkable Hardening

**Feature Branch**: `001-omk-0793-machine-checkable-hardening`
**Created**: 2026-06-15
**Status**: Implemented / verification required before release tag reuse
**Package Version**: `open-multi-agent-kit@0.79.3`
**Runtime Contract Family**: `v1.2`
**Release Channel**: `pre-1.0`

## Problem Statement

OMK's public position is DAG → scoped lanes → evidence → verify/replay. To make that claim trustworthy in a pre-1.0 product, current-version claims, authority gates, evidence gates, runtime health, decision traces, and context compaction must be machine-checkable and reflected in both docs and runtime behavior.

## Functional Requirements

### FR1 — Release Truth Gate

- **Risk class**: `shell`
- **Authority**: local verification commands
- **Evidence gate**: `command-pass`
- **Acceptance**:
  1. `npm run version:check` validates `package.json`, `package-lock.json`, current-version Markdown claims, runtime constants, schemas, changelog top entry, and release proof.
  2. `ROADMAP.md` and current-facing docs declare `open-multi-agent-kit@0.79.3`, runtime contract family `v1.2`, and release channel `pre-1.0`.

### FR2 — Evidence Required by Risk

- **Risk class**: `write | shell | merge`
- **Authority**: write/shell/merge as applicable
- **Evidence gate**: `summary | command-pass`
- **Acceptance**:
  1. Native write/shell/merge turns set `routing.evidenceRequired=true`.
  2. Native write/shell/merge turns include at least one required output gate.
  3. Read/ask turns stay evidence-optional unless explicit requirements exist.

### FR3 — Authority Gate Staging

- **Risk class**: `write | shell | merge`
- **Authority**: scoped runtime authority
- **Evidence gate**: unit tests + trace diagnostics
- **Acceptance**:
  1. `OMK_TOOL_AUTHORITY_MODE=shadow|warn|enforce` resolves deterministically.
  2. Enforce mode blocks non-allowed native turn dispatch before execution.
  3. Shadow remains behavior-compatible unless tracing is enabled.

### FR4 — Health-Aware Runtime Routing

- **Risk class**: `read | write | shell`
- **Authority**: selected runtime capability
- **Evidence gate**: router tests + decision trace
- **Acceptance**:
  1. Unhealthy runtimes are excluded before execution in async routing paths.
  2. Composite router weights are normalized to sum to 1.0.
  3. `executeTask` records runtime-router decision traces.

### FR5 — Effective Headroom Compaction

- **Risk class**: `read`
- **Authority**: context optimization only
- **Evidence gate**: runtime-backed runner test
- **Acceptance**:
  1. Successful headroom compaction returns compacted text.
  2. Runtime-backed task execution uses the compacted capsule as the effective payload.

## Non-Goals

- Do not claim OS-level sandboxing.
- Do not rewrite historical changelog entries or archived run artifacts.
- Do not grant advisory API runtimes write/shell/merge authority by default.

## Verification Commands

- `npm run check`
- `npm run build:clean`
- `npm run lint`
- `npm run secret:scan`
- `npm run version:check`
- `node --test --test-timeout=300000 test/chat-runtime.test.mjs test/runtime-router.test.mjs test/tool-authority-wiring.test.mjs test/headroom-policy.test.mjs`
- `npm test`
