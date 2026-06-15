# Feature Specification: OMK Native Orchestrator — Phase 1: Unified Runtime Bridge

**Short name**: `native-orchestrator-phase1`
**Created**: 2026-05-22
**Status**: Hardening Implemented / Provider-health-vector backlog remains
**Phase**: 1 of 4 (Foundation → Unified Runtime Bridge → Worker Capability Assignment → Root Coordinator Mode)
**Algorithm reference**: `docs/native-root-runtime-algorithms.md`

---

## Problem Statement

OMK `open-multi-agent-kit@0.79.3` has moved from a Kimi-wrapper dominant architecture toward an OMK native root loop plus provider/runtime router. OMK is the root orchestrator; Kimi, Codex, DeepSeek, OpenCode, CommandCode, GLM, and future providers are adapter lanes selected by OMK policy and runtime-mode authority.

The remaining risk is no longer only "can chat avoid spawning Kimi directly"; it is whether native-root routing is safe, observable, release-gated, and machine-checkable. The current hardening target is to keep release truth, capability routing, approval/sandbox propagation, staged authority enforcement, provider health, headroom compaction, and evidence gates synchronized across runtime code, docs, and spec-kit. Algorithm-level acceptance criteria now live in `docs/native-root-runtime-algorithms.md`; use them as contract targets, not as release proof.

This creates three critical limitations:
1. **Adapter-uneven safety enforcement**: Native chat turns now carry risk/capability metadata, but adapter enforcement still varies, especially for Kimi print sandbox behavior.
2. **Approval drift**: CLI execution policy such as `--execution ask` can fail to reach the final runtime adapter.
3. **Provider policy ambiguity**: `authority` is a policy, not an executable provider, and must resolve before bootstrap.
4. **Weak health checks**: CLI provider bootstrap can mistake "binary exists" for "authenticated and usable".
5. **Release evidence gap**: local release gates and remote CI/Smoke evidence must both pass on the exact release commit.

---

## User Scenarios

### US1: Chat without Kimi CLI installed
As a user who prefers DeepSeek or Codex, I want to run `omk chat` without installing Kimi CLI, so that OMK works as a true multi-provider orchestrator.

**Acceptance criteria:**
- `omk chat` starts successfully when only DeepSeek API key is configured.
- Read/review output works without write/shell authority; write/shell tasks require an authority-capable fallback or an explicit block.

### US2: Parallel workers with different providers
As a user working on a complex task, I want OMK to spawn a reviewer worker on DeepSeek and a coder worker on Kimi simultaneously, so that I get fast, cost-effective review alongside high-quality code generation.

**Acceptance criteria:**
- A single `omk chat` session can spawn parallel workers.
- Each worker uses the provider selected by OMK's router, not Kimi's default.
- Results are aggregated back to the user.

### US3: Per-worker capability scoping
As a security-conscious user, I want the review worker to have access to only the `omk-code-review` skill and no MCP servers, while the coder worker has full MCP access, so that least-privilege is enforced.

**Acceptance criteria:**
- Worker manifest includes explicit `mcpAllowlist`, `skillAllowlist`, and `hookAllowlist`.
- OMK rejects or warns if a worker requests a capability not in its manifest.

### US4: Default-safe native chat turn
As a user asking a read-only review/explanation question, I want OMK to route the turn without write or shell authority, so that advisory providers such as DeepSeek can participate safely.

**Acceptance criteria:**
- Read/review prompts request read-only capability.
- Edit prompts request write/patch capability but not shell unless command execution is intended.
- Shell/build/test prompts request shell capability and carry approval policy.

### US5: Approval policy reaches the adapter
As a user running with `--execution ask`, I want runtime adapters to honor that policy, so that shell/write side effects are not executed as unconditional "never ask" actions.

**Acceptance criteria:**
- `AgentTask.safety.approvalPolicy` is visible in route decision evidence.
- Codex CLI invocations derived from `ask` do not use provider approval mode `never`.
- Read-only turns use read-only sandbox where the selected adapter supports it.

### US6: Authority provider is concrete and healthy
As an operator selecting `--provider authority`, I want OMK to resolve that policy into a concrete healthy provider before execution, so that fallback behavior is explicit and auditable.

**Acceptance criteria:**
- `authority` is never passed to the runtime registry as an executable adapter id.
- Failed authority resolution returns a structured diagnostic and remediation.
- Route evidence records requested policy and resolved provider.

---

## Functional Requirements

### FR1: Provider-Neutral AgentRuntime Interface
OMK shall define a single `AgentRuntime` interface with an `execute(task: AgentTask): Promise<AgentResult>` method. All provider adapters (Kimi wire, Kimi print, Codex CLI, DeepSeek API) must implement this interface.

**Testability**: Verify that each adapter returns an `AgentResult` with `output`, `exitCode`, and optional `thinking`/`todos`.

### FR2: Chat-as-DAG Execution
The `omk chat` command shall construct an internal single-node DAG and execute it through the same `RuntimeBackedTaskRunner` used by `omk run`, rather than spawning Kimi CLI directly.

**Testability**: Compare `omk chat` and `omk run --mode chat` behavior; both must use the same runtime router.

### FR3: OMK-Generated Chat Harness
The `chat-agent-harness.json` file shall be generated by OMK based on the active runtime scope (MCP/Skills/Hooks), not derived from Kimi's internal session state.

**Testability**: Run `omk chat --smoke` and inspect harness; MCP/skill counts must match OMK's discovery, not Kimi's.

### FR4: Per-Worker Capability Manifest
The `AgentTask` type shall include a `capabilities: CapabilityManifest` field that carries:
- `mcpServers: string[]`
- `skills: string[]`
- `hooks: string[]`
- `providerPolicy: ProviderPolicy`

