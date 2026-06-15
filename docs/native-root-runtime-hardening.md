# Native Root Runtime Hardening

Last updated: 2026-06-15
Current package version: `open-multi-agent-kit@0.79.3`
Runtime contract family: `v1.2`
Release channel: `pre-1.0`

## Current State

OMK is the root orchestrator. Kimi, Codex, DeepSeek, OpenCode, CommandCode, GLM, and future providers are runtime/provider lanes selected through OMK-owned contracts. API advisory runtimes remain read/review/advisory unless a runtime-mode contract grants write/shell/merge authority.

This is still a hardening milestone, not a stable 1.x or OS-level sandbox claim. The current release stop condition is:

- Local `npm run release:check` must pass on the exact release diff.
- GitHub Actions Smoke Test must pass on the exact commit/tag.
- GitHub Actions CI or Release workflow gates must pass on the exact commit/tag.
- npm registry `latest` must be verified when a release claim references a published version.
- Release evidence must be kept under `.omk/runs/<run-id>/`, `.omk/release-evidence/<short-sha>/`, or an equivalent run artifact path.

Fresh verification at the time of this update:

- `open-multi-agent-kit@0.79.3` is published as npm `latest`.
- Main CI, main Smoke, tag Release, and tag Smoke passed for `v0.79.3` after rerunning transient failures.
- Local verification for the machine-checkable hardening slice passed: `npm run check`, `npm run build:clean`, `npm run lint`, `npm run secret:scan`, `npm run version:check`, targeted runtime tests, and `npm test`.

For the LaTeX/paper-ready algorithm appendix and acceptance criteria, see
[Native Root Runtime Algorithms](./native-root-runtime-algorithms.md). Treat
that appendix as hardening criteria; release claims still require exact-diff
local gates, CI/smoke, and registry evidence.

## Runtime Safety Contract

Related algorithm appendix:
[Native Root Runtime Algorithms](./native-root-runtime-algorithms.md)
documents the current acceptance criteria for turn construction, capsule
conversion, runtime fallback, Kimi prompt transport, and scoped worker
environment construction.

### Turn risk and capability routing

Related: Algorithm 2.

Native chat turns must be default-safe. A turn should request only the minimum capability needed:

| Turn risk | Typical intent | Capabilities |
|-----------|----------------|--------------|
| `read` | explain, review, summarize, inspect docs | `read` only |
| `write` | edit, fix, implement, refactor | `read`, `write`, `patch` |
| `shell` | run tests, build, execute commands | `read`, `write`, `shell` with approval policy and required command evidence |
| `merge` | publish, release, push, merge, destructive changes | authority provider plus release/security gates |

DeepSeek remains an advisory/read/review lane unless an explicit future contract grants safe write/shell execution. Write/shell tasks should route to Kimi, Codex, or a configured authority provider with the matching approval and sandbox policy.

### Approval and sandbox propagation

Related: Algorithm 2, Algorithm 4, and Algorithm 7.

`--execution ask|auto|never` must flow from chat command parsing into `AgentTask.safety`, runtime routing, and the final adapter invocation.

| OMK execution | Runtime expectation |
|---------------|---------------------|
| `ask` | request approval before write/shell side effects; Codex should not use `never` |
| `auto` | allow only low-risk automatic actions; elevate risky shell/write operations |
| `never` | explicit high-trust/yolo mode only |
| read-only turn | use read-only sandbox where adapter supports it |

### Authority provider resolution

Related: Algorithm 5.

`authority`, `primary`, and `omk` are policies, not executable providers. They must resolve to a concrete provider before bootstrap or routing:

1. `OMK_AUTHORITY_PROVIDER`, if set and healthy.
2. Kimi, when installed/authenticated and compatible with task risk.
3. A configured fallback provider that satisfies the task capability contract.

Unknown or unresolved authority must fail with remediation instead of silently degrading to advisory-only mode.

### Provider health probes

Related: Algorithm 5. Runtime routing now filters unavailable runtimes in async execution paths and includes health in normalized route scoring. The next hardening step is to expand every adapter to a uniform auth/model/quota/rate-limit/latency vector.

Provider bootstrap must distinguish:

- `runtimeOk`: binary/API client available.
- `authOk`: authenticated enough to make a real call.
- `modelOk`: selected/default model is supported.
- `quotaOk`: quota/rate-limit known good, known bad, or unknown.

Binary existence alone is not enough. CLI adapters should probe version and auth/session status where possible; API adapters should validate key presence and perform a cheap health/model check when safe.

### Tool-plane diagnostics

Related: Algorithm 4 and Algorithm 7.

MCP, skills, and hooks must not disappear silently. Runtime manifests should include diagnostics for parse/read failures, unknown names, and scope drops. If a task requires runtime MCP, invalid MCP config is a hard failure.

## P0 Backlog

1. Expand provider health to binary/auth/model/quota/rate-limit/latency vectors across all adapters.
2. Add `OMK_TOOL_AUTHORITY_MODE=enforce` smoke coverage to release gates.
3. Make evidence-required completion blocking uniform across native turn, DAG executor, verify, and replay paths.
4. Keep release evidence current; do not tag/publish while exact-diff CI/smoke or registry verification is missing.

## P1 Backlog

1. Split provider/runtime authority by runtime mode (`kimi:api`, `opencode:cli`, `deepseek:api`, etc.).
2. Add risk classifier confidence/matched-signal traces and ask/preview on low-confidence prompts.
3. Move prompt envelopes out of `DagNode.name` into structured payload fields.
4. Persist per-turn route artifacts under `.omk/runs/<run-id>/turns/<turn-id>.json`.
5. Link provider routes and evidence gates into graph memory for replay/audit.

## P2 Backlog

1. Add configurable non-zero exit behavior for native root-loop turn failures.
2. Add experimental OS sandbox modes only behind explicit opt-in and without public stable claims.
3. Add broader pty/TTY regression coverage for scroll-safe rendering and interactive selectors.

## Spec-Kit Acceptance Gates

Any spec-kit plan for native root runtime work should include:

- Safety fields: `risk`, `approvalPolicy`, and `sandbox`.
- Authority fields: requested provider policy and resolved concrete provider.
- Capability fields: MCP, skills, hooks, write, patch, shell, and review.
- Diagnostics: provider health, tool-plane parse failures, capability mismatches, and fallback reasons.
- Evidence: exact commands, local/remote run URLs where available, pass/fail state, and release stop/go decision.
