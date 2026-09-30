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
| Final context-input admission | yes | `AgentSession.prompt()` pre-dispatch | default when model window is known | admission, compaction, property tests | working tree | not measured |
| Tier floor reservation | yes | context-budget-v2 planner | when V2 enabled | `context-budget-v2-tier-floor` tests | working tree | not measured |
| Reasoning router v4 | yes | `/think auto` lane | opt-in | router tests | released | classification only, not success-probability calibration |
| Workload permit pool | yes | resource admission | default | pool tests | released | not measured |
| Provider retry/failover classification | yes | `provider-retry`, `session-failure-cause` | default | resilience/classification tests | released | not measured |
| MCP descriptor injection screen | yes | `mcp/manager` import path | default | quarantine tests | released | pattern rule score, not calibrated risk |
| verified-run coordinator + evidence | yes | verified-run paths | opt-in command | coordinator/evidence tests | working tree | scope-limited binding, not general correctness |
| Atomic commit planner (`planAtomicCommits`) | yes | public agent API only; no live commit caller | explicit function call | local planner/API/property tests, not a CI receipt | working tree | not measured |
| B12 measurement core (`evaluatePromotion`, `attributePhases`, `costPerVerifiedCompletion`) | yes | **no** — no caller; offline evaluation only | n/a | unit and property tests, local oracle cross-check | working tree | n/a (measurement instrument) |

Named tests are evidence locations, not a claim that this exact working tree passed remote CI. Source call paths and fresh local results must be checked before promoting a gate.

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

## Deferred claim freshness and cancelled memo requests (2026-09-22)

The live path is `agentLoop` → `schedulePlannedDagFrontier` → `runDagFrontier`.
A deferred call retains its prepared arguments and one-time authorization, and
admission always re-resolves its claims: a cached resolution that survived the
wait could execute a stale scope (A holds X, B defers on X, C starts on Z, and
after A settles B runs on Z using the cached X claim). Re-resolution preserves
conflict exclusion against both earlier pending calls and later running calls,
and stays abort-bound, so a late claim result cannot admit an aborted call.

The cached resolution is still reused for one thing — proving the deferral.
A deferral decision is only "wait", so a stale conflict answer executes nothing,
while re-invoking an extension `resourceClaims()` callback on every scan of the
wait paid real I/O for the same answer. The resolver-budget regression shows a
deferred call blocked behind a slow peer invoking the callback 5 times when the
answer was re-resolved per scan, and 3 times with the split: the scheduling
resolution, one conflict-proving resolution, and the fresh resolution required
before admission. Claim callbacks may still run again after a wait, so they must
not be used as authorization side effects.

The per-run schedule memo checks cancellation before inspecting arguments or
serializing its key, including warm-cache requests. An already-aborted request
returns no plan and does not promote cache recency.

`assignDagDependencies` also returns an empty-edge graph directly when every
resolution is read-only (including empty claims). In the 128-entry regression,
resolved-entry visits fell from 16,256 to 128 with the same dependency graph.
That was the Phase 1 read-aware scan; the Phase 2 candidate index below now
supersedes its live caller for mixed batches while retaining the same final
conflict predicate. This is an operation-count result for the Phase 1 fixture,
not measured end-to-end latency, model quality, CI certification or a release claim.

Coverage: `tool-dag-deferred-refresh.test.ts`,
`tool-dag-deferred-resolver-budget.test.ts`,
`tool-dag-memo-cancellation.test.ts`, and
`tool-dag-readonly-dependencies.test.ts` in `packages/agent/test/`.
The separate `planAtomicCommits` export remains a pure public API,
not a live automatic commit coordinator. ECRAF and automatic shards
are not activated by these changes.

## Indexed dependency candidates (2026-09-24 working tree)

`assignDagDependencies` now asks `buildIndexedDagDependencies()` for possible
predecessors, then applies the existing `resolutionsConflict` predicate to every
candidate. A POSIX path trie, inode map and kind/key map narrow comparisons;
ambiguous paths use broad buckets. On index membership exhaustion it discards
the partial graph and recomputes from the original pairwise oracle. The all-read
fast path and source-directed edges remain. The earlier read-aware helper stays
in the working tree, but the indexed caller replaces it. Seeded in-repository
parity tests use the real claim predicate. The ZIP's 4,096 independent-writer
fixture reported 8,386,560 to 0 predicate calls; this is not whole-loop p95 or
proof of speed on a dense graph. ECRAF remains outside the live frontier.

## Frontier-only claim memo (2026-09-25 working tree)

The live ready frontier previously computed compatibility barrier levels and an
indexed dependency graph for the same resolved claims, then flattened the
levels before sorting pending work back into source order. It now memoizes
claim entries in a separate 64-entry cache and builds only the dependency
graph. The public `scheduleDagLevels()` and `scheduleDagLevelsMemo()` still
produce identical compatibility levels with their own cache. Both paths
preserve early cancellation, dynamic-claim cache bypass and nested claim
isolation; the live frontier still re-resolves final post-hook claims and owns
all started work. A synthetic independent-path run on this host confirmed
fewer schedule-function CPU milliseconds; that is not an end-to-end latency,
provider-quality or release claim. Source-ordered result cleanup also uses a
single finalized-call ID map instead of rescanning the outcome array for each
tool result. The transcript gate already rejects duplicate IDs, and the map
retains source-order message emission and one `commitTerminal` callback per
result. Coverage: `tool-dag-frontier-memo.test.ts`,
`tool-dag-hook-replan.test.ts`, `tool-terminal-index.test.ts` and
`tool-dag-ready-frontier.test.ts`.

## Reachability-preserving frontier reduction (2026-09-25 working tree)

The live frontier now applies `reduceDagDependencies()` after the authoritative
conflict graph is built. The public `assignDagDependencies()` contract still
returns every conflicting edge, but the ready queue consumes the DAG's unique
transitive reduction. Reverse-topological bitset closures preserve every
source-to-descendant reachability path while removing redundant successor
bookkeeping. Inputs must be canonical: unique ascending predecessors strictly
earlier than their target.

