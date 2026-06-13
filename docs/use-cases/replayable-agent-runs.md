# Replayable agent runs

## Short answer

A replayable agent run means OMK records what a coding agent planned and did as artifacts under `.omk/runs/<run-id>/`, so the run can be inspected, audited, and replayed later.

## What artifacts does OMK save?

A dry run writes:

```txt
.omk/runs/<run-id>/input-envelope.json
.omk/runs/<run-id>/dag.json
.omk/runs/<run-id>/dag-compile-report.json
```

Executing the compiled DAG adds loop artifacts such as `loop-state.json` and `loop-decisions.jsonl`. Run event logs are written to `.omk/runs/<run-id>/events.ndjson`.

## How do I inspect or replay a run?

```bash
omk runs
omk inspect <run-id>
omk replay <run-id>
omk why
```

## Why does replay matter?

Replayable artifacts let a reviewer see the goal, the compiled DAG, the routing decisions, and the evidence trail instead of trusting a narrative "done" message.

## What this does not claim

Run artifacts are reviewable local state, not a guarantee of correctness. Treat them as evidence to inspect, not as proof that a change is safe.

## Related

- [What is OMK?](../what-is-omk.md)
- [Evidence-gated coding agents](evidence-gated-coding-agents.md)
- [OMK claims and evidence](../claims.md)
