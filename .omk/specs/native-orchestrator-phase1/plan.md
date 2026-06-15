# Implementation Plan: OMK Native Orchestrator — Phase 1

**Feature**: native-orchestrator-phase1
**Spec**: `./spec.md`
**Created**: 2026-05-22
**Last updated**: 2026-06-15
**Current hardening reference**: `docs/native-root-runtime-hardening.md`
**Algorithm reference**: `docs/native-root-runtime-algorithms.md`

---

## Technical Context

### Existing Code to Leverage
- `src/runtime/agent-runtime.ts` — Already has `AgentRuntime` interface and the `execute(task)` contract.
- `src/runtime/runtime-router.ts` — Already does intent-aware selection with fallback chains.
- `src/runtime/runtime-backed-task-runner.ts` — Already bridges capsules to runtime results.
- `src/orchestration/agent-worker.ts` — Spawns subprocesses; we add an in-process path.
- `src/providers/provider-router.ts` — Strategy logic; we fold its constants into `ProviderPolicy`.

### New Files
- `src/runtime/kimi-wire-runtime.ts` — API-based Kimi adapter implementing `execute()`.
- `src/runtime/deepseek-runtime.ts` — DeepSeek API adapter implementing `execute()`.
- `src/runtime/context-broker-converter.ts` — `capsuleToTask()` conversion logic is present and carries safety metadata.

### Modified Files
- `src/runtime/agent-runtime.ts` — Add `AgentTask`, `AgentResult`, `AgentContext`, etc.
- `src/runtime/runtime-router.ts` — Add `execute(task)` entrypoint.
- `src/runtime/runtime-backed-task-runner.ts` — Wire in-process execution; add `kimi-wire` to default registry.
- `src/orchestration/agent-worker.ts` — Add `executionMode: "in-process" | "subprocess"`.
- `src/commands/chat.ts` — Replace `runKimiInteractive()` with `RuntimeBackedTaskRunner`.

### Hardening Files
- `src/commands/chat/native-root-loop.ts` — Infer turn risk and attach safety metadata before building turn nodes.
- `src/runtime/runtime-bootstrap.ts` — Resolve `authority` policy and expose structured provider health.
- `src/runtime/runtime-router.ts` — Preserve requested risk, approval policy, sandbox, capability mismatch, and fallback reason in route evidence.
- `src/adapters/codex/*` or current Codex runtime adapter — Map OMK approval/sandbox policy to provider CLI flags.
- `src/adapters/kimi/runner.ts` — Gate and redact failure previews behind `OMK_DEBUG=1`.
- `src/runtime/tool-plane.ts` — Emit diagnostics for MCP/skills/hooks parse/read failures.

### Current Implementation Checkpoint

- Current with caveats: native turn risk routing, explicit read-only override, `ask` fallback for ambiguous prompts, evidence-required defaults for write/shell/merge, turn node safety metadata, capsule-to-task conversion, runtime router fallback, health-aware async routing, `executeTask` decision trace, effective headroom compaction, Kimi/Codex stdin prompt transport, and scoped native worker environment construction.
- Partial/remaining: uniform binary/auth/model/quota/rate-limit/latency health vectors for all adapters, broader release-gate enforcement mode smoke tests, structured prompt payloads outside `DagNode.name`, and concrete ActionAtom/Novelty Guard runtime execution.
- Keep `docs/native-root-runtime-algorithms.md` as acceptance criteria for
  Algorithms 1-7 and `docs/native-root-runtime-hardening.md` as the release
  stop/go checklist.

---

## Architecture

```
┌─────────────────────────────────────────┐
│           src/commands/chat.ts          │
│  (no longer spawns kimi directly)       │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│     src/runtime/runtime-backed-task-    │
│            runner.ts                    │
│  buildCapsule() → capsuleToTask()       │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│     src/runtime/runtime-router.ts       │
│  execute(task) → select adapter         │
│  → fallback chain → result              │
└─────────────────┬───────────────────────┘
                  │
      ┌───────────┼───────────┐
      ▼           ▼           ▼
┌─────────┐ ┌─────────┐ ┌───────────┐
│KimiWire │ │KimiPrint│ │DeepSeek   │
│Runtime  │ │Runtime  │ │Runtime    │
└─────────┘ └─────────┘ └───────────┘
      │           │           │
      └───────────┴───────────┘
                  │
                  ▼
        ┌─────────────────┐
        │   AgentResult   │
        │ output/exitCode │
        │ thinking/todos  │
        └─────────────────┘
```

