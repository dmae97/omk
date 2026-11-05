# Workbench run graph observation

```bash
omk run graph RUN_ID --state-dir /private/operator-state/verified-runs --json
```

For an unbuilt development checkout, use the installed `tsx` loader:

```bash
node --import tsx packages/coding-agent/src/cli.ts run graph RUN_ID --state-dir /private/operator-state/verified-runs
```

The command reuses the existing verified-run explanation/evidence reader through
`readRunGraph()`. It brackets that read with committed authority-journal reads;
if authority changes during observation, it fails rather than emitting a torn proof.
It never dispatches, recovers, publishes, opens a model
session or modifies the journal. It rejects execution/approval flags. Exit `0`
means a snapshot was read successfully, **not** that the run passed. Invalid arguments
return `2`; a missing run, damaged evidence or failed observation returns `1` without a snapshot.

## `omk.run-graph.v1`

One UTF-8 JSON object followed by LF describes a full snapshot:

| Field | Meaning |
|---|---|
| `schemaVersion` | Exactly `omk.run-graph.v1` |
| `runtime` | `node`: the existing runtime, not a Rust execution claim |
| `graphKind` | `verified-run`, not the tool DAG, agent communication graph or remote AdaptOrch DAG |
| `executionRequested` | Always `false` |
| `capabilities` | `execute: false`, `amendGraph: false` |
| `runId` | Existing run identity |
| `cursor` | Run `revision`, `generation`, existing journal/contract/candidate/receipt/environment digest bindings, plus `authorityRevision` and `authorityDigest` |
| `state` | Verbatim execution, settlement, verification, application and publication axes |
| `proofVerdict` | Existing claim-closure verdict; not derived from the number of successful nodes |
| `nodes` | Existing task IDs, artifact dependencies, status, attempt, generation and advisory `ready` |
| `edges` | Exact direct dependencies as `{source, target, kind: "dependency"}` |

No prompt, command arguments, credentials, workspace paths, log bodies, inferred
agent/model identity, synthetic cost or UI coordinates are included. IDs/digests are
still local observation data, not anonymized publication artifacts. This projection
is not a general DLP filter or remote authentication protocol.

Node count and attempts inherit **this verified-run profile's** 16-task and two-attempt
limits; do not apply those limits to unrelated execution graphs. Non-DAG profiles
have empty nodes/edges, not fabricated agent nodes. A task can have an unknown/missing
projection. `ready` explains dependencies only, not grants, deadlines, resource availability
or permission to dispatch.

The authority cursor uses the committed tail's sequence/hash, not retained record
count, so compaction does not regress it. An absent authority store is revision
`0` with a 64-zero digest. The two journals are independently ordered, not one
atomic transaction or a new execution scheduler.

Full snapshots may skip either journal's revisions. An authority-only update may
change `proofVerdict` at the same run revision. A consumer binds the run and
contract and compares both cursor components. It ignores a componentwise older
cursor, rejects an incomparable cursor with one component regressing, and rejects
same-component hash conflicts. At the same run revision, run-derived content must
not change even when authority advances. Identical full snapshots are duplicates;
different content at the same complete cursor conflicts. Generation cannot regress
on an installed update. Snapshot equality/digests do not authenticate a
sender. Host epochs, authenticated IPC, incremental event replay and mutation
commands belong to a later, separate connection contract.

## Implementation boundaries

`src/core/verified-run/workbench-run-graph.ts` reuses existing authenticated readers.
SDK callers should use `readRunGraph()`; the pure `projectRunGraph()` requires the
same captured authority view used to produce its explanation. This change ships
only the Node producer. No native consumer or execution host is part of it, and
existing RPC/SDK/session formats are unchanged.

See the [verified-run command/approval boundaries](verified-run.md).
