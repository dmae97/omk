# Implementation Plan: Harness Control Plane V2

**Branch**: `002-harness-control-plane-v2`  
**Date**: 2026-06-18  
**Spec**: `specs/002-harness-control-plane-v2/spec.md`  
**Mode**: hierarchical DAG, multi-lane planning and implementation

## Summary

Harness Control Plane V2 turns the current feature set into a deterministic protocol. The foundation is a tamper-evident Event Ledger V2 and machine-compiled spec DAG. State-changing subsystems then integrate through a shared transaction coordinator. Continuity, migration, keybinding dispatch, and replay verification close the loop so a run can be audited, replayed, and verified.

## Runtime Inventory

- **MCP Scope**: 24 configured: adaptorch, adaptorch-prod, filesystem, github, memory, ouroboros, context7, and others.
- **Runtime-discovered skills/hooks**: 0 reported by `omk_runtime_status`; required grants below are normative and may require fallback direct execution.
- **Authority policy**: root coordinator is final writer; lane grants are least-privilege and evidence-producing.
- **Secrets policy**: do not read `.env*`, `auth.json`, key material, credentials, or token files. Redaction is defense-in-depth only.

## AdaptOrch Routing

```json
{
  "topology": "hierarchical-dag",
  "reason": "Spec compiler and ledger V2 are foundations; transaction, compaction, migration, and keybinding work can run in parallel after foundations; replay verifier reduces all evidence.",
  "features": {
    "width": 5,
    "criticalDepth": 7,
    "couplingDensity": 0.24,
    "parallelRatio": 0.33,
    "nodeCount": 18,
    "edgeCount": 31
  },
  "batches": [
    ["HCP-00"],
    ["HCP-01", "HCP-02"],
    ["HCP-03", "HCP-04", "HCP-07", "HCP-09", "HCP-10"],
    ["HCP-05", "HCP-06", "HCP-08", "HCP-11"],
    ["HCP-12"],
    ["HCP-13", "HCP-14"],
    ["HCP-15", "HCP-16"],
    ["HCP-17"]
  ]
}
```

## Lane Grants

| Lane | Agent | Authority | Skills | MCP | Hooks | Evidence |
|---|---|---|---|---|---|---|
| ledger-security-architect | omk-security/omk-architect | read-only then write-scoped in HCP-02/03/10 | security-review, ddd-software-architecture, tdd-test-driven-development, verification-loop, zeroize-audit | filesystem, memory, adaptorch | protect-secrets.sh, pre-shell-guard.sh, stop-verify.sh | `.omk/runs/harness-control-plane-v2/ledger.md` |
| transaction-migration-architect | omk-architect/omk-coder | write-scoped | ddd-software-architecture, systematic-debugging, security-review, differential-review, database-migrations, tdd-test-driven-development | filesystem, memory, ouroboros | protect-secrets.sh, pre-shell-guard.sh, stop-verify.sh | `.omk/runs/harness-control-plane-v2/transactions.md` |
| continuity-input-router | omk-coder/omk-reviewer | write-scoped | headroom, ai-regression-testing, coding-standards, property-based-testing, tdd-test-driven-development | filesystem, memory, adaptorch | precompact-checkpoint.sh, protect-secrets.sh, typecheck-after-edit.sh, stop-verify.sh | `.omk/runs/harness-control-plane-v2/continuity-router.md` |
| spec-replay-qa | omk-planner/omk-qa | write-scoped for spec/scripts, review-only for product code | blueprint, adaptorch-route, verification-before-completion, ai-regression-testing, code-review | filesystem, github, memory, ouroboros | session-context.sh, precompact-checkpoint.sh, stop-verify.sh, subagent-stop-audit.sh | `.omk/runs/harness-control-plane-v2/spec-replay.md` |

## Algorithms

### A1 — AppendHarnessEventV2

```text
Input: runId, sessionId, operationId, causationId, correlationId, kind, status, beforeState, afterState, data, artifactRefs
Output: EventWriteResult

1. acquire append lock for runId
2. previous ← read and verify last event, or genesis
3. sequence ← previous.sequence + 1
4. sanitizedData ← redactByKeyAndValue(data)
5. artifactManifest ← hash allowed artifactRefs
6. eventWithoutHash ← canonical object with schemaVersion v2, ids, sequence, hashes, status, timestamps, data, artifacts, previousEventHash
7. eventHash ← sha256(canonicalJson(eventWithoutHash) + previous.eventHash)
8. append JSON line { ...eventWithoutHash, eventHash }
9. fsync file and containing directory
10. release lock
```

