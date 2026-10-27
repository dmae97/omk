# Spec 103b — next-suggestion caps: per-cap hit counts in the trace

Status: draft (spec only, no implementation)
Base: `origin/main` @ `a0d6bfc9c0` (PR #187 / spec 103 merged). Paths under `packages/coding-agent/src/core/`.
Follow-up to spec 103 §3/§6 (Agent Researcher + Tech Lead, 2026-10-21 KST): before the 103 A/B, the trace must show how often each cap actually binds, so "no effect" can be told apart from "caps too loose". Not a merge blocker for #187.

## 1. What already exists (reuse, do not duplicate)
Suggestion requests settle as their own record in `turns.jsonl` (`next-suggestion-settlement.ts`, `turn-metrics-record.ts`):
- `purpose: "suggestion"`, `parentTurnIndex`, `suggestionOutcome ∈ {shown, empty, aborted, timeout, error}`, `usage` (incl. `costUsd`, `billedUsd`), `stopReason`, `durationMs`, `provider`, `model`.
- **Deadline cap hit is already observable**: `requestNextSuggestion` sets outcome `timeout` only when the deadline signal fired and the user signal did not (`next-suggestion.ts`, `finish`). So deadline hits = records with `suggestionOutcome: "timeout"`. No new field.
- Summary: `summarizeByPurpose` (`turn-metrics-purpose.ts`) gives `records`, `missingUsage`, `cancelledCostUsd` per purpose.

Gaps found in code:
1. **Cost cap hits are invisible.** `over_cost_cap` is a plan-time `skip` (`next-suggestion.ts`, `planNextSuggestion`); skips never reach `settle`, so nothing is written. The same holds for every `SuggestionSkipReason` (spec 103 §3 "skip-reason distribution" has no data source today).
2. **Reasoning cap hits are invisible.** `cappedSuggestionOptions` (`next-suggestion-budget.ts`) may lower `reasoning`, but no record says whether it did.
3. **Denominator / arm unknown.** A record does not say whether caps were on, so caps-off and caps-on records cannot be split in one file.

## 2. Proposed change (flag `OMK_NEXT_SUGGESTIONS_CAPS` on only; off ⇒ records byte-identical to `a0d6bfc9c0`)
Add to suggestion records only (all optional; legacy readers ignore them; schema stays `omk-turn-metrics-2`):
| Field | Type | Meaning |
|---|---|---|
| `capsApplied` | `true` | present on every caps-on suggestion record (request or skip); defines the denominator |
| `reasoningCapped` | `boolean` | `true` iff `cappedSuggestionOptions` returned a lower level than the recorded one |
| `suggestionSkip` | `SuggestionSkipReason` (closed enum, validated by `member`) | set on a **skip record**: a record with no `usage`, `durationMs: 0`, written for every caps-on plan skip, incl. `over_cost_cap` |
| `estimatedCostUsd` | `number` (≥ 0, `quantity`) | `over_cost_cap` skip records only: the pre-flight upper-bound estimate from `estimateSuggestionCostUsd` |
| `maxCostUsd` | `number` (> 0, `quantity`) | `over_cost_cap` skip records only: the cost cap value that applied (default or env override) |

- Deadline hit: reuse `suggestionOutcome: "timeout"` (no new field).
- Cost cap hit: `suggestionSkip: "over_cost_cap"`, with `estimatedCostUsd` and `maxCostUsd` stored as numbers only (lets the analysis see how far over the cap skipped requests were).
- **Flag scope:** skip records and every new field (`capsApplied`, `reasoningCapped`, `suggestionSkip`, `estimatedCostUsd`, `maxCostUsd`) are written **only** when `OMK_NEXT_SUGGESTIONS_CAPS` is on. With the flag off, trace/metrics output (`turns.jsonl` lines and summary) must be **byte-identical to `main`** (`a0d6bfc9c0`).
- Skip records are excluded from `missingUsage` (they made no request), from `turns`, duration percentiles and main-turn coverage (same as spec 103 suggestion records).
- Summary: extend `summarizeByPurpose` suggestion bucket with `capHits { deadline, cost, reasoning, total }` and `capsEligible` (= caps-on records, requests + skips). `total` = records with ≥1 cap hit (a record counts once even if reasoning was capped and it then timed out); per-cap counts may therefore sum to more than `total`.

### 2.1 Privacy
Trace stores **0 bytes of raw text**: only enums, booleans and numbers. No prompt, context, suggestion text, model output, or error message. Test asserts every new field is enum/boolean/number and that a skip record's serialized keys ⊆ the allowed key list.

## 3. Deterministic tests (faux provider, fake clock, no network)
1. Caps off (required): for the same faux session, the `turns.jsonl` bytes and summary output are byte-identical to `main` `a0d6bfc9c0` (golden fixture compare), request bytes identical, no new fields, no skip records — including when a plan would have skipped `over_cost_cap` under caps on.
2. Caps on, deadline fires ⇒ one record, `timeout`, `capsApplied`, `capHits.deadline = 1`, `total = 1`.
3. Caps on, estimate > `maxCostUsd` ⇒ zero provider calls, one skip record `over_cost_cap` with numeric `estimatedCostUsd` > numeric `maxCostUsd` (the applied cap, incl. env override), `capHits.cost = 1`.
4. Caps on, `MAX_REASONING=low` with main `high` ⇒ `reasoningCapped: true`; with `inherit` ⇒ `false`.
5. Reasoning capped + timeout ⇒ `deadline = 1`, `reasoning = 1`, `total = 1`.
6. User abort (not deadline) ⇒ `aborted`, no deadline hit.
7. Privacy: serialized record contains none of the faux prompt / suggestion / error strings (0 bytes raw text).
8. Parser: records with an unknown `suggestionSkip` value are malformed; legacy v2 records parse unchanged.

## 4. A/B verdict criteria (fixed now, before any measurement)
Arms as spec 103 §5 (A reuse, B capped, C skip). Sample unit = task; per cap, hit rate h = hits ÷ `capsEligible` in arm B.
1. **Sensitivity gate (per cap).** A cap is "binding" only if h ≥ **5%** of eligible suggestions **and** ≥ **20** hits in total across the run. Below that, the verdict for that cap is **"caps too loose / not exercised"** — never "no effect".
2. **If no cap is binding:** the A/B is **inconclusive (caps too loose)**. Next step is a lower-cap pilot (e.g. halve deadline / cost) in the free faux stage, not a paid rerun with the same caps, and not a conclusion.
   - Pilot data (lowered caps) is used **only to choose cap values**. The verdict uses **only a fresh run** with the chosen caps, never pilot data.
3. **If ≥1 cap is binding:** apply spec 103 §6 unchanged: promote B only if the 95% CI upper bound of per-verified-task cost change < 0 vs A **and** success-rate drop ≤ 5 pp. If the CI includes 0 with a binding cap ⇒ **"no effect (caps bound, cost not reduced)"**.
4. **Harm check:** if any cap has h ≥ **50%** and adoption rate (spec 103 §3) drops ≥ 10 pp vs A ⇒ **"caps too tight"**; do not promote.
5. Report per cap: hits, eligible, h, and which verdict branch applied. Thresholds (5% / 20 / 50% / 10 pp) are pre-registered here; changing them after seeing data requires a new spec revision posted in the room first.
6. Paid runs only after 인호 posts a dollar cap in the room (as spec 103 §6).

## 5. Flags / deps / rollback
- Flags: no new flag; fields are written only under `OMK_NEXT_SUGGESTIONS_CAPS`.
- New dependencies: 0.
- Rollback: revert is self-contained (settlement, record projection, purpose summary, controller skip path). Readers ignore unknown optional fields.

## 6. Open questions
- Should non-caps skip reasons (quota, cache_cold, …) also get skip records when caps are off? Proposed: no (keeps caps-off bytes identical); revisit after 103b.
- ~~Store the pre-flight estimate as a number?~~ Closed (review 2026-10-21 KST): yes, on `over_cost_cap` skip records only, with the applied cap (§2).
