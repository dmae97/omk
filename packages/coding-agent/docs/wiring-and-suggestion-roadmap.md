# Correctness wiring and suggestion roadmap

This roadmap turns the 2026-10-24 wiring review into independently revertable implementation units. The local baseline is `45d65f04d464a74b707d5ead2e45433a5f082b52`; re-check later revisions before applying a finding. Correctness gates come before cache or UX experiments. No performance, cost, or quality improvement is asserted before measurement.

## Ownership model

### Architecture boundaries

Inputs are the settled main request, goal snapshot, Git dirty set, and editor state. Durable state remains in the goal store; request state remains in the host scope; candidate and quota state remain memory-only. Pure transforms plan suggestions, resolve effective output ceilings, and filter workspace paths. Outputs are attached evidence, settled request metrics, and editor placeholder or insertion events. Every asynchronous output crosses a stale-identity gate, while malformed scope, provider failure, cancellation, and disposal terminate without changing completion or editor contents.

The existing host remains the owner of requests, evidence, and UI lifetime. Do not add another scheduler or prediction service.

```text
Main turn
  -> MainRequestRecorder (request context only)
  -> prompt_settled
  -> local eligibility checks
  -> shared quota snapshot
  -> host-owned suggestion request scope
  -> generation settlement
  -> bounded current candidate
  -> editor/context freshness check
  -> display
  -> Tab freshness check
  -> insertion

Goal verifier
  -> capture goal instance + generation + acceptance contract
  -> run approved check
  -> revalidate all three identities
  -> attach evidence with store revision CAS
  -> completion checks evidence + complete workspace scope
```

A display consumer may abandon a wait without owning termination of the underlying provider or quota request. The request owner settles cancellation, metrics, and late results exactly once. API keys, raw prompts, tool outputs, and credential values never enter cache keys or telemetry.

## Implementation units

Each unit requires a failing regression before its production patch, a targeted test after it, and `npm run check` for the final combined change.

| Unit | Boundary | Required invariant | Rollback |
| --- | --- | --- | --- |
| W1 | Goal evidence attachment | A delayed receipt cannot attach to another goal generation or acceptance contract | Revert the identity check; journals remain readable |
| W2 | Workspace scope and completion | Host-owned state is excluded before the cap; incomplete scope never means whole-workspace verification | Revert resolver ordering and consumer gate together |
| W3 | Tab and Enter acceptance | The accepted list snapshot matches current text, cursor, and provider request generation | Revert the final acceptance guard |
| W4 | Autocomplete request queue | A rejected request settles its own queue entry and does not reject later entries | Revert the request-local error boundary |
| W5 | Suggestion cost admission | Admission and provider dispatch use the same effective output ceiling | Keep the suggestion and caps flags off |
| W6 | Stream wrapper identity | Pass-through wrappers preserve source-owned descriptors and custom stream classification | Revert descriptor forwarding |
| W7 | Auxiliary request lifetime | Admission, trace, cancellation, terminal settlement, and TUI disposal have one host owner | Disable `OMK_NEXT_SUGGESTIONS` |
| C1 | Quota reads | Sidebar and suggestion share scoped snapshots and in-flight reads without sharing consumer cancellation | Revert consumers to direct reads |
| C2 | Candidate reuse | At most one current candidate and one identical in-flight request per session; cache serves add no generation cost | Memory-only candidate cache removal |
| UX | Prefix suffix | No model call per key; only exact-prefix, cursor-at-end, current-context suffixes are insertable with Tab | Independent opt-in experiment |

W3 and W4 share `editor.ts` and land as one reviewed editor patch with separate regressions. W1 and W2 share completion semantics and require a combined integration check. W5 through C2 remain behind their existing flags; this roadmap does not enable suggestions globally.

## Current implementation checkpoint

The local change implements W1-W7, C1, and C2: generation/contract-pinned evidence, pre-cap host-state exclusion, complete-scope completion, stale acceptance blocking, rejection recovery, effective-ceiling admission, stream identity, auxiliary request scopes, TUI disposal, shared quota reads, and one-candidate/in-flight reuse. These are correctness and ownership changes, not measured performance claims. Prefix suffix UX and file-search caching remain separate follow-up experiments.

## Measurement contract

Keep generated, displayed, accepted, sent, and cache-served events distinct. Unknown usage is not zero. A cached display is not a new generated candidate.

For a paired workload with the same model and configuration, where each $N$ is a non-negative event count from that workload and the eliminated-call ratio is evaluated only when its denominator is positive:

$$
\mathrm{eliminated\ call\ ratio} =
\frac{N_{\mathrm{baseline\ duplicate\ calls}}-N_{\mathrm{cache\ calls}}}
{N_{\mathrm{baseline\ duplicate\ calls}}}
\qquad
\mathrm{acceptance\ ratio} =
\frac{N_{\mathrm{accepted}}}{N_{\mathrm{displayed}}}
$$

Measure settled-to-displayed latency, provider calls removed, known generation cost, and main-turn contention. Report session-clustered results only after collecting real sessions; do not substitute cache accounted bytes for RSS.

## Completion gates

1. P1 regressions cover objective changes, round advancement, host-state-heavy Git scopes, stale Tab and Enter, rejection recovery, reasoning ceilings, and builtin/custom stream identity.
2. Native-path tests exercise the real installer, session event, editor acceptance, and evidence consumer rather than only helper functions.
3. Cache tests cover session, branch, model, endpoint, auth revision, dismissal, expiry, cancellation, and duplicate settlement.
4. Prefix tests cover Korean text, emoji, combining characters, paste, cursor movement, autocomplete priority, and undo. Enter keeps its existing submit meaning.
5. Unrun provider calls, terminal rendering, performance effects, and billing effects remain explicitly unverified.