### A2 — VerifyLedger

```text
1. parse every JSONL line strictly
2. verify schema and monotonic sequence
3. recompute dataHash, artifact hashes, eventHash, and previousEventHash links
4. group by operationId
5. assert each started operation has exactly one terminal event
6. reject duplicate terminals, missing terminals, hash mismatch, sequence gaps, malformed lines
```

### A3 — ExecuteHarnessTransaction

```text
1. acquire resource mutex
2. snapshot before-state and compute beforeStateHash
3. run preflight predicates
4. write WAL prepared with compensators
5. ledger started
6. apply ordered steps
7. verify resulting state and artifact hashes
8. ledger completed with afterStateHash
9. on error: run compensators reverse-order
10. ledger rolled_back if complete, in_doubt if rollback fails, blocked if preflight fails
```

### A4 — ApplyExtensionMigrationTransaction

```text
1. validate plan schema and plan hash
2. verify all source hash/stat preconditions and target absence before move
3. for each action:
   a. same filesystem: rename source to target
   b. cross filesystem: copy to temp, fsync, verify hash, rename temp, remove source
   c. journal inverse action
4. verify all target hashes
5. commit journal and ledger completed
6. on failure: inverse journal reverse-order; classify rolled_back or in_doubt
```

### A5 — PackAndValidateCompactionV3

```text
1. ledger started
2. fixedTokens ← count system/base/custom/previous/wrapper
3. budget ← contextWindow - outputReserve - fixedTokens - tokenizerMargin
4. if budget < minimumViableBudget: build deterministic emergency handoff and ledger completed backend=deterministic-emergency
5. parse typed semantic units and dependency edges
6. deduplicate by normalized hash and score novelty
7. select mandatory units and dependency closure
8. greedily select utility density under budget
9. summarize selected units
10. parse Markdown AST excluding code fences
11. validate required sections, blocker preservation, command/exit agreement, evidence agreement
12. repair once, otherwise deterministic fallback
13. ledger completed with checkpoint hash
```

### A6 — DispatchScopedKeybindingV2

```text
1. normalize raw terminal input to canonical event
2. inspect active scope stack by priority
3. choose first scope with at least one match
4. if exactly one action: dispatch and ledger keybinding.dispatched
5. if multiple actions: block, show diagnostic, ledger keybinding.conflict/blocked
6. if no action: return unhandled to editor text handling
```

### A7 — CompileSpecKitToHarnessDAG

```text
1. parse requirements with IDs, priority, acceptance, evidence policy
2. parse tasks with deps, write scopes, authority, verify commands, requirement IDs
3. validate unique IDs, acyclic DAG, gate presence, authority, no parallel write conflicts
4. compile compiled-dag.json, traceability.json, evidence-manifest.json, spec-hash.json
5. block Verified status unless all requirement-task-test-evidence links exist
```

### A8 — ReplayHarnessState

```text
1. load compiled spec, ledger, evidence manifest
2. verify ledger and transaction completeness
3. recompute evidence hashes
4. replay completed operations into control-plane state
5. compare final reconstructed state hash to final event afterStateHash
6. emit replay-report.json and replay-report.md
```

## Verification Gates

```bash
cd /home/yu/open-multi-agent-kit/packages/coding-agent
node node_modules/vitest/dist/cli.js --run \
  test/harness-control-events.test.ts \
  test/migrations-deprecation.test.ts \
  test/compaction.test.ts \
  test/interactive-mode-status.test.ts \
  test/suite/regressions/3217-scoped-model-order.test.ts

cd /home/yu/open-multi-agent-kit/packages/tui
node --test test/keybindings.test.ts

cd /home/yu/open-multi-agent-kit
npm run spec:check
npm run spec:compile
npm run spec:verify
npm run check
git diff --check
```

## Stop Conditions

- Ledger required-audit write fails.
- Operation has started event without terminal status.
- Rollback fails and no recovery artifact is created.
- Migration source hash/stat differs from plan.
- Keybinding conflict blocks input without visible diagnostic and ledger event.
- Compaction emergency summary omits current goal, blockers, evidence state, or resume action.
- Requirement lacks task/test/evidence traceability.
- Replay verifier cannot reconstruct final state hash.

## Success Definition

V2 is complete when `spec:verify` proves traceability, `verifyLedger()` proves hash-chain and transaction completeness, `replayHarnessState()` reconstructs the final state hash, and focused tests plus `npm run check` pass.
