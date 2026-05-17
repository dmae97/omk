---
name: omk-adaptorch-orchestration-review
description: Review AdaptOrch, OMK, and similar DAG multi-agent orchestration frameworks. Use when assessing DAG node responsibility, dependency edges, worker write authority, fallback/retry/timeout/evidence gates, review/merge boundaries, or reproducible decision traces.
---

## Orchestration Review

Use this for read-only architecture review of DAG runtimes, multi-agent pipelines, worktree teams, schedulers, and evidence-gated repair loops.

## Checklist

### DAG node contract

- Verify each node has one responsibility, one owner role, and one observable outcome.
- Verify inputs, outputs, side effects, and acceptance evidence are explicit.
- Flag nodes that mix planning, implementation, review, and merge authority without a gate.

### Dependency edges

- Confirm each edge represents a real data dependency, verification dependency, or authority handoff.
- Flag ordering-only edges that do not protect correctness or safety.
- Check that failed evidence blocks dependent nodes or routes them to repair.

### Worker authority

- Confirm each worker has bounded write scope and cannot overwrite unrelated lanes.
- Check shared-file ownership, merge points, and escalation paths.
- Require reviewer/merger separation for risky or cross-cutting changes.

### Resilience and gates

- Look for explicit retry limits, timeout presets, fallback routes, stop conditions, and evidence gates.
- Confirm fallback does not silently weaken acceptance criteria.
- Check that blocked, skipped, failed, and complete states are distinct.

### Decision trace

- Confirm routing, scheduler decisions, tool calls, evidence, retries, and final verdict are replayable.
- Flag missing timestamps, inputs, outputs, or rationale needed to reproduce a run.

## Output

```txt
Verdict:
DAG node issues:
Dependency edge issues:
Worker authority risks:
Missing gates:
Decision trace gaps:
Recommended fixes:
Files/artifacts reviewed:
```
