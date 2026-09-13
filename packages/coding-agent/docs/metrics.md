# Turn metrics

OMK records one JSON line per agent turn so harness changes can be measured
instead of guessed.

## CLI harness SOTA target

OMK targets state-of-the-art quality as a CLI coding-agent harness. **SOTA is
not verified.** This is a product target, not a statement that the current
release leads a benchmark or a named competitor cohort.

The target covers the harness layer:

| Dimension | Primary measure |
| --- | --- |
| Task success | solved tasks and pass rate |
| Cost efficiency | model cost and tokens per solved task |
| Latency | wall-clock p50/p95 per solved task |
| Context efficiency | input, cache, compaction, and tool-output tokens per solved task |
| Tool reliability | failure, retry, refusal, and intervention rates |
| Orchestration | critical-path time, useful concurrency, and duplicate work |
| Recovery | interrupted-run resume accuracy and repeated-run variance |
| Safety | policy violations, unauthorized effects, and false-positive blocks |
| Maintainability | complexity, module-size debt, and regression-gate health |

No single feature count or self-score establishes leadership. OMK reports a
dimension-specific result unless a preregistered aggregation defines an overall
score.

### Controlled comparison contract

A comparative harness run MUST hold the **same model**, **same provider** and
model configuration, **same task** and revision, **same budget**, equivalent
tool permissions, and comparable container, hardware, region, and concurrency
constant. The harness is the treatment variable. If a factor cannot be held
constant, the report must label the result non-comparative.

Every comparative report must include:

- the date, harness versions, and **named comparison cohort**, with its inclusion rule frozen before execution;
- immutable model, provider, container, environment, and configuration identities;
- the task manifest, seeds, public prompt or sanitized prompt digest, budgets, run order, and stop policy;
- sanitized per-task outcomes plus cost, token, latency, retry, and intervention data;
- the confidence interval, significance threshold, minimum effect, and statistical test chosen before inspecting the result;
- the exact commands and immutable manifests needed for **reproducible evidence**.

Use paired A/B measurements. Randomize or interleave pair order when provider or
machine drift can bias one side. Do not combine values produced by different
methods, working directories, task revisions, or warm/cold conditions. A
roadmap projection remains a hypothesis even when its inputs are measured.

### Evidence privacy

Benchmark evidence is private by default. Public artifacts may contain public
or synthetic task identifiers, version and image digests, allowlisted runtime
metadata, sanitized outcomes, and aggregate statistics. They must not contain
credentials, private prompts, proprietary source, raw tool arguments or output,
environment values, personal data, or absolute user paths.

Keep restricted raw evidence local or in an access-controlled store with an
explicit owner and retention period. Normalize paths, redact content, scan for
secrets and PII, and obtain human approval before publication. Digests and
public task manifests preserve reproducibility without disclosing restricted
content.

A public “SOTA,” “best,” “leading,” or “#1” claim requires a dated controlled
comparison that places OMK on the relevant quality/cost/latency frontier without
violating declared safety and regression floors. Until then, use “targets
state-of-the-art quality.”

