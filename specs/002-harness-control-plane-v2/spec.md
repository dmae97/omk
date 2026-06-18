# Feature Specification: Harness Control Plane V2

**Feature Branch**: `002-harness-control-plane-v2`  
**Created**: 2026-06-18  
**Status**: Draft  
**Input**: User requested a more exact algorithmic plan using parallel specialist lanes with explicit skills, MCP servers, hooks, and evidence gates.

## Objective

Convert the current Harness Control Plane feature set from independent improvements into a deterministic, replayable, tamper-evident execution protocol. The protocol must connect specification, operation planning, transaction execution, continuity compaction, input routing, migration safety, evidence capture, and replay verification.

## Runtime Capability Assumption

OMK runtime status reports 24 MCP servers configured and 0 runtime-discovered skills/hooks. This spec records the required lane grants and expected hooks. If a named skill/hook is unavailable during execution, the root coordinator must either enable it or use the direct fallback gate listed in `tasks.md`.

## Requirements

### R1 — Tamper-evident Event Ledger V2 (P0)

The event ledger must support run isolation, operation correlation, monotonic sequence, hash-chain integrity, state hashes, data hashes, and artifact hashes.

**Acceptance**:
1. Every event has `runId`, `sessionId`, `operationId`, `causationId`, `correlationId`, `sequence`, `previousEventHash`, and `eventHash`.
2. Canonical JSON hashing is deterministic across object key order differences.
3. `verifyLedger()` rejects mutated, missing, duplicated, out-of-order, or malformed events.
4. Redaction covers both sensitive keys and sensitive value patterns.
5. Append path supports lock, fsync, and per-run isolation.

### R2 — Operation Transaction Coordinator (P0)

State-changing operations must share a coordinator with `prepared → started → applying → verifying → completed | failed | rolled_back | in_doubt | blocked` semantics.

**Acceptance**:
1. Failed apply steps run compensators in reverse order.
2. Rollback success emits `rolled_back`; rollback failure emits `in_doubt` with recovery artifact.
3. Interactive model/thinking and theme paths use the coordinator.
4. Persistence scope is explicit: `session | default`.
5. Transaction tests inject apply, verify, and rollback failures.

### R3 — Atomic Extension Migration Apply (P0)

Extension migration must be all-or-nothing unless explicitly classified `in_doubt`.

**Acceptance**:
1. Plan records source hash, source stat, target absence, and allowed roots.
2. Apply verifies all preconditions before moving any path.
3. Cross-device moves use temp copy, fsync, hash verify, atomic rename, then source removal.
4. Rollback journal records inverse action and hashes.
5. Scan excludes large/generated directories and enforces entry budgets.

### R4 — Compaction V3 Continuity Engine (P0)

Compaction must avoid context overflow, preserve semantic dependencies, deduplicate repeated evidence, and validate summaries using typed structure.

**Acceptance**:
1. If fixed prompt/summary overhead exceeds viable context budget, use deterministic emergency handoff instead of forcing a 512-token conversation budget.
2. Summary validation parses Markdown headings outside code fences, not raw substring presence.
3. Semantic units include dependency edges for tool calls/results, command/output/exit, edit/diff/test, and decision/rationale.
4. Selection applies dependency closure and novelty penalty.
5. Summary events include `started`, repair/fallback where applicable, and terminal status.

### R5 — Runtime Keybinding Router (P0)

Keybinding conflict prevention must be wired into active runtime dispatch with scope priority.

**Acceptance**:
1. Runtime has active `KeybindingScope` stack with IDs, priorities, and actions.
2. Raw terminal input is normalized before matching.
3. Only the highest-priority matching scope dispatches.
4. Multiple matches in one scope block input and emit `keybinding.conflict/blocked`.
5. Tests cover selector/editor conflicts and terminal-equivalent aliases.

### R6 — Machine-compiled Spec Kit (P0)

Spec artifacts must compile into a validated DAG and traceability matrix.

**Acceptance**:
1. `spec:check` validates schema, authority policy, DAG acyclicity, and no parallel write conflicts.
2. `spec:compile` emits `compiled-dag.json`, `traceability.json`, `evidence-manifest.json`, and `spec-hash.json`.
3. Every requirement maps to at least one task, test command, and evidence artifact.
4. Provider-hardcoded final writer rules are rejected.
5. Status cannot move to `Verified` unless all evidence gates pass.

### R7 — Replay Verifier (P0)

The harness must reconstruct final control-plane state from compiled spec, ledger, and evidence artifacts.

**Acceptance**:
1. `spec:verify` verifies ledger hash-chain and transaction completeness.
2. Evidence artifact hashes are recomputed and compared.
3. Replay reconstructs final state and compares to final event `afterStateHash`.
4. Missing terminal operation, tampered evidence, or invalid spec traceability fails verification.

### R8 — Verification and Shipping Discipline (P0)

No implementation phase can be marked complete without fresh evidence.

**Acceptance**:
1. Focused subsystem tests pass.
2. `npm run check` passes.
3. `git diff --check` passes.
4. Result artifact lists changed files, evidence, risks, and next action.

## Non-goals

- No production deployment changes.
- No automatic migration apply on startup until explicit user/operator command exists.
- No secret scanning of credential files; secret safety is enforced by not reading them and by redaction patterns.
