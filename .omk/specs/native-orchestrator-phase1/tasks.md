# Tasks: OMK Native Orchestrator — Phase 1

**Feature**: native-orchestrator-phase1
**Plan**: `./plan.md`
**Created**: 2026-05-22
**Last updated**: 2026-06-15

---

## Summary

- Total tasks: 48
- Parallel opportunities: 20 tasks marked with `[P]`
- Suggested MVP scope: Phase 0.5 + Phase 1–2 + US1 (safe provider-neutral chat)
- Current algorithm acceptance reference: `docs/native-root-runtime-algorithms.md`
- Current hardening status reference: `docs/native-root-runtime-hardening.md`

## Current Checkpoint

- Implemented with caveats: native risk routing, explicit read-only override, `ask` fallback for ambiguous prompts, safety metadata propagation into runtime task context, evidence-required defaults for write/shell/merge, staged authority mode, runtime-router fallback, health-aware async routing, `executeTask` decision traces, Codex approval/sandbox mapping, Kimi/Codex stdin prompt transport, effective headroom compaction, and scoped worker env construction.
- Still backlog or adapter-specific: uniform provider health vectors, release-gate enforce-mode smoke, structured prompt payloads outside `DagNode.name`, Kimi print sandbox enforcement, and broader OS sandbox experiments.
- Before checking off legacy tasks below, verify the exact file/test still matches current source; some task names predate the native hardening slice.

## Phase 0.5: P0 Runtime Safety Hardening

**Goal**: Lock provider routing, approval policy, authority resolution, health probes, and release evidence before broader native-root claims.

- [x] T001 [P] Add native turn risk classifier tests in `test/chat-runtime.test.mjs`
- [x] T002 Add turn risk inference to `src/commands/chat/native-root-loop.ts`
- [x] T003 Update turn node capability assignment in `src/commands/chat/native-root-loop.ts` so read/ask prompts do not request write/shell
- [x] T004 [P] Add DeepSeek read-only/write-block route tests in `test/runtime-router-advisory-boundary.test.mjs`
- [x] T005 Enforce DeepSeek advisory boundary in `src/runtime/runtime-router.ts` and mark advisory runtimes (`deepseek-api`, `kimi-api`, `local-llm`) with `advisory=true`
- [x] T006 [P] Add approval propagation tests for Codex adapter execution in `test/codex-approval-mapping.test.mjs`
- [x] T007 Pass `approvalPolicy` and `sandboxMode` from chat input into `AgentTask` context via `context-broker-converter.ts` and `kimi-print-runtime.ts`
- [x] T008 Map OMK approval policy to Codex CLI flags in `src/runtime/codex-runtime.ts` and `src/providers/codex-cli-runner.ts`
- [x] T009 [P] Add authority resolution tests in `test/provider-policy-resolution.test.mjs`
- [x] T010 Resolve `authority`/`primary`/`omk` to concrete provider ids in `src/runtime/runtime-bootstrap.ts`
- [x] T011 [P] Add runtime health routing fixtures in `test/runtime-router.test.mjs`
- [x] T012 Expand binary-only provider readiness to uniform provider health vectors in `src/runtime/runtime-bootstrap.ts` and all adapters (`RuntimeHealthVector` in `src/runtime/contracts/shared.ts`, `health()` in `kimi-api-runtime.ts`, `deepseek-runtime.ts`, `codex-runtime.ts`)
- [x] T013 [P] Add MCP parse diagnostic tests in `test/tool-plane.test.mjs`
- [x] T014 Add tool-plane diagnostics for MCP/skills/hooks parse/read failures in `src/runtime/tool-plane.ts`
- [ ] T015 Gate Kimi failure stderr preview behind `OMK_DEBUG=1` with redaction in `src/adapters/kimi/runner.ts`
- [x] T016 Add release evidence checklist docs under `.omk/goals/result-*.json` and lane evidence under `.omk/runs/`

---

## Phase 1: Setup & Type Foundations

**Goal**: Establish shared types and contracts so all adapters speak the same language.

- [x] T001 [P] Define `AgentTask` interface in `src/runtime/agent-runtime.ts`
- [x] T002 [P] Define `AgentResult` interface in `src/runtime/agent-runtime.ts`
- [x] T003 [P] Define `AgentContext` interface in `src/runtime/agent-runtime.ts`
- [x] T004 [P] Define `CapabilityManifest` interface in `src/runtime/agent-runtime.ts`
- [x] T005 [P] Define `ProviderPolicy` interface in `src/runtime/agent-runtime.ts`
- [x] T006 Add `execute(task: AgentTask)` to `AgentRuntime` interface with default delegation to legacy `runNode()` in `src/runtime/agent-runtime.ts`
- [x] T007 Write unit tests for new runtime types in `test/runtime-types.test.ts` (or existing test file)

---

## Phase 2: Foundational — Router & Converter

**Goal**: Wire the runtime router to accept `AgentTask` and convert `ContextCapsule` automatically.

- [x] T008 Create `src/runtime/context-broker-converter.ts` with `capsuleToTask()` function
- [x] T009 Add `execute(task: AgentTask)` to `RuntimeRouter` in `src/runtime/runtime-router.ts`
- [x] T010 Adapt `RuntimeBackedTaskRunner` in `src/runtime/runtime-backed-task-runner.ts` to call `router.execute()`
- [x] T011 Add `deepseek-api` and `kimi-api` to default runtime registry in `src/runtime/runtime-backed-task-runner.ts` (kimi-wire left as legacy)
- [x] T012 Ensure decision traces in `src/runtime/runtime-router.ts` are preserved with new `execute()` path

