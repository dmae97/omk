# `omk-protocol`

Canonical contracts and pure reducers for the OMK Run Protocol.

```text
TaskSpec -> ExecutionAttempt -> Observation -> EvaluationResult -> RuntimeDecision
```

## API

- `PROTOCOL_VERSION` (`omk.run.v1`)
- `TaskSpec`, `ExecutionAttempt`, `Observation`, `ClaimPredicate`
- `ClaimEvaluation`, `EvaluationResult`, `RuntimeDecision`, `WaiverRecord`
- Runtime parsers for every top-level record
- Opt-in command/scripted-agent profiles: immutable `RunContract`, `RunScriptedWriter`,
  `RunStartCommand`, `parseRunContract()` and `parseRunStartCommand()`
  (`omk.verified-run.v1` and `omk.verified-command.v1`). The scripted profile bounds
  approved steps and offline logical requests. Parsing never grants approval or executes work.
- `RunResumeCommand`, `parseRunResumeCommand()` and `MAX_VERIFIED_RUN_GENERATIONS`:
  candidate/contract/revision/generation-bound intent for host-governed recovery.
  The runtime must still verify owner, clock, budget, process termination and evidence.
- `RunWriterRestartCommand` / `parseRunWriterRestartCommand()` separately bind a local
  writer restart to an immutable input checkpoint. They grant no remote replay authority.
- Bounded `linux-command-dag-v1`: `RunDagWriter`, `RunDagTask`, `orderRunDag()`,
  `runDagAncestors()`, `MAX_RUN_DAG_TASKS` and `MAX_RUN_TASK_ATTEMPTS`. Pure graph
  ordering/closure does not schedule or authorize a process.
- `RunTaskRetryCommand` / `parseRunTaskRetryCommand()` bind a failed/interrupted task
  selection to the original input and exact revision/generation. Empty selections
  request pending-only continuation, not permission to omit a failed dependency.
- `evaluateTask()` and `reduceRuntimeDecision()`
- Claim Closure Graph v1: `evaluateProofClosure()`, `validateClaimGraph()`,
  `minimalBlockingCut()` and the readonly claim/observation/waiver vocabulary

The claim-closure API is explicit. It checks supplied source/environment bindings,
trust floors, witness groups, expiry, workspace completeness and unresolved-effect
boundaries; those supplied facts remain caller trust boundaries. It does not attest a
runner or automatically decide an ordinary chat turn.

## Claim closure and blocking explanations

`evaluateProofClosure()` evaluates qualified witnesses on an all/any claim DAG.
Set `witnessIndependence: "explicit-groups"` for a strict profile: multi-witness
claims (`requiredWitnesses > 1`) then require explicit, nonempty `independenceGroup`
values. Merely changing an observation ID does not create another independent
witness in that profile. Single-witness claims keep their existing behavior.

The compatibility default remains `legacy-observation-id`; the result reports the
resolved policy. Existing callers must opt into the strict profile deliberately.
Group identities still need binding to real evidence origins by a trusted caller;
the reducer cannot authenticate an arbitrary caller-supplied label.

`explainBlockingCut()` returns a bounded antichain repair explanation. Shared DAG
branches can share one repair. Composite-local counterexamples and scope obligations
are retained alongside child obligations rather than being hidden by them.

- `blockingCut.optimality: "minimum"` means minimum cardinality in this snapshot's
  repair model, not semantic correctness after a real change.
- At the candidate/operation limit, `algorithm: "greedy"`, `truncated: true`, and
  `optimality: "not-proven"` identify a fallback with no minimality guarantee.
- The legacy `minimalBlockingCut` array remains as a compatibility projection.
  Consumers needing optimality must read the explanation metadata. Older results
  without that metadata do not establish a minimum.

Repair explanations never close claims, reconcile effects, issue waivers, or authorize
merges. Re-evaluate evidence after a change. Set operations depend on candidate and
set sizes; the shared-DAG optimization is not a linear-time minimum-cut algorithm.

The package does not execute tools, persist records, schedule work, choose providers, or infer topology. Retry and failover counts are derived from attempt records rather than stored counters.

See [OMK Run Protocol v1](https://github.com/dmae97/omk/blob/main/packages/coding-agent/docs/run-protocol.md) for evaluation rules, receipt bridging, migration status, and authority boundaries.
