# Runtime Algorithms and Direction

## Current feature status (audit §19.3)

"Implemented", "wired", "enabled", "verified in CI", "released", and
"measured benefit" are different gates. A pure function passing unit tests is
not a live product path, and a live path is not a measured improvement. This
table records each mechanism's actual gate at the pinned commit; the dated
baseline below is history, not current truth.

| Mechanism | Implemented | Wired into live path | Enabled by default | Verified in CI | Released | Measured benefit |
| --- | --- | --- | --- | --- | --- | --- |
| DAG claim scheduler (`tool-dag-scheduler`) | yes | `agent-loop` frontier executor | `toolScheduler: "dag-v2"` | unit + integration tests | v0.99.x line | not measured |
| Ready-frontier admission (`runDagFrontier`) | yes | `agent-loop` | same | `tool-dag-ready-frontier`, `tool-dag-hook-replan` tests | working tree | not measured |
| Dynamic-claim conflict check (`conflictsWithUnsettledClaim`) | yes | `agent-loop` | same | `tool-dag-dependencies` + hook tests | working tree | not measured |
| ECRAF admission planner (`tool-dag-ecraf`) | yes | **no** — no call path wires it | n/a | unit tests only | unreleased | not measured |
| Context Budget V2 | yes | system-prompt assembly | opt-in policy | planner/selection/cache tests | working tree | not measured |
| Tier floor reservation | yes | context-budget-v2 planner | when V2 enabled | `context-budget-v2-tier-floor` tests | working tree | not measured |
| Reasoning router v4 | yes | `/think auto` lane | opt-in | router tests | released | classification only, not success-probability calibration |
| Workload permit pool | yes | resource admission | default | pool tests | released | not measured |
| Provider retry/failover classification | yes | `provider-retry`, `session-failure-cause` | default | resilience/classification tests | released | not measured |
| MCP descriptor injection screen | yes | `mcp/manager` import path | default | quarantine tests | released | pattern rule score, not calibrated risk |
| verified-run coordinator + evidence | yes | verified-run paths | opt-in command | coordinator/evidence tests | working tree | scope-limited binding, not general correctness |

Gates are reported per row so a green "implemented" never upgrades itself to
"released" or "measured".

## ECRAF arithmetic boundary (2026-09-17)

The internal `planEcrafAdmissions()` planner rejects non-finite derived density
denominators, scores, and reserved usage with `RangeError`, even when each input
number is finite. Scores are computed once per candidate before sorting or
calling the conflict predicate; singleton and zero-slot batches receive the same
validation. A bounded resource overflow still defers the candidate and allows
later feasible candidates. An unbounded resource has no capacity limit, but its
usage must remain representable as a finite number. Failed passes return no
partial admission plan and do not mutate caller input.

Regression coverage is in
`packages/agent/test/tool-dag-ecraf-arithmetic.test.ts`; existing numeric and
property tests remain in `packages/agent/test/tool-dag-ecraf.test.ts`.
This is local pure-planner validation, not live frontier wiring, CI confirmation,
a release, or evidence of latency/quality improvement. Resource normalization,
slot-aware ranking, fairness, and equal-budget runtime comparisons remain separate
work.

## Final claim resolution is abort-bound (2026-09-19 audit F02)

The dag-v2 frontier re-resolves each prepared call's resource claims from its
exact post-hook arguments before admission. That wait was a bare `await`; the
initial scheduling pass in `tool-dag-memo` was already raced against the run's
abort signal, so an extension `resourceClaims()` that never settled on the
second call pinned a cancelled run until the callback returned on its own.
`resolveFinalResolution` now uses the same `awaitWithAbort` boundary. The
callback itself is not killed — a plain Promise cannot be — but the aborted
outcome settles the call, the frontier loop exits on the same signal, and a late
fulfilment or rejection lands in a finished batch and admits nothing. In-flight
peers keep the existing abort contract (`aborted`, `executionStarted: true`),
and the authorization hook still runs once. Coverage:
`packages/agent/test/tool-dag-final-claims-abort.test.ts`. This is the wait
boundary only; isolating a non-cooperative extension needs a killable execution
boundary, which this change does not add.

## Working-tree shared run budgets