On the real 512-writer same-path conflict graph, 130,816 conflict edges reduce
to a 511-edge chain. The local median for the reducer alone was 33.21 ms over
five runs; graph construction, frontier scans, I/O and provider latency are not
included. This is a structural result, not an end-to-end speedup. Coverage:
`tool-dag-reduction.test.ts` checks a complete DAG, a diamond, malformed input,
idempotence, 2,000 seeded random DAGs and the real 512-writer graph.

Research basis, at abstract level:

- Ioannidis, Ramakrishnan and Winger, *Transitive closure algorithms based on
  graph traversal* (1993), <https://doi.org/10.1145/155271.155273>, supports
  reverse-topological descendant-set construction and marking redundant arcs.
- Kwok and Ahmad, *Static scheduling algorithms for allocating directed task
  graphs to multiprocessors* (1999),
  <https://doi.org/10.1145/344588.344618>, establishes directed task graphs
  and the heuristic boundary; it does not validate this conflict predicate.
- Adam, Chandy and Dickson, *A comparison of list schedules for parallel
  processing systems* (1974), <https://doi.org/10.1145/361604.361619>, is
  supporting precedence-schedule evidence, not a proof of OMK latency.

Prompt compression, learned routing/cascades and verifier loops were not wired
from their abstracts alone. LLMLingua
(<https://doi.org/10.18653/v1/2023.emnlp-main.825>), RouteLLM
(<https://arxiv.org/abs/2406.18665>), FrugalGPT
(<https://arxiv.org/abs/2305.05176>), CRITIC
(<https://arxiv.org/abs/2305.11738>) and CP-Router
(<https://doi.org/10.1609/aaai.v40i39.40589>) each require task-quality,
preference, cost or external-feedback evidence not present in the current
harness. ArXiv API/search retrieval was unavailable to this run, OpenAlex
provided the source records, one of eight isolated paper reads completed and
seven timed out. This section is a bounded design record, not a systematic
review or a claim that the selected reducer is state of the art.

## Final context-input admission (2026-09-25 working tree)

System-prompt budgeting protects the base prompt, context files and skills, but
it does not independently account for the complete provider request. A first
turn has no prior provider usage, and `before_agent_start` may replace the
bounded system prompt after the planner runs. The live `AgentSession.prompt()`
path now performs a final local admission check after projected compaction and
before `preflightResult(true)` or `Agent.prompt()`.

`computeHardPromptInputLimit()` caps the soft planner's 4,000-token floor at the
physical model window after response reserve and safety margin.
`estimateContextInputTokens()` counts the current system prompt, messages after
the same `convertToLlm()` transformation used by the agent, and serialized tool
schemas through the configured tokenizer. The estimate is the maximum of local
counting, the existing chars/image heuristic, and provider-reported projected
usage. Base64 image bytes are replaced by an explicit image marker, so huge
image data is not tokenized as English text. `PromptInputCapacityError` reports
counts only, contains no prompt content, maps to
`provider.context_overflow`, and records `sideEffects: none` before provider
dispatch.

Coverage is in `context-input-admission.test.ts` and
`agent-session-input-admission.test.ts`: the soft-floor cap, exact boundary,
2,000 seeded limit shapes, CJK text, image payload bounding, provider-usage
lower bounds, circular-argument rejection, oversized first turns, extension
system-prompt growth, and an ordinary admitted request. The pre-prompt
compaction regression now uses a feasible 4,000-token fixture and proves
compaction occurs without an automatic `continue()` call.

Research basis is bounded to fetched abstracts and implementation borrowing, not
a systematic review. *Characterizing Prompt Compression Methods for Long Context
Inference* (arXiv:2407.08892) motivates keeping compression quality separate
from a final capacity check. *Prompt Compression for Large Language Models: A
Survey* (arXiv:2410.12388) supports an explicit post-compression budget stage.
MemGPT (arXiv:2310.08560) supports bounded context tiers and interrupts but does
not supply token accounting. LLMLingua-2 (arXiv:2403.12968) is not wired
because learned compression needs calibration and quality evidence absent here.

This gate is a conservative local admission layer, not an exact proof for every
provider chat template or image tokenizer. Unknown model windows are not
enforced, fallback token counts remain estimates, and the change makes no
end-to-end latency, cost, quality, release-readiness or live-provider claim.

## Tool-schema fit reuse and recount (2026-09-28 working tree)

`fitToolSchemas` withholds whole MCP servers until the request's tool schemas
fit the budget. It previously subtracted each withheld server's standalone cost
from the total, but the request wrapper and tokenizer merges make group costs
non-additive, so it could stop with the remaining schemas still over budget.
`exactToolFit` now withholds the shortest ranked prefix of servers whose
recounted projection fits: standalone costs less the empty request's cost only
estimate the prefix, recounts correct it, and one more recount confirms that one
server fewer overflows. Ungrouped tools are never withheld; an impossible budget
returns them and the input ceiling decides the rejection.

`SessionTurnAdmission` reuses a fit only while a SHA-256 key over the provider,
model id (kept apart: a joined `provider/id` is ambiguous), window, ceiling,
compaction settings, full system prompt, serialized schemas, tool-to-server
mapping, counter id and admitted-counter epoch is unchanged. The previous key
used the prompt's length and the tool names, so a same-length prompt, a schema
that grew under the same tool name, a changed server mapping or a new counter
reporting the same id (every registry mix reports one id) kept a stale
selection; a stale selection could reject a turn as
`configuration.invalid` although withholding a server would have admitted it.
Each admitted counter refits once per turn. A synthetic probe (fallback
counter, 60 KB system prompt, three runs) measured the cost: with 220 tools
(about 400 KB of schemas) that fit, about 1 ms per cached call and 11–15 ms
more per turn than before; with 420 tools (about 800 KB) of which 20 of 40
servers are withheld, 82–92 ms per turn against 14–16 ms before, and 263–284 ms
with one recount per withheld server. These are costs, not speedups.

Coverage: `tool-schema-budget.test.ts`, `session-turn-admission.test.ts`,
`exact-tool-fit.test.ts` and the public-path case in
`agent-session-input-admission.test.ts`. `exactToolFit` also accepts
host-trusted `pinnedGroups` and `utilityOfGroup`; nothing in the runtime passes
them yet. `exact-tool-fit.property.test.ts` checks, for 1,000 seeded fast-check
cases each, that with any counter, monotone or not, the fit ends within
2|G|+3 counts for G unpinned servers, reports a recounted cost, withholds a
ranked prefix, reports overflow only after withholding every unpinned server, and
that one server fewer overflows. Monotone counters (additive, a serialized
`ceil(length / 4)` and a superadditive one that makes the recount correct the
estimate downward) also get the shortest fitting prefix. A non-monotone counter
can report overflow although a shorter prefix fits. The runtime fallback
estimator is not monotone either (its code-like multiplier depends on the whole
projection's character mix), so only the general invariants apply to it.

## Bounded context-budget cache stores (2026-09-28 working tree)

The Context Budget V2 memory and disk providers bound each in-process store by
entry count and by accounted bytes (`2 × key + 2 × JSON + 128` UTF-16 code
units per entry) and keep entries as immutable JSON: reads return a fresh copy,
and a value that is not plain JSON data (an accessor, a `toJSON`, a proxy, a
cycle, a class instance including an `Array` subclass, a non-finite number or a
sparse array) is a miss. Encoding reads each data property once and runs no
caller code, so the stored text is what was validated. Defaults are 8 MiB
representations, 2 MiB plans and 256 KiB negatives in the session provider and
16 MiB, 4 MiB and 512 KiB resident in the disk provider, whose 32 MiB snapshot
cap is separate. One plan may fill its store; one representation is capped at
2 MiB and one negative entry at 16 KiB. These caps bound retained cache
strings, not process RSS. An oversized snapshot shrinks iteratively: the oldest
half of the persisted representations goes first, and negatives shrink only once
none remain, so an overflow of negative entries alone converges. Entries the
snapshot cannot hold (credential-shaped or over `maxEntryTextLength`) stay in
memory. Limits that are not safe integers (`NaN`, `Infinity`, fractions) throw
`RangeError`.

Coverage: `bounded-json-lru.test.ts`, `context-budget-v2-cache-provider.test.ts`
and `context-budget-cache-disk.test.ts`. The providers expose
`getMemoryUsageSnapshot()` for instrumentation; nothing in the runtime reads it
yet.

## Retry backoff at the timer limit (2026-09-28 working tree)

Two retry loops read `retry.baseDelayMs`: the agent-turn retry
(`computeRetryDelayMs`) and the compaction and branch-summary retry
(`retryAssistantCall` in `omk-ai`). Both doubled the base once per attempt with
no ceiling, and Node fires a timer longer than 2,147,483,647 ms after 1 ms. A
base of 3,000,000,000 ms therefore retried after about 1 ms. The default 2 s base
reaches the limit only at attempt 22, after about 48.5 days of earlier waits and
with `retry.maxRetries` raised from its default 3. Both loops now compute the
same-model backoff as `min(2^31 - 1, base * 2^(attempt - 1))`: for a base that
converts to a non-negative number, every result below the cap, including
out-of-contract attempts, matches the old arithmetic, and the backoff never
decreases as attempts grow. The agent-turn loop still waits
at most a run budget's `remainingMs`, and 400 ms after a failover. The base
converts as the old arithmetic did; `+Infinity` (JSON's `1e400`) takes the cap,
and a base that converts to NaN or a negative number uses the documented 2 s. A
retry count that converts to NaN now means no retries in both loops:
`attempt > maxRetries` and `attempt >= maxAttempts` are never true for NaN, so
those retries did not stop.

`retryAssistantCall` keeps one timer, which the cap makes safe, and now removes
its abort listener when the backoff ends; an abort during the backoff still
returns an aborted message. The provider layer's `sleepProviderRetry` was not
reused: it re-arms from `performance.now()`, which never advances under fake
timers that leave the clock alone. The coding-agent `sleep` re-arms in
timer-sized chunks, waits one tick for a negative or NaN delay without Node's
warning, and removes its abort listener. The agent-turn retry never reaches
that re-arm: its delay is capped, and a run budget's `remainingMs` is at most
2,147,483,647 ms. The rule is implemented once per package, because coding-agent
tests resolve `omk-ai` to its build output and a new cross-package export would
fail them until the next build.

The ceiling is the timer limit, not a retry policy. A lower default, such as the
provider layer's 60 s cap on server-requested delays, would change every
configuration with six or more retries at the default 2 s base. It would also need
a new setting name, because `retry.maxDelayMs` is the legacy key migrated to
`retry.provider.maxRetryDelayMs`. There is still no jitter. Coverage:
`provider-retry.test.ts` (fast-check against an exact `BigInt` oracle and the old
arithmetic), `sleep.test.ts`, `retry-backoff-limit.test.ts` in
`packages/ai/test/`, and the public-path cases in
`suite/agent-session-retry-events.test.ts` and
`suite/regressions/6647-compaction-retries-transient-stream-drop.test.ts`. The
compaction case runs `retryAssistantCall` from `packages/ai`'s build output, so it
needs a current build, which CI makes before its tests.

## DAG claim memo byte budget (2026-09-28 working tree)

The per-run frontier and barrier-level schedule memos were bounded only by 64
entries. Their keys serialize every call's arguments, file contents included, so
64 batches that each wrote 256 KiB retained 16,782,198 key characters. Each
cache now also keeps at most 4 MiB of accounted text (two bytes per UTF-16 code
unit of key and JSON value, plus 128 per entry), evicting the least recently
used batch, and schedules a batch whose entry would exceed 512 KiB without
retaining it; a batch whose key alone exceeds that skips the lookup too. Hits
still return isolated copies, and batches with dynamic claims still bypass the
memo. The budget bounds retained strings, not process RSS.
Coverage: `tool-dag-memo-bytes.test.ts` and the existing memo tests in
`packages/agent/test/`.

## OMK_MATH 924820e audit status (2026-09-28)

The math bundle `OMK_MATH_924820e` audits commit 924820e. The 19 source blobs it
records match that commit; its documentation source records none. Since then,
3f4954a0dd changed `tool-schema-budget.ts` and `session-turn-admission.ts`, and
this change edits `tool-dag-memo.ts` and `provider-retry.ts`; the other cited
code sources and `package.json` are unchanged. Its twelve algorithm
modules are proposals backed by synthetic checks, with no runtime measurement.
Status in this tree:

- Implemented: A01 and A02 by the tool-schema fit reuse and recount above (the
  fit key is a SHA-256 of the canonical encoding, not a byte comparison), A09 by
  the memo byte budget, and the timer-limit part of A11 in both retry loops,
  including `retryAssistantCall`, which the bundle does not cite. A02's dependency
  closure, protected groups and switching-cost utility are not wired, because no
  calibrated utility exists.
- Recomputed exactly, without a mismatch: the A02 schema witness through the
  real serializer, 7,381 exhaustive and 2,000 random key-epoch graphs (A06),
  the closure word count for 20,000 sizes (A14), 3,000 capped retry delays
  (A11) and 1,000 density rescalings (A12). A13's time-uniform radius and
  adjusted p-values equal AdaptOrch's `hoeffding_radius` at
  `alpha / (J n (n + 1))` in 9,000 and 8,000 cases. Evaluated in floating point,
  A03's rank index `ceil((n + 1)(1 - alpha))` differs from the exact value in 324
  of 4,000 cases, so a calibrated admission must compute it in integers.
- Not implemented: A03 (no calibration pairs, and only admitted requests would
  supply them), A04 (no semantic-equivalence check for compaction candidates),
  A05 (no additive cost bound on the context planner), A06 (a key gate must
  first exclude path prefixes, aliases and exclusive claims), A07 (needs a
  trace-parity harness first), A08 (no purity certificates), A10 (conflicts
  with the permit pool's strict FIFO rule), the rest of A11 (jitter and a lower
  ceiling change timing), A12 live wiring (`challengeEcrafLocalExchange` already
  finds the bundle's 10 to 16 packing offline) and A13 (no paired runtime
  runs).

## OMK_MATH f46a8f6 audit status and B12 measurement core (2026-09-29 working tree)

The bundle `OMK_MATH_f46a8f6` audits commit f46a8f6 and is now at r2, which adds
explanations. Its twelve modules B01–B12 are proposals backed by synthetic
checks; the bundle implements none of them and orders B12 before B01, B03 and
B07 (`B12 ≺ {B01, B03, B07}`). All 16 source blobs r2 records match that
commit, so the bundle's rebind rule asks for no module re-audit. In this
working tree only S1 (this file, edited here) and S14 (`package-lock.json`,
another task's edit) differ; the other 14 match. Against the first edition the
B02–B06 and B11 formulas are unchanged and those of B01, B07–B10 and B12
changed: B12 adds the length measure μ([a, b)) = b − a and the cost per
verified completion C_verified.
The first pass recomputed, without a mismatch, B04's reduction on all 1,100
source-ordered DAGs up to five nodes and 2,000 random ones (own seed, not the
bundle's generator), the closure word count for 20,001 sizes, B02's certified
binary search over the 119 monotone vectors among its 3,279 prefix cost vectors,
and the B02, B04, B06 and B10 fixtures; the r2 pass did not repeat that. Rerun
here, the bundle's `verify_math.py` matches its shipped `VALIDATION.json` (15
check groups, no mismatch), and its `verify_microtasks.mjs` on Node v24.19.0
(the repository requires >= 22.19.0) gives FIFO order [B, A] but `Promise.race`
winner A. That refutes only the naive swap and does not show any other
replacement equivalent, so B06 stays on hold.

This change implements B12's arithmetic as pure functions in
`core/performance-upgrade/`. Nothing calls them yet and no default changes:

- `parseMeasurementSpan` reads one JSONL trace line into the eight B12 trace
  fields and drops every other field. Ids and count names must be short tokens,
  which keeps prompt text out of them; a token-shaped secret such as an API key
  would still fit, so trace writers must not put secrets in ids.
- `attributePhases` splits a turn window over twelve phases so the phase times
  add up to the turn exactly (ticks are safe integers). The bundle takes
  breakpoints from span endpoints outside the window too; spans at [95, 130)
  and [140, 210) over the window [100, 200) then sum to 115 ticks for a
  100-tick turn, so endpoints are clipped to the window first. Where spans
  overlap, the deepest one gets the time, then the one ending last. The bundle
  leaves that rule open.
- `anytime-bounds.ts` holds the time-uniform Hoeffding interval and one-sided
  p-value at alpha / (J n (n + 1)), the zero-failure bound and the DKW quantile
  band. `compensatedSum` is factored out of `compensatedMean`, behavior unchanged.
- `evaluatePromotion` scores paired baseline/candidate blocks and returns
  `promote`, `harm` or `noDecision`. The bundle does not define its
  `harmEstablished`; here it means an upper bound below zero for latency, or
  below the negative margin for success or false completion.
- `costPerVerifiedCompletion` (`verified-cost.ts`) computes r2's C_verified: the
  `compensatedSum` of all attempt costs of all blocks, unverified blocks and
  failed or retried attempts included, over the number of independently verified
  blocks, or +Infinity (not NaN) when none is. Verification does not prove a
  block correct. It throws `MeasurementInputError` on non-string or duplicate
  ids, non-boolean flags, attempt lists that are not arrays or report a length
  that is not a count, negative or non-finite costs, verified blocks without
  attempts and an overflowing total (the compensated sum yields NaN or
  ±Infinity there). It reads each attempt list's length once and each index once
  and calls none of its methods, so a getter, a proxy or an own `slice` cannot
  change a validated value.

The bounds hold only for i.i.d. blocks and they are wide: at alpha = 1/20 and
J = 8 the radius is 0.917 at n = 30 and 0.198 at n = 1,000, so even a
noise-free gain of 10% of the cap needs about 4,500 paired blocks before its
lower bound clears zero. There are no paired runtime runs yet, so this change
claims no speedup and B01–B11 stay unimplemented.
Acceptance for any of them later: paired blocks whose cap, minimum gain and
margins were fixed before the runs, a passing semantic gate, and
`evaluatePromotion` returning `promote`. Until then the module stays off.

Apart from C_verified, the r2 corrections change no code here. B08's
internal-ticket node key and B10's reserve for mandatory verification and saving
alter policy and data structures, so both are recorded as on hold.
`WorkloadPermitPool.setCapacity` and its test already pin B09's shrink rule:
running permits are never revoked and a new grant needs active + weight ≤
capacity. B01 and B07 gain scope conditions only.

Cost, re-measured twice on 2026-09-29 on a loaded development machine (load
average 13 to 16; not a benchmark, and runs differ by up to 2x):
`attributePhases` takes about 20 to 30 ms for 10,000 spans shaped like a real
turn (median of 7), but it is O(|V|^2) when most spans are open at once, about
8.5 s for 10,000 fully nested spans (one run). `evaluatePromotion` takes about
95 to 135 ms for 100,000 blocks (median of 7). Evaluate at checkpoints rather
than after every block: any checkpoint schedule
keeps the bounds' anytime validity under their i.i.d. assumption, while
re-evaluating after each of N blocks costs O(N^2 log N) in total.

Coverage: 184 tests pass locally, up from 133: `measurement-trace.test.ts` 35,
`phase-attribution.test.ts` 26, `phase-attribution.property.test.ts` 2 (1,000
fast-check cases against a tick-by-tick oracle), `anytime-bounds.test.ts` 40,
`promotion-gate.test.ts` 34 and `verified-cost.test.ts` 47. A first local
cross-check, made in the first implementation pass with a script that was not
kept, against AdaptOrch's research kernel (`hoeffding_radius`,
`hoeffding_interval`, `standardized_effect`) plus stdlib reference formulas,
judged by its `expected_answer_numeric` verifier at a relative and absolute
tolerance of 1e-12, matched 9,495 of 9,495 values and all 136 undefined results
over 830 seeded cases. Identical block differences, which the random cases
never produced, gave d_z near 1e16 instead of undefined. A self-review caught
it; the fix has a regression test, and 150 such cases run in the second
cross-check below. Review then found that ranking overlaps by clipped ends let
the window change who owns an overlap, and that a string, `null` or a getter
could pass validation and still change the result; overlaps are now ranked by
real ends, inputs are type-checked and each object field is read once. Arrays
are still read in place
in the bounds and in `attributePhases`, so an array with element getters or an
own `map` can change a value after validation (a getter made `anytimeMeanBound`
validate 0.5 and sum 1e9); only `verified-cost.ts` snapshots its arrays. Parsed
JSONL is plain data and cannot do this. In that pass each of 45 hand-written
mutations of the first four modules, including its documented limits, failed at
least one test; that count was not re-run. In the r2 pass all
19 hand-written mutations of `verified-cost.ts` fail at least one test.

A second, larger run (harness outside the repository) compared 152,906 values in
11 main report rows (radius and zero-failure bound up to n = 1e6, mean intervals
and p-values up to n = 199, quantile bands up to n = 300): no mismatch, 907
boundary ties set aside and 833 ⊥ or ∞ results agree. A strict verifier (abs_tol
0) accepts all 102,020 values it covers and carries the claim: after a relative
1e-9 perturbation,
`NumericToleranceVerifier` at abs_tol 1e-12 still passes 5,114 of 108,831 values
(all of magnitude ≤ 1e-3), the strict one 0 of 102,020. All 12 hand-made TS
mutations fail at least one verifier. When |d_z| ≥ 1e7, TS and the oracle both
drift about 1e-7 relative (error ≈ ε·|d_z|), a conditioning limit not
attributed to either side and kept out of the 11 rows. Fingerprints of the final
code, 6a79e013441c25c2 (cases), eb0210a2075700e1 (ts_out) and c079741c1c5941f4
(report), reproduced in a second run; the last two cover the sha256 of the five
TS files, so any edit to them changes both. The oracles come from AdaptOrch
d0eb6ed9b plus other tasks' uncommitted edits to `evidence_stopping_index` and a
failure classifier, which leave the oracle and verifier functions unchanged.
AdaptOrch was only a local numeric reference, not a product capability claim.
The reference formulas belong to the same family as the code's: only the
Hoeffding radius, the mean interval and d_z come from AdaptOrch, and the rest
are exact restatements of the bundle's formulas. The run therefore shows that
the code matches those formulas on seeded cases, not that the formulas are
right, and it leaves input validation (three overflow cases aside) and the
`attributePhases` partition to the unit tests. None of this is a CI result, a
correctness proof or a coverage guarantee under i.i.d. blocks.

Remote CI fails for reasons outside this work. Its last run before this change,
36414383318 on f46a8f6922, fails 9 tests in the Test step; all 9 also fail on a
clean f46a8f6922 snapshot (four of them, the session-replacement regressions,
through source aliases because the snapshot had no build output), and 8
consecutive runs have failed. The B12 files were not in that CI tree. Whether a
code defect or a stale test expectation causes it is undecided.

## Reasoning router resolver contract (2026-09-19 audit F05/F06)

The low-confidence escalation in `resolveThinkingLevelV4WithUncertainty` is
monotone at a fixed bias and hint only; it is not a floor at the class base
level, because a negative learning bias is applied before the +1 step (`debug`
with `bias=-2` still resolves to `medium`). The docstring previously claimed the
stronger floor. A policy that must never drop below the base level needs an
explicit safety floor, which is a cost decision not taken here. The shared
resolver also normalizes `bias` and `escalationSteps` to finite integers
(non-finite → 0, fractions truncated toward zero) so a corrupted value keeps the
class's own level instead of walking the ladder lookup off its rungs to the
lowest available level; the session's bias-snapshot validator already rejects
such values before they reach the resolver. Coverage:
`packages/coding-agent/test/reasoning-router-resolver-contract.test.ts`.

## Working-tree shared run budgets

The SDK `prompt(..., { runBudget })` path now shares a monotonic deadline and
logical request/concurrency limits across the active prompt's main stream,
retries, continuations, and first-party summaries using that stream. Exhaustion
is a non-retryable `budget_exhausted` termination; snapshots keep outstanding
streams until terminal metadata arrives. No request/time budget is imposed by
default. Even unbounded prompts now own their stream reservations until terminal
metadata; unresolved streams block a later prompt after their scope closes.
See [Shared run budgets](sdk.md#shared-run-budgets-sdk-limits-opt-in-stream-ownership-always-active) for units, zero
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

The live executor uses a ready frontier, not level barriers.
`assignDagDependencies()` computes the predecessor graph and the loop feeds it
to `runDagFrontier()`, which admits a node as soon as its predecessors settle
and a resident slot frees up. Each candidate is still authorized and
re-planned from post-hook arguments before execution.

Evidence:

- `packages/agent/src/tool-dag-scheduler.ts`: `assignDagLevels`,
  `assignDagDependencies`, `scheduleDagLevels`
- `packages/agent/src/agent-loop.ts`: `executeToolCallsDagLevels`,
  `runDagFrontier` (predecessor-settle ready queue; the former
  `runDagLevelCalls` level barrier was replaced)
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
   `density -> effectiveScore -> priorityRank -> fullTokens -> id`;
6. selects a full, summary, headroom-compressed, pointer, or omitted
   representation that fits (floor pass per tier, then the global pass);
7. lets each still-omitted item buy its cheapest admissible form by stepping
   selected items down to theirs, applied all-or-nothing; and
8. re-offers each remaining item its costlier representations against the
   leftover budget and promotes only when the selection policy prefers the
   costlier form and it fits both the tier ceiling and the global remainder
   (`context-budget-v2-global-pass.ts`; never touches hard items).

Breadth is settled before quality: step 7 runs before step 8, so an exchange
that admits another item cannot be undone by a promotion.

When V2 is enabled, system-prompt assembly now refuses a resource plan whose
required hard items exceed the tokens available to resources, before sending
the prompt to a provider. It raises `context_budget.hard_pin_over_capacity`
with counts, not source text. Optional items that do not fit still produce the
existing omission diagnostics. This is a hard-resource admission guard, not a
proof that provider-side total prompt tokens, including the base prompt and
metadata, fit the model's actual context window.

Density divides effective score by the cheapest non-omit representation
(`admissibleTokens`), not by full-text size. This avoids penalizing an item that
can be represented by a small evidence pointer. Stable item IDs and selection
policy `sel-4-codeunit` keep ranking, exchange, selected-item output, and
cache/plan hashes independent of host locale. The policy token invalidates older
locale-dependent plan-cache entries without renaming the public optimizer.

### Representation cost accounting (2026-09-19 audit F01/F03)

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

### Representation exchange (2026-09-19 audit F04)

Items are ranked by their cheapest admissible representation but admitted at
whatever the selector prefers, so a high-priority item priced at 10 for ordering
could consume 100 and displace two 45-token items. On the audit's counterexample
that scored 121 against 169.5 for `A-pointer + B-full + C-full` at the same 100
tokens, measured with the selector's own preference score.

The repair is bounded. After the global pass, each still-omitted item in rank
order may pay for its admission by stepping already-selected items down to their
cheapest admissible representation. Donors yield in order of the preference the
policy loses per token freed, the whole exchange is applied or none of it is,
and a donor is skipped when stepping it down would drop its tier below the floor
it is currently honouring. An item admitted this way leaves the omitted list, so
it is never reported as both included and omitted.

This is not joint `(item, representation)` optimization: donor choice is greedy
and admission order is unchanged, so the planner can still trail a brute-force
oracle on instances the bounded repair cannot reach. It does reach the oracle on
the audit counterexample, and a 200-instance randomized property check holds
feasibility (global and tier caps), disjoint included/omitted sets, and
maximality: no omitted item still fits at its cheapest admissible form.

The quality-policy field `preferFullForHighPriority` is deprecated: nothing
reads it, and flipping it changes no candidate or choice
(`context-budget-quality-policy-semantics.test.ts`). The priority weight already
prefers full text for high-priority items.

Evidence:

- `packages/coding-agent/test/context-budget-representation-accounting.test.ts`
- `packages/coding-agent/test/context-budget-representation-exchange.test.ts`
- `packages/coding-agent/test/context-budget-representation-promotion.test.ts`
- `packages/coding-agent/test/context-budget-quality-policy-semantics.test.ts`

When enabled, representation and negative-result entries persist under
`.omk/cache/context-budget-v2`; plan entries remain session-memory-only.
`OMK_CONTEXT_GOVERNOR_CACHE=memory` keeps every cache entry in session memory,
and `OMK_CONTEXT_GOVERNOR_CACHE_DIR` relocates the representation snapshot.

Cache keys are bound to the counter that produced the prices. Two of the three
layers bind it implicitly — a plan key hashes each planned item's token counts,
and an exact representation key hashes a fingerprint containing
`estimatedTokens` — but the materialized (semantic) key is bucketed at 100
tokens and carries the tokenizer as a field, and no caller passed one, so every
counter shared the static `heuristic-v1` key space and the entry's
`tokenizer_mismatch` check compared that constant against itself. Since F01 made
every representation price counter-dependent, that let one estimator's price be
admitted in another estimator's run. The planner now resolves the key's
tokenizer from the counter's own `adapterId`
(`resolveEffectiveTokenizerIdV2`, probing a non-empty string because
`countText("")` short-circuits to the fallback estimator); an explicit
`tokenizerId` input still wins. Coverage:
`packages/coding-agent/test/context-budget-cache-tokenizer-binding.test.ts`.

The 2026-09-24 working-tree tokenizer boundary also recognizes camelCase and
snake_case model factories, releases factory-created encoders after counting,
and treats generic or fallback encodings as estimates rather than proof of the
model's exact token count. The registry rejects non-finite or unsafe plugin
counts, avoids copying plugin exception text into fallback notes, and uses
code-unit ordering for equal-priority adapter IDs. Its ID is
`token-counter-registry-shape-v2`, so default tokenizer-bound cache keys rotate;
a caller that pins `tokenizerId` must rotate its own namespace. A fake module
covers the documented WASM API shape, not actual WASM heap usage or provider
billing tokens. Coverage: `context-budget-token-counter.test.ts` and
`omk-phase2-runtime-contracts.test.ts`.

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

## C/D lifecycle and progress hardening (2026-09-30)

The C/D feedback bundles audit `f46a8f6`. Their pinned lifecycle, permit,
launcher and stream sources still matched this working tree before these
changes. The bundles are proposals, not patches or runtime performance evidence.

**C03:** `AgentSession.close()` still closes admission synchronously and shares
one close Promise. `SessionShutdown.closeSession()` now attempts every
independent stop callback even if another throws, joins registered producers,
and observes all independent agent/lifecycle/budget/MCP/control joins before
reporting failure. Only successful joins authorize final cleanup. A successful
drain does not erase an earlier stop error: one error is returned unchanged,
multiple errors are retained in `AggregateError`. Control-server close is
requested once, not retried to erase its first rejection. An unconfirmed
physical termination can still leave close pending; no timeout declares success.

CI recovery also separates registered command control frames from prompt/tool
producers. A command-initiated replacement seals its own control frames before
joining other owned work, avoiding a self-join. An ordinary externally stopped
command is still joined, and a command nested under an active prompt/tool cannot
use the exception to release that ancestor. Its closed-budget acknowledgement
never forgives real budget exhaustion. The public new/fork/switch regressions,
`session-command-shutdown.test.ts` and `run-budget-scope.test.ts` cover this.

`SessionPromptLifecycle.flush()` detaches the current owner's idle waiters
before notifying completion. A callback that starts the next prompt and
registers another waiter cannot have that waiter released by the old completion.

**C04:** `retireMcpClient()` coalesces duplicate client requests within an owner's
unfinished epoch. Only a distinct client adds a join; earlier returned Promises
retain their original scope. Membership uses a `WeakSet` and owner epochs a
`WeakMap`. Both identities are published before calling reentrant client code,
and cleanup checks the current epoch and join. Missing or rejected transport
observations still withhold ownership; they are not release evidence.

**D07:** the extension example's governed and legacy graph callers now forward
`onUpdate`. Adaptive and Ultra paths retain attempt/node identity in previews.
Validated text deltas go to a separate, 4,096-UTF-16-code-unit display tail.
The first delta notifies immediately; subsequent deltas coalesce on arrival
with a 100 ms minimum interval, without a timer or notification queue.
Completed messages still notify immediately. Partial snapshots report
`exitCode: -1` and render as progress, never as completion. Abort suppresses
later display callbacks and finish closes the parser. Previews do not enter
messages, usage, checkpoint text, dependency output or completed-node evidence.
The partial graph view shows the currently updated node; final source ordering,
stream limits and process-settlement checks remain unchanged. A follow-up
renderer regression exposed that the initial partial view hid sibling rows and
tool calls. The shared partial renderer now preserves each supplied sibling's
running/completed/failed state and tool-call summary, showing at most five recent
blocks with each text block capped at 4,096 code units. Four render-only tests in
`subagent-progress-render.test.ts` cover this without starting an agent.

The stream's line-limit check now accumulates incoming UTF-8 bytes rather than
rescanning the growing line per fragment. Input strings come from the managed
process's UTF-8 decoder; newline and finish clear the accumulated state.

Synthetic operation counts on identical inputs, not end-to-end speedups:

| Input and metric | Before | After |
| --- | ---: | ---: |
| 1,000 retirements of one client: allocated Promises (`async_hooks`) | 4,998 | 3 |
| Same input: distinct returned joins | 1,000 | 1 |
| Same input: physical close calls | 1 | 1 |
| 8,221-character JSONL in single-character chunks: characters scanned by byte-length checks | 33,804,751 | 16,441 |

The stream digest and event count were identical. This establishes reduced
allocation/retention and scanning for these fixtures, not a long-running RSS
bound or a provider-latency improvement.

Scope decisions for the remaining proposals:

- C01/C05/C07: preserve admission, generation and physical-evidence contracts;
  exercise reentrancy, reconnect and ownership regressions.
- C02/C06: no separate bounded observer facade without evidence of abandoned
  observer accumulation and a real consumer. Existing close semantics remain.
- C08/C09: retain failed/unresolved cases in evaluation; no live paired shutdown
  or weighted critical-path benchmark was run.
- D01/D02/D06/D09: inspect the actual caller and existing ownership boundaries;
  no new telemetry system, warm process pool, duplicate execution or scheduler.
- D03: retain the launch-time width contract. No wider dispatch without runtime
  benefit evidence and a current-authority revalidation design.
- D04/D05: preserve failure barriers, write conflicts and FIFO fairness.
- D08: preserve current deadlines, cleanup reserves and unsettled-child ownership;
  do not silently reinterpret zero or unify different clock contracts.
- D10: operation counts are not product promotion or quality evidence.

Coverage: `session-shutdown-faults.test.ts`, `session-prompt-lifecycle.test.ts`,
`suite/session-shutdown-wiring.test.ts`,
`mcp/transport-retirement-coalescing.test.ts`,
`subagent-stream-progress.test.ts`, `improvement-subagent-stream.test.ts` and
`improvement-subagent-graph.test.ts`, plus existing MCP, lane, permit and actual
child/bash-settlement tests in `packages/coding-agent/test/`. Local AdaptOrch
`CommandVerifier` executes the same offline regression command with caching
disabled and an exit-7 negative control. No model calls, synthesis, delegation
or external uploads are involved; verification is not a correctness proof.

For `pi-web-access` 0.33.0, `"toolActivation": "eager"` in the configuration
file that extension actually reads preserves eager web tools without its
Pi-0.86 compatibility warning. Do not spoof host APIs or suppress all warnings.
The extension uses its own `PI_CODING_AGENT_DIR`/XDG/Pi-default path rules;
configuration and source changes require a module reload or session restart.

## Memory and wait-lifecycle hardening (2026-09-30, bundle `bac246c`)

An external audit bundle pinned to `bac246c` proposed fixes for retained
listeners, unbounded diagnostics and quadratic copies. Four of its target files
had changed since (`c4e20ff`, `8f12f90`), so the fixes were re-applied to this
tree rather than patched in. Each change below has a regression that failed on
the previous source. In this section `n` is the number of drained messages,
`d` the depth of a session branch and `N` the number of accepted journal records.

- **Agent queues:** `PendingMessageQueue` drained one message with `slice(1)`,
  copying n(n−1)/2 references for a burst. A head cursor releases each drained
  slot and compacts only when at least 1,024 slots and half the array are dead.
  FIFO order, mode switches and `all` draining are unchanged; a producer that
  outpaces the consumer still grows the live queue.
- **Branch traversal:** `SessionManager.getBranch()` used `unshift` per ancestor,
  moving d(d−1)/2 references. It now pushes and reverses once. Root-to-leaf order,
  entry identity, the selected fork and the defensive copy are unchanged.
- **Run journal:** `RunJournal` no longer copies its full record array on every
  append; `records` materialises a frozen snapshot on read and reuses it until
  the next append. Earlier snapshots keep their prefix. A memory-only
  `RunJournalStore` appends to its accepted journal directly, which is safe
  because every append validates and hashes before it mutates and each commit
  is a single append. Persistent stores keep the isolated replay candidate, the
  durable-head check before and after the write, and the locks, so their append
  stays O(N) per record; disk verification was not weakened.
- **Completion API:** `complete()` and `completeSimple()` expose only the final
  message, so they now consume stream events as they arrive instead of leaving
  every delta queued until the result. Direct `stream.result()` callers can
  still iterate events afterwards.
- **Cursor provider:** the request closed only on the caller's signal, so the
  internal `timeoutMs` deadline never ended a silent HTTP/2 peer, and every
  request left one listener on a reused caller signal. The close handler now
  listens on the combined signal and is removed when the request settles. The
  deadline reports `stopReason: "error"` with `Cursor timed out after <ms>ms`;
  a caller abort still reports `stopReason: "aborted"` with `errorMessage:
  "aborted"`. An abort during the payload hook is checked before connecting.
- **RPC client:** see [TypeScript client resource lifecycle](rpc.md#typescript-client-resource-lifecycle).
  Waiters are owned and released on failure, closure or `stop()`; event dispatch
  snapshots listeners, so an unsubscribing waiter no longer hides `agent_end`
  from the next listener; stderr keeps an 8,192-code-unit tail; `prompt()`
  reports a refused prompt instead of leaving `promptAndWait()` to time out.
- **Session events:** `AgentSession` dispatches to a listener snapshot. A
  listener that unsubscribes no longer skips the next one, and a listener added
  during dispatch starts with the next event.
- **Subagent example:** bounded execution returned the aggregate without the
  final attempt's `attemptId`, process settlement or stream receipt. The merge
  now carries them while usage and output stay cumulative. The README install
  list gained `managed-process-tree.ts`, `subagent-stream.ts` and
  `graph-result.ts`, which `index.ts` imports. The byte-accounting part of the
  bundle had already landed in `8f12f90`; its regression test is kept.

The previous source cost

$$
C_q(n) = \frac{n(n-1)}{2}, \qquad C_b(d) = \frac{d(d-1)}{2}, \qquad H(N) = \sum_{k=1}^{N} k = \frac{N(N+1)}{2},
$$

where $n \ge 0$ is the number of messages drained one at a time, $d \ge 0$ the
branch depth in entries and $N \ge 0$ the number of memory-only journal appends;
$C_q$ and $C_b$ count array references copied or moved (unitless counts) and $H$
counts hash-function calls. Each drain copied the remaining queue, each ancestor
was inserted at the front, and each commit replayed the accepted prefix before
hashing its record.
After the change $C_q(n) \le n$ (a compaction copies at most the slots drained
since the previous one), $C_b(d) = 0$ with one $O(d)$ reverse, and $H(N) = N$.

Baseline: the same fixtures on the source before this change (`16df133`); each
row changes one algorithm and holds its input fixed.

| Input and metric | Before | After |
| --- | ---: | ---: |
| 4,096 individual queue drains: references copied by `slice` | 8,386,560 | 3,072 |
| Branch of depth 2,048: references moved by `unshift` | 2,096,128 | 0 |
| 128 memory-only journal audits: hash calls | 8,256 | 128 |
| `complete()` over 25 events: events consumed before the result | 0 | 25 |

These are counts from synthetic fixtures, not end-to-end latency or RSS
measurements. The persistent journal path was not shown to be faster.

Assumption: every `RunJournalStore` commit performs exactly one append. A commit
that appended twice could leave a memory-only store holding the first record
after the second failed; such a change must restore an isolated candidate for
memory-only stores as well.

Not adopted from the bundle: Vitest/tsconfig aliases that resolve `omk-ai`,
`omk-agent-core/node` and `open-multi-agent-kit` to source. They change module
resolution for more than two hundred test and example files and need their own
full-suite run; builds before tests remain the supported order. The bundle's
DAG completion diagnostic and its P0–P3 follow-ups (live phase spans, journal
segments, TUI frame batching, shared usage aggregation, an `EventStream` deque,
skill-scan caching) are proposals with adoption conditions, not changes here.

Test isolation note: `test.sh` isolates the agent directory but not `HOME`, and
the resource loader also reads `$HOME/.agents/skills`. On a machine with a large
user skill set, session tests that build a real system prompt can fail
admission (`PromptFixedOverheadError`) for reasons unrelated to the code under
test. Running those tests with an isolated `HOME` removes the dependency.

Coverage: `pending-message-queue.test.ts` (agent),
`complete-drain.test.ts` and `cursor-stream.test.ts` (ai),
`session-manager/branch-linear.test.ts`, `run-journal-performance.test.ts`,
`rpc-client-resource-lifecycle.test.ts`,
`agent-session-event-unsubscribe.test.ts`,
`subagent-adaptive-receipts.test.ts` and
`subagent-stream-performance.test.ts` (coding-agent).