---

## Phase 3: User Story 1 — Chat Without Kimi CLI

**Goal**: `omk chat` can run through the unified bridge using any configured provider.

**Independent test criteria**: Run `omk chat --smoke` with only `DEEPSEEK_API_KEY` set and no `kimi` in PATH. It must report ok.

- [ ] T013 [US1] Implement `KimiWireRuntime.execute()` in new file `src/runtime/kimi-wire-runtime.ts` (legacy backlog)
- [x] T014 [US1] [P] Implement `DeepSeekRuntime.execute()` in `src/runtime/deepseek-runtime.ts`
- [x] T015 [US1] Refactor `KimiPrintRuntime` in `src/runtime/kimi-print-runtime.ts` to implement `execute()`
- [x] T016 [US1] Refactor `CodexCliRuntime` in `src/runtime/codex-cli-runtime.ts` to implement `execute()` (via `CodexRuntime`)
- [x] T017 [US1] Add provider health check integration so `health()` reports auth missing
- [x] T018 [US1] Update `src/commands/chat.ts`/`native-root-loop.ts` to build a single-node DAG and execute via `RuntimeBackedTaskRunner`
- [x] T019 [US1] Generate chat harness (`chat-agent-harness.json`) from OMK scope discovery in `src/util/chat-agent-mode.ts`
- [x] T020 [US1] Run smoke tests for DeepSeek-only and Codex-only configurations (`npm run smoke:no-kimi:chat`, `npm run smoke:no-kimi:codex`)

---

## Phase 4: User Story 2 — Parallel Multi-Provider Workers

**Goal**: `ParallelOrchestrator` can dispatch workers to different providers in the same run.

**Independent test criteria**: A DAG with two nodes (coder → kimi, reviewer → deepseek) completes with both providers reporting success in metadata.

- [ ] T021 [US2] Add `executionMode: "in-process" | "subprocess"` to `DagNode` type in `src/contracts/dag.ts` (backlog)
- [ ] T022 [US2] Update `AgentWorker.execute()` in `src/orchestration/agent-worker.ts` to use in-process path when `executionMode === "in-process"` (backlog)
- [x] T023 [US2] Update `ParallelOrchestrator` in `src/orchestration/parallel-orchestrator.ts` to pass per-node `ProviderPolicy` into `AgentTask`
- [ ] T024 [US2] Add CLI flag `--provider-per-node` or env `OMK_NODE_PROVIDER_<role>` for ad-hoc routing (backlog)
- [ ] T025 [US2] Integration test: 2-node DAG with mixed providers in `test/parallel-provider-mix.test.ts` (backlog)

---

## Phase 5: User Story 3 — Per-Worker Capability Scoping

**Goal**: Each worker gets an explicit, least-privilege capability manifest.

**Independent test criteria**: A review worker harness shows 0 MCP servers while a coordinator worker harness shows >0.

- [x] T026 [US3] Extend `AgentTask.tools` with `mcpServers`, `skills`, `hooks` arrays from node routing in `src/runtime/context-broker-converter.ts`
- [ ] T027 [US3] Update `scoped-agent-file.ts` in `src/util/scoped-agent-file.ts` to generate per-worker YAML with filtered capabilities
- [ ] T028 [US3] Add capability manifest validation in `src/mcp/governance.ts` or `src/safety/guard-hooks.ts`

---

## Final Phase: Polish & Verification

- [ ] T029 Update `AGENTS.md` and `.kimi/AGENTS.md` to document the new unified runtime bridge
- [x] T030 Update `ROADMAP.md` to mark implemented hardening and remaining health/evidence backlog
- [x] T031 Run full local gates — lint, typecheck, secret:scan, build, test — and fix regressions
- [ ] T032 Run real interactive/TTY smoke with configured providers where credentials and terminal are available

---

## Dependencies & Execution Order

```
Phase 0.5 (T001–T016)
    │
    ▼
Phase 1 (T017–T023)
    │
    ▼
Phase 2 (T008–T012)
    │
    ├──► Phase 3 (T013–T020) [US1]
    │         │
    │         ▼
    │    Phase 4 (T021–T025) [US2]
    │         │
    │         ▼
    │    Phase 5 (T026–T028) [US3]
    │         │
    │         ▼
    └────► Final Phase (T029–T032)
```

**Parallel opportunities**:
- T001–T005 can all be done in parallel.
- T013 and T014 (wire vs deepseek runtime) can be done in parallel.
- T026–T028 are independent of each other once Phase 2 is done.

---

## Implementation Strategy

**MVP**: Complete Phase 1 + Phase 2 + US1 (T001–T020). This delivers the core value: provider-neutral chat.

**Hardening MVP**: Complete Phase 0.5 first. This delivers the safety baseline required before provider-neutral chat is presented as stable.

**Incremental delivery**:
1. Week 1: Phase 1 + Phase 2 (types + router wiring)
2. Week 2: US1 (adapters + chat integration)
3. Week 3: US2 + US3 (parallel workers + scoping)
4. Week 4: Final phase (docs + verification + release)

## Release Stop/Go Gates

- [ ] `npm run verify` passes locally.
- [ ] `npm run verify:no-kimi` passes locally.
- [ ] `npm run release:check` passes locally.
- [ ] GitHub Actions Smoke Test passes on the exact target commit.
- [ ] GitHub Actions CI passes on the exact target commit.
- [ ] Release evidence summary records commit, commands, pass/fail state, and remaining risk.