[Harbor's Terminal-Bench runner](https://www.harborframework.com/docs/tutorials/running-terminal-bench)
and the [SWE-bench containerized harness](https://www.swebench.com/SWE-bench/api/harness/)
are reference evaluation surfaces. Their presence or a selected task list is
infrastructure, not a benchmark result.

This is separate from the two things that already existed:

| Surface | Purpose |
| --- | --- |
| `core/run-journal.ts` | Hash-chained **integrity** log (run started/finished/recovered, tool timeout). Answers "was this run tampered with or abandoned". |
| `core/telemetry.ts` | Install-time opt-in flag. Nothing else. |
| `core/turn-metrics.ts` | **Performance and quality**: cost, latency, tool failure rates, cache effectiveness. |

## Where it goes

`<cwd>/.omk/metrics/turns.jsonl`, append-only, rotated once past 8 MB
(`turns.jsonl.1`), file mode `600`.

| Variable | Effect |
| --- | --- |
| `OMK_TURN_METRICS=0` | Disable recording entirely. |
| `OMK_TURN_METRICS_DIR` | Write somewhere else. |

## Reading it

```bash
omk stats                    # aggregate report for the current project
omk stats --dir <path>       # a different metrics directory
omk stats --json             # machine-readable summary
```

```text
Turn metrics — 412 turns across 27 session(s)
  models        anthropic/claude-sonnet-4-5
  turn duration p50 4.2s · p95 31.8s
  input 91,204 · output 22,880 · cacheRead 1,904,551 · cacheWrite 88,100
  cache read share 95.4% of prompt-side usage
  cost          $4.8812
  compactions 6 · failovers 1 · ctx plan hit 41.2%

  tool                 calls   fail%     p50     p95    total
  bash                   688    4.2%   210ms    3.1s     4.1m
  edit                   201    9.0%    38ms   140ms    12.4s
```

## What is recorded

Counts, durations, ids, and error *classes*:

```json
{
  "schemaVersion": "omk-turn-metrics-2",
  "sessionId": "…", "turnIndex": 12,
  "provider": "anthropic", "model": "claude-sonnet-4-5",
  "startedAtEpochMs": 1, "endedAtEpochMs": 2, "durationMs": 1,
  "usage": { "input": 100, "output": 20, "cacheRead": 900, "cacheWrite": 10, "costUsd": 0.0125 },
  "stopReason": "toolUse",
  "toolCalls": [{ "name": "bash", "durationMs": 120, "ok": false, "errorClass": "unknown" }],
  "toolCallCount": 1, "toolFailureCount": 1
}
```

New records project an explicit field allowlist. Prompt, argument, output, environment,
and unknown nested fields are not copied into the record; caller-supplied `toJSON`
properties are not retained. Raw tool errors are classified as `timeout`, `aborted`,
`permission`, `not_found`, `invalid_input`, or `unknown` and then discarded.
Length truncation alone was not redaction. Identifiers are still metadata, not anonymized
identities: callers must not put secrets or task content in ID/name fields.

The reader validates required fields, finite nonnegative quantities, counters, and
nested tool/usage/cache shapes before aggregation. Invalid records count as malformed.
Valid v1 records remain readable, but existing files are **not rewritten or scrubbed**;
review old files separately before sharing them.

Metrics remain advisory. Invalid input, an oversized record, or a failed write is
counted and dropped rather than failing the agent. Single records cannot exceed the
configured file bound. Rotation is still best-effort and does not provide a transactional
multi-writer size guarantee.

## Capability baseline

Runtime metrics tell you what a session cost, not whether the harness can solve
tasks. For that, `scripts/tb-mini-suite.mjs` selects a deterministic,
difficulty-stratified Terminal-Bench 2.1 subset. Score comparisons still require
the controlled comparison contract above:

```bash
node scripts/tb-mini-suite.mjs             # human-readable selection
node scripts/tb-mini-suite.mjs --json      # feed a runner
node scripts/tb-mini-suite.mjs --seed 7    # a different fixed subset
```

With identical task metadata, selection version, seed, size, and collation, selection is repeatable.
The default 15-task subset oversamples easy tasks and prioritizes shorter expert
time estimates; it is a regression signal, not a population-representative score
or an agent runtime bound. Selection alone is not a capability result. Scoring
requires Docker, `harbor`, and model spend, and is not wired into `npm run check`.

`--size` must be a positive safe integer no larger than the available task
population. Missing difficulty quotas are filled from unselected tasks using the
same ordering, so a valid request returns exactly that many distinct tasks.
`--seed` accepts integers from `0` through `4294967295`. Invalid or missing option
values and oversized requests exit with code `2`; absent, empty, or non-directory
task paths exit with code `1`.

The JSON output now declares `selectionVersion: 2`. Missing, empty, nonfinite, or
negative expert-time estimates are `null`, not zero. Within each difficulty band
and in quota refill, known estimates sort before unknown estimates. A genuine zero
or fractional estimate remains valid. Difficulty quotas still take precedence, so
unknown-estimate tasks can be selected to fill a band.

`knownExpertMinutes` sums known estimates; `unknownExpertEstimates` counts selected
tasks with unknown estimates. `totalExpertMinutes` is `null` when any selected
estimate is unknown. A nonfinite sum is refused with exit `1`, not serialized as
an apparently missing total. Expert estimates are not agent timeout limits.

For sizes 1–2, available slots go first to the highest-weight difficulty bands
(medium, then hard), with normal refill if those bands are unavailable. Task names
no longer decide which excess band quota is discarded. The normal-size quota rule
is preserved. Human-readable counts use a `Map`, including for labels such as
`__proto__` that overlap JavaScript object properties.

This is a selection and output-contract change: default membership can change when
metadata is incomplete, and the prior default JSON digest is historical only.
Freeze new task manifests before comparison; do not combine version 1 and 2 runs
as if their selection policy were identical. The limited flat TOML field reader
is unchanged; this does not add general TOML syntax support.

Run the offline CLI regression tests without downloading tasks or calling models:

```bash
node --test --test-concurrency=1 scripts/test/tb-mini-suite.test.mjs scripts/test/tb-mini-suite-ranking.test.mjs
```

See [the harness roadmap](../../../ROADMAP.md) for the dated OMK versus Terminus-2
baseline, statistical limitations, implementation boundaries, and staged acceptance
criteria. Planned runtime improvements are not measured benchmark gains.

### Audit recorded TB 2.1 results

The checkout-only `scripts/tb21-audit.mjs` audits explicitly selected Harbor jobs
against a caller-pinned manifest digest. It rejects duplicate tasks/trials, missing
results or costs, mismatched task checksums or configured model labels,
missing/invalid completion times, and contradictory success records. It never starts a model, picks the latest job, joins
requests by timestamp, or rewrites evidence. See [TB 2.1 offline audit](tb21-audit.md)
for the schema, invocation, error codes, and limitations.

A complete audit means recorded outcomes passed these checks, not that every
provider request obeyed a single-model contract. Wire provenance, actual billing,
repeated-trial analysis, and statistical superiority need separate evidence.

### Output-limit validation: availability history

**2026-09-13 source snapshot (`ca75f4e5cc`):** the logical contract, CLI/SDK
wiring, and final Chat Completions model/output-limit checks are in the committed
source. [Model dispatch contracts](model-contract.md) defines their coverage;
[Verified Run](verified-run.md) describes the separate protected execution path.
Neither is a universal provider billing cap or a new controlled benchmark result.
See [the roadmap, section 16](../../../ROADMAP.md) for current local release-preparation checks.

The following paragraphs describe the earlier checkout only. Its missing modules
and failing collection are historical observations, not active release blockers.

**2026-09-08 follow-up:** the current worktree restores the logical contract and
connects it through the CLI/SDK, including SDK-stream summaries. See
[Model dispatch contracts](model-contract.md) and ROADMAP §13 for fresh evidence
and the remaining final-wire/accounting gaps. The warning below records the
preceding checkout, not the current availability of the restored module.

The previous worktree checkpoint tested positive-safe-integer validation of
`modelContract.maxOutputTokens` and explicit request `maxTokens`. During the
2026-09-08 re-verification, the checkout changed: `run-model-contract.ts` and the
corresponding `AgentLoopConfig.modelContract` surface were absent. The remaining
`model-contract-output-limit.test.ts` fails collection against that checkout.

Do not treat the historical passing tests as proof that this guard is currently
available. Restoring or porting the runtime contract requires an explicit source
baseline decision and fresh send-boundary tests. No missing code was silently
recreated and no failing test was deleted. Full run-wide enforcement, including
omitted limits and compaction, remains unverified; see ROADMAP sections 11–12.