---

## Phase Breakdown

### Phase 0.5: P0 Safety Hardening
1. Maintain native turn risk inference before DAG node construction, including explicit read-only override and `ask` fallback.
2. Carry `risk`, `approvalPolicy`, `sandbox`, and requested provider policy in runtime task context/metadata.
3. Enforce advisory API runtime boundaries for write/shell/merge work.
4. Resolve `authority`/`primary`/`omk` to concrete healthy providers before routing.
5. Expand binary-only provider readiness into structured provider health vectors.
6. Record per-turn route evidence, runtime-router decisions, and release stop/go evidence.

### Phase 0: Foundation
1. Merge Kimi coupling map (explorer output) with runtime bridge design (architect output).
2. Identify exact lines in `chat.ts` to replace.
3. Validate that `ContextCapsule` can carry capability manifests without breaking existing DAG runs.

### Phase 1: Core Types & Interfaces
1. Define `AgentTask`, `AgentResult`, `AgentContext`, `CapabilityManifest`, `ProviderPolicy` in `src/runtime/agent-runtime.ts`.
2. Add `execute(task)` to `AgentRuntime` interface with default delegation to `runNode()` for backward compatibility.
3. Write unit tests for type contracts.

### Phase 2: Adapter Implementations
1. Implement `KimiWireRuntime.execute()` using Moonshot API.
2. Implement `DeepSeekRuntime.execute()` using DeepSeek API.
3. Refactor `KimiPrintRuntime` and `CodexCliRuntime` to implement `execute()`.
4. Add `capsuleToTask()` converter in `src/runtime/context-broker-converter.ts`.

### Phase 3: Router & Task Runner Integration
1. Add `execute(task)` to `RuntimeRouter` with intent classification and fallback chain.
2. Update `RuntimeBackedTaskRunner` to call `router.execute()` instead of `router.runNode()`.
3. Add `kimi-wire` and `deepseek-api` to default runtime registry.
4. Ensure decision traces are recorded in the same format as before.

### Phase 4: Worker & Chat Integration
1. Add `executionMode` to `DagNode` and `AgentWorker`.
2. When `executionMode === "in-process"`, bypass subprocess spawn and call `RuntimeBackedTaskRunner.run()` directly.
3. Refactor `chat.ts` to build a single-node DAG and execute via `RuntimeBackedTaskRunner`.
4. Generate chat harness from OMK scope discovery, not from Kimi session.

### Phase 5: Verification
1. Run `omk chat --smoke` with Kimi as only provider → must pass.
2. Run `omk chat --smoke` with DeepSeek as only provider → must pass.
3. Run `omk run` DAG tests → must pass (backward compatibility).
4. Run `npm run verify` → lint, typecheck, tests, build all green.

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| `AgentWorker` subprocess removal breaks remote execution | Keep `executionMode: "subprocess"` as fallback |
| MCP server lifecycle unclear in API mode | Mark as Phase 2 concern; for Phase 1, reuse existing MCP proxy |
| Streaming differences between providers | Make streaming optional; router selects non-streaming adapter if needed |
| Backward compat break in `runNode()` | Provide default `execute()` → `runNode()` bridge in base class |
| Read-only prompt over-routes to write/shell | Gate turn node capabilities behind risk inference tests |
| `--execution ask` becomes provider `never` | Add adapter-level approval mapping tests and route evidence |
| `authority` reaches registry as fake provider | Resolve policy to concrete provider before bootstrap |
| Release claim outruns evidence | Require local `release:check`, GitHub Smoke, and GitHub CI on exact commit |

---

## Definition of Done

- [x] `AgentRuntime.execute()` / `RuntimeRouter.executeTask()` are active native execution paths.
- [x] `omk chat` can route through non-Kimi runtimes when configured.
- [x] Read-only and `ask` native chat turns do not request write/shell capability.
- [x] Write/shell/merge native turns require evidence gates by default.
- [x] `--execution ask` reaches runtime task context and route metadata.
- [ ] `authority` resolves to a concrete healthy provider or fails with remediation across every adapter.
- [x] Advisory API write/shell tasks block or downgrade/reroute with explicit metadata.
- [x] Existing chat/runtime tests pass.
- [x] `omk run` DAG backward compatibility is preserved by tests.
- [x] All new code has TypeScript strict mode compliance.
- [x] `npm test` passes locally.
- [x] GitHub Actions Smoke/Release and npm registry verification passed for `v0.79.3`.