The runtime router shall pass this manifest to the selected adapter.

**Testability**: Unit test that `capsuleToTask()` preserves all capability fields.

### FR5: Backward Compatibility
Existing `omk chat` behavior with Kimi CLI shall remain functional. The new runtime bridge must default to Kimi when available and no other provider is explicitly configured.

**Testability**: Run existing smoke tests without modification; they must pass.

### FR6: Native Turn Risk Inference
OMK shall infer native chat turn risk as `read`, `write`, `shell`, `merge`, or `ask` before building the turn DAG node.

**Testability**: Unit tests verify that review/explanation prompts do not request shell/write, edit prompts request write/patch, and build/test prompts request shell.

### FR7: DeepSeek Advisory Boundary
Explicit DeepSeek routing shall be read/review/advisory by default. If a DeepSeek-selected task requires write/shell, OMK must block with a clear message or reroute only through an allowed authority fallback.

**Testability**: Integration tests cover `--provider deepseek` read prompt success and write/shell prompt block/fallback.

### FR8: Approval and Sandbox Propagation
The chat command execution mode shall be represented in `AgentTask.safety.approvalPolicy` and adapter invocation arguments.

**Testability**: Codex adapter tests assert that `ask` maps to an approval-requesting provider mode and read-only turns use read-only sandbox when supported.

**Current caveat**: Codex and generic external adapters consume these fields;
Kimi print currently receives limited hints rather than a fully enforced
sandbox contract.

### FR9: Authority Policy Resolution
`authority`, `primary`, and `omk` provider policies shall resolve to concrete provider ids before runtime bootstrap and routing.

**Testability**: Tests assert that `authority` resolves through `OMK_AUTHORITY_PROVIDER` or default Kimi, and fails visibly if no healthy authority exists.

### FR10: Structured Provider Health
Runtime bootstrap and routing shall distinguish runtime availability from auth/model/quota/rate-limit/latency. `RuntimeRouter` already filters unavailable runtimes in async paths; the backlog is to normalize richer health vectors across every adapter.

**Testability**: Provider bootstrap/router tests simulate unavailable runtimes, installed-but-unauthenticated CLI providers, and API key/model/quota failures.

### FR11: Tool-Plane Diagnostics and Authority Modes
MCP/skills/hooks read and parse failures shall be reported in the tool-plane manifest. Required runtime MCP parse failures shall block execution. Tool authority mode shall support `shadow`, `warn`, and `enforce`, with enforce mode blocking non-allowed write/shell/merge operations.

**Testability**: Tests feed invalid MCP JSON and assert a structured diagnostic or hard failure when runtime MCP is required.

---

## Success Criteria

1. **Users can run `omk chat` with at least 2 non-Kimi providers** (DeepSeek, Codex) without Kimi CLI installed.
2. **Parallel worker spawning latency is under 5 seconds** from intent parsing to first worker output, measured on a mid-range laptop.
3. **Capability scoping reduces MCP surface by 50%** for review/researcher workers compared to coordinator workers, measured by active MCP server count in harness.
4. **Zero regressions** in existing `omk chat` smoke tests when Kimi CLI is the only available provider.
5. **Code reuse between chat and run paths reaches 80%** — measured by shared lines in `RuntimeBackedTaskRunner` vs. duplicated lines in `chat.ts`.
6. **No provider-neutral stable claim while CI is red** — local release gates, GitHub Actions Smoke Test, and GitHub Actions CI must pass on the exact target commit.
7. **DeepSeek write/shell attempts are safe** — explicit write/shell prompts under DeepSeek are blocked or rerouted with visible evidence.
8. **Approval decisions are replayable** — each turn records requested risk, approval policy, sandbox, selected provider, fallback reasons, and exit code.

---

## Key Entities

| Entity | Role | Key Fields |
|--------|------|------------|
| `AgentRuntime` | Adapter contract | `id`, `kind`, `priority`, `supports()`, `execute()` |
| `AgentTask` | Work unit | `prompt`, `context`, `tools`, `providerPolicy`, `capabilities` |
| `AgentResult` | Work output | `output`, `exitCode`, `thinking`, `todos`, `toolCalls`, `metadata` |
| `CapabilityManifest` | Security boundary | `mcpServers`, `skills`, `hooks`, `read/write/shell/...` |
| `ProviderPolicy` | Routing hint | `strategy`, `preferredProviders`, `fallbackChain` |
| `RuntimeRouter` | Dispatch layer | `execute(task)` → selects adapter → returns result |
| `AgentTask.safety` | Execution safety contract | `risk`, `approvalPolicy`, `sandbox`, `authorityProvider` |
| `ProviderHealth` | Bootstrap evidence | `runtimeOk`, `authOk`, `modelOk`, `quotaOk`, `reason`, `remediation` |
| `ToolPlaneDiagnostic` | Capability diagnostics | `level`, `code`, `path`, `message` |

---

## Assumptions

- Provider adapters (Kimi wire, Codex, DeepSeek) expose API or CLI interfaces that can be wrapped in `AgentRuntime`.
- Streaming and tool-calling are optional adapter capabilities; the router degrades gracefully when unavailable.
- YAML agent file generation (`scoped-agent-file.ts`) can be reused for in-process workers without subprocess overhead.

---

## Out of Scope

- Full ActionAtom-native OMK planner loop beyond the current native root turn and single-node DAG bridge.
- Full parallel chat UI with cockpit panes per worker.
- New provider adapters beyond the existing 3 (Kimi, DeepSeek, Codex).
- Real-time collaborative editing across workers.
- Publishing/tagging while GitHub Actions CI or Smoke Test is red on the target commit.