The SDK `prompt(..., { runBudget })` path now shares a monotonic deadline and
logical request/concurrency limits across the active prompt's main stream,
retries, continuations, and first-party summaries using that stream. Exhaustion
is a non-retryable `budget_exhausted` termination; snapshots keep outstanding
streams until terminal metadata arrives. No request/time budget is imposed by
default. Preflight is now owned even for unbounded prompts; unresolved streams
block a later prompt instead of being discarded when their budget scope closes.
See [Shared run budgets](sdk.md#shared-run-budgets-sdk-opt-in) for units, zero
semantics, cancellation, and uncovered paths. This is not billing enforcement,
a persisted budget, or a hard process-termination deadline.

## Working-tree execution ownership (2026-09-10)

The live session now retains registered tool-promise ownership after timeout or
abort, defers prompt settlement/resource-lease release until actual termination,
and rejects overlapping prompt admission. Shared permits capture request values,
honor zero capacity, and wake FIFO followers after head cancellation/expiry.
The internal lane launcher forwards cancellation and respects zero/heavy caps.
Independent bash calls now own separate cancellation controllers, and one call's
completion cannot hide another active call. Core teardown waits use a monotonic
clock, preserving the existing grace interval across wall-clock changes.
See [Prompt settlement](sdk.md#prompt-settlement) for tests, compatibility, and
uncovered paths. These changes do not implement a durable verified-run product.

## v0.98.3 release delta (2026-09-06)

The explicit advisory SDK requires normal first-party model completion, honors cancellation,
reports caller-rank top ties, and preserves intake/missingness diagnostics. See
[Advisory selection integrity](advisory-selection.md). No default AgentSession/TUI judge,
additional completion calls/retries, or calibrated risk policy is activated.

`omk-protocol` also exports Claim Closure Graph v1 evaluation; `omk-adaptorch-wpl` exports
proof-result/VERA projections. They consume caller-supplied evidence, not authenticated
runner truth. The operation-trace and Effect Journal V2 modules in `omk-agent-core` remain
internal primitives: this release does not wire them into a new live authority loop.

The dated audit below preserves the v0.97.0 baseline and its then-working-tree classifications.
The context floors, explicit-rule compactor, resource report, settlement notifications and
OpenWiki guards described as working-tree changes below subsequently shipped in v0.98.0.
That does not ship a generated OpenWiki corpus or promote the blocked lane/memory policies.
Source and tests remain authoritative.

## Historical v0.97.0 baseline audit

- **Snapshot date:** 2026-08-27
- **Released baseline:** OMK `v0.97.0` (`b38a2c8c84`)
- **Repository baseline:** `4b79c65eaf` plus the local working tree

## Status vocabulary

| Status | Meaning |
| --- | --- |
| **Released / default** | Present in `v0.97.0` and selected when relevant settings do not override it |
| **Released / opt-in** | Present in `v0.97.0`, but requires a command, setting, or explicit API call |
| **Released / internal** | Implemented and tested, but not connected to a live user path |
| **Working tree** | Present in the current checkout only; not shipped and not a release promise |
| **Proposed** | Design direction without a complete implementation and verification path |

A mechanism's existence does not make it authoritative. OMK promotes a mechanism
only after its live call path, default, evidence, and rollback are all explicit.

## Runtime control path

```text
Prompt or durable-goal round
  -> system-prompt assembly
     -> Context Budget V2 when globally enabled
  -> local v4 reasoning routing when /think auto is active
  -> provider attempt
     -> same-family route rotation, retry, or configured failover when eligible
  -> tool scheduling
     -> v0.97.0 CLI default: dag-v2; direct core fallback is revision-specific
     -> pre-hook claims -> deferred authorization -> post-hook claim re-plan
     -> deterministic level execution and source-order results
  -> journals, receipts, and session termination records
  -> optional omk-protocol evaluation
     TaskSpec -> ExecutionAttempt -> Observation -> EvaluationResult -> RuntimeDecision
  -> retry, continuation, or final prompt settlement
```

The protocol line is a released library and adapter surface. An ordinary chat
turn does not automatically become a `TaskSpec`; callers opt into that semantic
evaluation contract.

## Current algorithm surface

### Tool scheduling and settlement

**Status: Released / default.** The `v0.97.0` CLI sets `dag-v2`; direct
`omk-agent-core` calls fall back to `waves-v1`. The working tree changes that
core fallback to `dag-v2`, but that promotion is unreleased. The scheduler canonicalizes resource claims, preserves source order,
and places conflicting calls in later levels. Before a level executes, OMK authorizes its calls and
re-plans with post-hook arguments so a hook cannot silently invalidate the
original claim plan.

The live executor uses level barriers. `assignDagDependencies()` computes a
finer predecessor graph, but no live executor consumes it. Each candidate level
is authorized and then re-planned from post-hook arguments.

Evidence:

- `packages/agent/src/tool-dag-scheduler.ts`: `assignDagLevels`,
  `assignDagDependencies`, `scheduleDagLevels`
- `packages/agent/src/agent-loop.ts`: `executeToolCallsDagLevels`,
  `runDagLevelCalls`
- `packages/agent/test/tool-dag-scheduler*.test.ts`
- `packages/agent/test/tool-dag-dependencies.test.ts`

**Working tree:** timed-out tools receive a bounded 250 ms teardown window. A
cooperative process may settle and let the model react to the timeout; a tool
still running after the window stops the run because it may still mutate the
workspace. This candidate lives in
`packages/agent/src/tool-timeout-settlement.ts` and is covered by
`packages/agent/test/tool-timeout-loop-continuation.test.ts`.

### Context selection

**Status: Released / opt-in.** Context Budget V2 is enabled globally through
`contextBudget.enabled` or per process with `OMK_CONTEXT_GOVERNOR=1`.

The planner:

1. reserves response and safety tokens;
2. pins hard or required items first;
3. computes tier floors and ceilings;
4. scores optional items for relevance, recency, evidence, redundancy,
   priority, and full-text token cost;
5. sorts optional items by
   `density -> effectiveScore -> priorityRank -> fullTokens -> id`; and
6. selects a full, summary, headroom-compressed, pointer, or omitted
   representation that fits.

Density divides effective score by the cheapest non-omit representation
(`admissibleTokens`), not by full-text size. This avoids penalizing an item that
can be represented by a small evidence pointer. Stable item IDs and explicit
selection policy `sel-3` make tie-breaking and plan-cache invalidation
deterministic.

### Representation cost accounting (2026-09-19 audit F01)

Every derived representation is priced by counting the string it materializes
with the planner's own token counter, the same counter that priced the full
text. The former `ceil(0.15 * full) + 8` summary price was a compression target,
not a cost: a 100-character "summary" identical to its source was recorded at
12 tokens against the source's 25 and admitted into a 12-token budget. A
representation whose text equals the source, or whose counted cost is not below
the full text, is no longer offered. `createPlannedItems` stores the priced
candidates on each planned item so ranking and selection read one cost; the
selection policy token moved from `sel-2` to `sel-3` so plans and
representation entries cached under the old prices are not served.

Known limitation (audit F04, not addressed): items are ranked by their cheapest
admissible representation but may be admitted at full text, so a high-priority
item priced at 10 can consume 100 and displace two 45-token items whose sum the
policy's own preference scores would rate higher. Fixing this means choosing
`(item, representation)` pairs jointly.

Evidence:

- `packages/coding-agent/test/context-budget-representation-accounting.test.ts`

When enabled, representation and negative-result entries persist under
`.omk/cache/context-budget-v2`; plan entries remain session-memory-only.
`OMK_CONTEXT_GOVERNOR_CACHE=memory` keeps every cache entry in session memory,
and `OMK_CONTEXT_GOVERNOR_CACHE_DIR` relocates the representation snapshot.

Evidence:

- `packages/coding-agent/src/core/context-budget-v2-planner.ts`
- `packages/coding-agent/src/core/context-budget-v2-scoring.ts`
- `packages/coding-agent/src/core/context-budget-v2-selection.ts`
- `packages/coding-agent/test/context-budget-v2-knapsack-order.test.ts`
- `packages/coding-agent/test/context-budget-selection-policy-version.test.ts`
- `packages/coding-agent/test/context-budget-cache-disk.test.ts`

**Working tree:** non-queued native `xai` and `devin` requests started through `AgentSession.prompt()` now derive a bounded automatic skill grant from live discovered descriptions after ordinary prompt-template expansion. The selector scores task text separately from camelCase-aware path-to-skill-name signals, excludes explicit-only skills, caps automatic matches at three, and adds `headroom` only under lexical or measured context pressure. `AgentSession.prompt()` merges the result with settings/SDK/bang selections only for that request. Queued steering/follow-up messages reuse the active run's system prompt and do not trigger another selection pass.

Evidence:

- `packages/coding-agent/src/core/active-skill-state.ts`
- `packages/coding-agent/src/core/skill-selector.ts`
- `packages/coding-agent/src/core/harness-skills.ts`
- `packages/coding-agent/src/core/grok-harness.ts`
- `packages/coding-agent/src/core/devin-harness.ts`
- `packages/coding-agent/src/core/agent-session.ts`
- `packages/coding-agent/test/grok-active-skills.test.ts`
- `packages/coding-agent/test/devin-active-skills.test.ts`
- `packages/coding-agent/test/skill-selector.property.test.ts`

**Working tree:** context files now treat their global/local relevance baseline
as a floor. Lexical overlap can raise that score but cannot demote standing
instructions below the no-query baseline. Skills remain topic-scored because
they are optional capabilities, not standing authority. The change is in
`scoreContextFileRelevance()` with regression coverage in
`packages/coding-agent/test/context-budget-relevance.test.ts`.

**Working tree:** the default compactor now strips model-generated managed-rule
sections and deterministically carries explicit user-authored `RULE`/
`INVARIANT`/`CONSTRAINT`/`MUST`/`NEVER`/`ALWAYS` markers (plus explicit Korean
markers) outside LLM rewriting. Rules are bounded to 64 × 1,000 characters,
stored in additive non-hook compaction details, and covered by a five-round
byte-preservation test. Natural-language classification, hook summaries, branch
summaries, and cross-session memory remain outside this slice. Persisted rules
are credential-redacted and source-bound to a user entry/line/digest; previous
details are reused only when their canonical block matches the prior summary.

Evidence:

- `packages/coding-agent/src/core/compaction/knowledge-triage.ts`
- `packages/coding-agent/test/compaction-knowledge-triage.test.ts`
- `packages/coding-agent/test/compaction-summary-reasoning.test.ts`

### Reasoning routing

**Status: Released / opt-in.** `/think auto` uses the local, deterministic v4
router. It extracts bounded prompt features, classifies one of seven task
classes, maps the class through `TASK_CLASS_THINKING_LEVELS`, applies lane
steps, bounded bias/hint adjustments, and non-negative uncertainty escalation,
then clamps the result to the selected model's supported levels.

The released extension-signal coefficients are active and bounded:
`multiTurnPrior=2`, `pressureBucket=1`, and `judgeVote=2`. History and pressure
are supplied by the main session; a judge vote affects only callers that provide
one. A zero-score fallback cannot be hijacked by these signals.

The optional learning path is global-only and off by default. When enabled, a
session loads one strictly validated `RouterBiasSnapshot` from the configured
path or repository-scoped default, pins that snapshot or miss for the session,
applies a `-2..2` step bias, and writes only bounded feedback buckets. It never stores prompts, diffs, tool
output, provider payloads, or repository paths.

Evidence:

- `packages/coding-agent/src/core/reasoning-router-v4.ts`
- `packages/coding-agent/src/core/reasoning-router-resolver.ts`
- `packages/coding-agent/src/core/reasoning-router-bias.ts`
- `packages/coding-agent/test/suite/regressions/013-reasoning-router-v4-accuracy.test.ts`
- `packages/coding-agent/test/suite/regressions/014-reasoning-router-v4-learning-wiring.test.ts`
- `packages/coding-agent/test/suite/regressions/018-reasoning-router-v4-inert-weights.test.ts`

**Working tree:** promotion evidence now credits a row only when repeated
baseline and candidate classifier replays each agree. It also requires a frozen
baseline and fails closed on insufficient or unstable replays. See
`reasoning-router-replay-stability.ts`, `reasoning-router-policy-ceiling.test.ts`,
and `reasoning-router-replay-stability.test.ts`.

### Resource governance, lanes, and shards

The resource plane probes memory, workspace disk, V8 heap, and system CPU, then
produces bounded admission caps.

| Mechanism | Status | Authority |
| --- | --- | --- |
| Prompt-time probe, admission decision, and journal | Released / default | Observe and record |
| `/resource` and `omk doctor resources` | Released / opt-in | Inspect current policy and probe state |
| `omk doctor resources --report` | Working tree | Aggregate bounded local admission evidence; never promotes mode |
| Per-run tool cap and governed heavy-process permits | Released / opt-in | Enforced in `adaptive` or `strict` mode |
| `launchSubagentLanes()` | Released / internal | No live child-dispatch consumer |
| Journaled Vitest/Jest/workspace/Go shard executor | Released / internal | No `autoShard` setting or session-command consumer |

`observe` remains the default. Admission caps never raise configured caps.
Corrupt shard journals are quarantined and block resume; completed shards may be
skipped, but shard completion is only evidence and never a task verdict.

Evidence:

- `packages/coding-agent/src/core/resource-admission.ts`
- `packages/coding-agent/src/core/resource-governor-settings.ts`
- `packages/coding-agent/src/core/run-resource-lease.ts`
- `packages/coding-agent/src/commands/resource-doctor-cli.ts`
- `packages/coding-agent/src/core/resource-observation-report.ts`
- `packages/coding-agent/test/resource-observation-report.test.ts`
- `packages/coding-agent/src/core/subagent-lane-launcher.ts
- `packages/coding-agent/src/core/workload-shard-executor.ts`
- `packages/coding-agent/test/resource-admission.test.ts`
- `packages/coding-agent/test/resource-doctor-cli.test.ts`
- `packages/coding-agent/test/agent-session-resource-lease.test.ts`
- `packages/coding-agent/test/agent-session-resource-permits.test.ts`
- `packages/coding-agent/test/subagent-lane-launcher.test.ts`
- `packages/coding-agent/test/workload-shard-executor.test.ts`

### Terminal settlement notifications

**Status: Working tree.** `v0.97.0` released completion sound as opt-in and
suppressed user aborts. The current working tree enables it by default on an
interactive TTY and adds an `onAbort` outcome switch. Successful prompts retain
the 5-second duration floor; failed and aborted/stopped outcomes notify
immediately.

The sound consumes only `prompt_settled`, never intermediate `agent_end`. The
current live path drains provider attempts, tools, and queued continuations;
subagent work is awaited inside its tool call. The settlement reducer reserves
direct child/shard counters, but no production signal call wires them yet, so
future live lanes/shards must close that gap before activation.
RPC, JSON, print mode, and CI remain silent. Playback uses fixed absolute
executable/argv pairs, a minimal environment without inherited `PATH` or
credentials, and a neutral temporary cwd. WSL uses BEL rather than resolving
PowerShell through `PATH`. Playback is fire-and-forget and cannot change the
prompt outcome.

Evidence:

- `packages/coding-agent/src/core/prompt-settlement.ts`
- `packages/coding-agent/src/core/completion-sound.ts`
- `packages/coding-agent/src/core/completion-sound-io.ts`
- `packages/coding-agent/test/prompt-settlement.test.ts`
- `packages/coding-agent/test/completion-sound.test.ts`
- `packages/coding-agent/test/suite/agent-session-retry-events.test.ts`

### Evidence, decisions, and recovery

**Status: Released / opt-in.** The explicit `omk-protocol` API provides versioned,
readonly record contracts and runtime parsers for tasks, attempts, observations,
evaluations, waivers, and runtime decisions. `evaluateTask()` is pure. Among
unwaived required claims, any violation yields `fail`; otherwise missing
evidence yields `inconclusive`; otherwise the verdict is `pass`. A task with no
required claims is `inconclusive`; explicit waivers remove their claims from
verdict reduction. Advisory judging can choose among candidates that already
passed; it cannot create evidence or change a semantic verdict.

The coding-agent adds evidence receipts, a replay ledger, workspace
fingerprints, attempt journals, durable goals, seam checkpoints, session doctor,
and bounded provider retry/failover. Digests detect mismatch; they do not prove
runner honesty, OS isolation, freshness, or trusted authorship by themselves.

Evidence:

- `packages/protocol/src/evaluation.ts`: `evaluateTask`
- `packages/protocol/src/decision.ts`: `reduceRuntimeDecision`
- `packages/protocol/test/protocol.test.ts`
- `packages/coding-agent/src/core/advisory-judge.ts`
- `packages/coding-agent/test/advisory-judge.test.ts`

**Working tree (2026-09-05):** the first-party `createModelAdvisoryJudge()` adapter rejects non-normal
or missing completion metadata. Custom judges still supply raw score JSON and own that metadata
boundary. The chooser checks cancellation around asynchronous work, reports top-score ties as
caller-rank decisions, and retains submitted/eligible/excluded counts with comparison availability.
This adds no completion calls or retries, automatic AgentSession/TUI call, or semantic-verdict authority.
Details: [Advisory selection integrity](advisory-selection.md); governing spec:
`specs/021-advisory-selection-integrity/spec.md`.

See [Run Protocol and Durable Goals](run-protocol.md),
[Sessions](sessions.md), [Provider Resilience](provider-resilience.md), and
[Turn Metrics](metrics.md).

### AdaptOrch and WPL boundary

**Status: Released / opt-in.** Published `omk-adaptorch-wpl` supplies typed packet state, client, adjudication, and
verdict-projection primitives. Its `loop.ts` explicitly excludes end-to-end
`adaptorch_run` dispatch, polling, request assembly, and persistence. The
coding-agent has no production importer that turns those primitives into a
default execution loop; the Correctness Wall remains an explicitly loaded
example extension. The default-off AdaptOrch reasoning bridge currently returns
no advisory hint.

Evidence:

- `packages/adaptorch-wpl/src/loop.ts`
- `packages/adaptorch-wpl/test/loop.test.ts`
- `packages/coding-agent/src/core/adaptorch-bridge.ts`
- `packages/coding-agent/test/suite/regressions/011-reasoning-router-adaptorch-bridge.test.ts`
- `packages/coding-agent/test/suite/regressions/012-reasoning-router-learning-adaptorch-activation.test.ts`

See [AdaptOrch Preview](adaptorch-preview.md) and
[Correctness Wall](correctness-wall.md).

### Repository understanding

**Status: Working tree.** The `v0.97.0` release shipped policy/workflow only and
still ignored `/openwiki/` and contained neither the corpus nor its checker.
Neither the release tag nor the current Git index tracks `openwiki/` or
`.understand-anything/`; both datasets are untracked or ignored advisory state.
The current `.last-update.json` says `interrupted` at current HEAD.

`scripts/check-openwiki.mjs` validates entry pages, internal links, update-state
shape, and global symbol-name presence in a source/test/script haystack. It does
not validate prose or bind each symbol to a declared source path. A current-HEAD
`interrupted` generation warns; a stale interrupted generation blocks. Source
and tests outrank every generated page. There is no dedicated checker test in
the current working tree; the executable checker is the available evidence.

This is not a release-grade trust gate: the current corpus is `interrupted`,
symbol checks are global substrings rather than declared source bindings, and
the generation workflow still needs an output allowlist plus pre-upload secret
and private-path scans. Do not load the corpus as trusted context until those
blockers close.

## Direction

**Status: Proposed.** Owning specification:
`specs/015-runtime-algorithm-direction/spec.md`. This section creates no runtime
or test evidence; the internal mechanisms above do not satisfy these promotion
gates. Apply them in order:

1. **Measure before promoting authority.** Run dated, same-model, same-provider,
   same-task comparisons before changing defaults or making leadership claims.
   The protocol in [Turn Metrics](metrics.md) is mandatory.
2. **Reduce structure before adding mechanisms.** Do not raise module-size,
   dependency-tree, or import-cycle baselines. The dependency-tree and import-
   cycle gates are working-tree changes. Split large session and interactive
   modules by ownership; do not mix movement-only refactors with behavior.
3. **Promote live authority in stages.** Collect resource observations before
   making `adaptive` the default. Wire subagent lanes before exposing automatic
   sharding. Keep automatic sharding opt-in and limited to known, semantically
   equivalent command families.
4. **Protect standing context.** The relevance floor and explicit-rule
   compaction slice are Worktree-only. Broader natural-language, hook, and branch
   triage still require evidence before expansion.
5. **Design verified memory before implementing it.** Spec 019 requires
   evidence-linked admission, Context Budget V2 data-only injection, source-span
   provenance, staleness, and memory-injection probes. Implementation remains
   blocked until fixtures and evaluation thresholds are preregistered.
6. **Keep adaptation evidence-gated.** Do not add online router learning while
   the current instrument cannot show gain after `BIAS_STRONG_THRESHOLD=5`.
   Reopen only through an `advance` spec that preregisters the real outcome-
   linked sample, sample size, minimum effect, confidence rule, and statistical
   test before collecting the promotion result.
7. **Keep hosted advice separate from local authority.** AdaptOrch remains a
   separate service and any bridge remains advisory; local deterministic gates
   own execution and completion.

## Deliberate non-goals

- Calling a level-barrier schedule an eager critical-path executor
- Treating internal lane or shard code as a live feature
- Auto-sharding arbitrary shell, deploy, publish, release, or migration commands
- Treating model narration, reviewer opinion, or a digest alone as completion
- Persisting unrestricted prompts or trajectories as learning memory
- Claiming SOTA from tests, feature counts, self-scores, or roadmap projections

## Verification map

| Claim | Fast verification |
| --- | --- |
| Documentation links resolve | `npm run check:doc-links` |
| Specification governance holds | `npm run check:constitution` |
| Context selection behavior | focused context-budget tests named above |
| Router behavior and promotion ceiling | focused reasoning-router tests named above |
| Tool scheduling and timeout candidate | focused `packages/agent` scheduler/timeout tests |
| Resource and internal execution mechanisms | focused resource, lane, and shard tests named above |

A green focused test proves only its declared behavior. Release readiness still
requires the repository's full release gates.
