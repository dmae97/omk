# Spec 114: `OMK_EDIT_FUZZY_MATCH`: staged, unique-only indentation-tolerant edit matching

Status: draft (spec only, no code). Base: omk `a5127044a9` (main after #247).
Tech Lead answers to Q1-Q6 are recorded as decisions D1-D8 (see Resolved decisions).
Candidate 2 of the 107 A/B queue (Agent Researcher order: truncate-middle, **edit fuzzy-indent**, compaction).
Implementation is gated (see Gate); until then this spec is the only deliverable.

## Problem

The edit tool (`packages/coding-agent/src/core/tools/edit.ts`, `edit-diff.ts`) already has
**two** match stages, always on:

- Stage 1, exact: `fuzzyFindText` (`edit-diff.ts:236`) tries `content.indexOf(oldText)`.
- Stage 2, normalized: `normalizeForFuzzyMatch` (`edit-diff.ts:34`) = NFKC + `trimEnd()` per
  line + smart quotes / Unicode dashes / special spaces → ASCII, searched in
  `buildNormalizedContentMap(content).normalized` (`:140`) and mapped back with
  `mapNormalizedSpanToOriginal` (`:198`).

So trailing whitespace and Unicode punctuation already match today. What does **not** match:

1. **Leading-indent drift.** `oldText` with the right lines but wrong indentation (tabs vs
   spaces, 2 vs 4, one level off) → `getNotFoundError` (`:286`). spec 107's run log already
   classifies this as `indent_only` (`edit-match-observe.ts:70`, `matchesIgnoringIndent`).
2. **Duplicate rejection already holds for existing stages.** `countOccurrences` (`:280`)
   normalizes both sides, and `applyEditsToNormalizedContent` (`:365`) throws
   `getDuplicateError` when a normalized `oldText` has 2+ candidates (covered by
   `test/tools.test.ts:972`, `:1052`,
   `test/regression/edit-diff-fuzzy-whole-file-rewrite.test.ts:151`). The new `trim` stage
   must keep this guarantee (see D2).

The model then re-reads the file and retries, costing a turn and tokens.

## Reference

- Codex CLI, `openai/codex` (**Apache-2.0**, repo ships `NOTICE`), commit
  `e6ebdfe00b520e21ed50ac0362656f32dd64d2fc`:
  [`codex-rs/apply-patch/src/seek_sequence.rs`](https://github.com/openai/codex/blob/e6ebdfe00b520e21ed50ac0362656f32dd64d2fc/codex-rs/apply-patch/src/seek_sequence.rs)
  `seek_sequence(lines, pattern, start, eof)`: line-wise, decreasing strictness:
  exact → `trim_end` → `trim` → `normalise` (trim + dash/quote/space → ASCII). Returns the
  **first** index at the first stage that hits; it does not check uniqueness.
- Aider, `Aider-AI/aider` (**Apache-2.0**), commit `5dc9490bb35f9729ef2c95d00a19ccd30c26339c`:
  [`aider/coders/search_replace.py`](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/search_replace.py)
  `flexible_search_and_replace` (`:565`) tries strategies with preprocessors; `relative_indent`
  (`:239`) re-expresses lines as indent deltas so a block can match at another indent level and
  the replacement is re-indented to the file.

**Porting (D8).** Translating Codex `seek_sequence.rs` to TS counts as porting, not idea-only.
The implementation PR must add, in the same PR: an Apache-2.0 source header at the top of the
new file naming `openai/codex`, `codex-rs/apply-patch/src/seek_sequence.rs` and the commit above,
and a root `NOTICE` entry (create `NOTICE` if missing). Same for any Aider code. The re-indent
idea from Aider is written fresh. Library Scout checks this on the PR.

## Change (flag on)

`OMK_EDIT_FUZZY_MATCH=1` (read per call from `process.env`; unset/anything else = off).

Per edit, in `applyEditsToNormalizedContent`, stages run in order; the **first stage with ≥1
candidate decides**:

| stage | name | compare | span |
|---|---|---|---|
| 1 | `exact` | `content.indexOf(oldText)` (today) | char |
| 2 | `trailing_ws` | per line `trimEnd()` | line-wise |
| 3 | `trim` | per line `trim()` (leading indent ignored) | line-wise, whole lines only |

No Unicode stage in v1 (D1): today's normalized match (`fuzzyFindText`) already folds quotes,
dashes and special spaces. The only new stage is 3 (`trim`).

Rules:

- **Unique only.** At the deciding stage, count all candidates (non-overlapping scan over the
  whole file, not first-hit like Codex). Exactly 1 → apply. ≥2 → fail with the existing
  `getDuplicateError` (`:297`) text plus ` (matched at stage <name>)`. No lower stage is tried
  after a stage finds ≥2.
- **0 at every stage** → existing `getNotFoundError` text, plus the hint
  ` (no match at any stage: exact, trailing_ws, trim)`.
- Stages 3-4 match **whole lines** only: `oldText` is split on `\n`; a candidate is a run of
  `k` consecutive file lines. Leading/trailing empty lines of `oldText` are significant at
  stage 1-2 and trimmed at stage 3 (Aider `strip_blank_lines`), documented in tests.
- **Re-indent (stage 3, D4).** Compute the indent delta = common leading-whitespace prefix of
  the matched file lines vs of the `oldText` lines. Apply that delta **uniformly to every
  `newText` line** (replace the `oldText` prefix with the file prefix), so relative indentation
  inside the replacement is kept. If the matched file lines, `oldText` or `newText` mix tabs and
  spaces in their indentation, **fail and do not edit** (not-found error with
  ` (stage trim: mixed tabs/spaces)`). Never touch text outside the matched span.
- **Line endings / BOM:** unchanged path. `edit.ts` already does `stripBom` →
  `detectLineEnding` → `normalizeToLF` → apply → `restoreLineEndings`; stages run on the LF
  text, so CRLF files stay CRLF.
- **Overlap / no-op** checks (`:379-389`, `getNoChangeError`) unchanged, using the matched span.
- Multi-edit calls: each edit decides its own stage; all must succeed or none is written
  (today's all-or-nothing).

### Flag off

Byte-identical to the A/B baseline (main after spec 107 PR #250 (`OMK_EDIT_DIAGNOSTICS`) merges; the same main SHA as the 107 A/B): same match result, same
error strings, same diff/details, same tool description and schema. Today's normalized stage
(trim-end + Unicode) stays as is.

### Logging

spec 107 `edit-match.jsonl` already records `matchStages` (1 = exact, 2 = fuzzy) via
`editMatchObserver.stages` (`edit-match-observe.ts`), called from `edit.ts:196`
(`logSuccess`) and `:186` (`logFailure`). Flag on: the applier returns the stage per edit and
the observer logs it instead of recomputing: values `1..3` as in the table, plus
`fuzzyFlag: true`. On failure add `stage` of the duplicate decision when reason is
`multiple_matches`. Flag off: lines unchanged (golden
`test/fixtures/edit-match-observe/golden-main.json` stays green). No file text or paths, only
enums/numbers/hash (spec 107 rule). The stage is recorded **only in the run log**, never in
the tool result the model sees (D6).

### Tool description

Unchanged in v1 (D5): the first request payload diff vs the baseline must be 0 (A/B step 2).

### Out of scope

`apply_patch` tool (Codex `parser.rs`), window edit (SWE-agent), `write` tool, user-side
edits, any edit-distance / diff-match-patch matching (Aider `dmp_apply`).

## Code integration points (at `a5127044a9`)

| file | function | change |
|---|---|---|
| `src/core/tools/edit-diff.ts` | `applyEditsToNormalizedContent` (`:333`) | take `{ fuzzyStages: boolean }`; call new `findStagedMatch` when on; return `stages: number[]` in `AppliedEditsResult` (`:220`) |
| `src/core/tools/edit-diff.ts` (or new `edit-stage-match.ts`) | new `findStagedMatch(content, oldText): { stage, candidates: {index,length}[] }`, `reindentReplacement` | stages 2-3, line-wise; Apache-2.0 header if ported (D8) |
| `src/core/tools/edit-diff.ts` | `getNotFoundError` / `getDuplicateError` (`:286`, `:297`) | optional stage suffix (only when on) |
| `src/core/tools/edit-diff.ts` | `computeEditsDiff` (`:555`) | same flag so preview == applied (D3) |
| `src/core/tools/edit.ts` | `execute` (`:122` def; apply ≈`:175-196`) | read flag, pass option, pass stages to `logSuccess` |
| `src/core/tools/edit-match-observe.ts` | `logSuccess`, `stages` | accept stages from applier when present |
| `NOTICE` (root) | — | Codex entry in the same PR; create file if missing (D8) |
| README / env docs | flag list | document flag, "default off" |

## Tests (unit)

New `packages/coding-agent/test/spec114-edit-fuzzy-match.test.ts`:

1. Flag off: all `edit-match-observe-cases.ts` cases + indent-drift fixtures → result, error
   string, file bytes identical to the baseline (golden).
2. On, exact match → stage 1, same bytes as off.
3. On, trailing-whitespace drift → stage 2, applied, file trailing whitespace outside span kept.
4. On, indent drift (4 spaces in file, 2 in `oldText`) → stage 3, `newText` re-indented to 4.
5. On, tabs in file, tabs-only `oldText` at another depth → stage 3, replacement uses tabs.
6. On, nested block: `newText` adds a deeper line → delta applied uniformly, relative indent kept.
7. On, mixed tabs/spaces in indentation → fails, file unchanged (D4).
8. On, stage 3 with 2 candidates → duplicate error with `(matched at stage trim)`; file unchanged.
9. On, stage 1 unique but stage 3 would have 2 → stage 1 applies (first deciding stage wins).
10. On, CRLF file + BOM → stage 3 apply, output still CRLF and BOM, no mixed endings.
11. On, multi-edit: one stage-1 + one stage-3 edit, and a variant where the second fails →
    nothing written.
12. On, partial-line `oldText` with indent drift → not matched at stage 3 (whole lines only).
13. Run log: on → `matchStages` values 1..3 and `fuzzyFlag`; off → golden lines unchanged;
    tool result text identical to off for stage-3 hits (D6).
14. Edit tool and `computeEditsDiff` give identical results (diff, error) for cases 3-8 (D3).
15. First request payload (tool description/schema) identical with flag on and off (D5).

Case 8 is the trim-stage duplicate guard; existing-stage duplicate tests (`test/tools.test.ts:972`,
`:1052`, `edit-diff-fuzzy-whole-file-rewrite.test.ts:151`) must stay green.

Keep green: `edit-match-observe.test.ts`, `edit-tool-legacy-input.test.ts`,
`edit-tool-no-full-redraw.test.ts`, full `npm run check`.

## Gate

Implementation starts only if Agent Researcher counts **≥ 3 distinct failed tasks** that have
an `edit-match.jsonl` failure with `reason: "indent_only"` **and no successful edit of the same
`pathHash` in any session of the same task** (sessions grouped to the lead via
`parentSessionId`). Source: the 107 A/B run logs recorded with `OMK_RUN_LOG_DIR` set, free
models only (script `indent_only_count.mjs`).
< 3 → spec stays merged as draft, no code. Count, log paths and SHA are posted in the room.

## A/B plan

Owner: Bench Analyst; method: Agent Researcher (shared 107 rules).

1. Build A = main **after spec 107 PR #250 (`OMK_EDIT_DIAGNOSTICS`) merges** (D7), B = spec 114 head, in two dirs of equal
   path length, same Node 22, `env -u TYPESAFE_API_KEY`, `OMK_TRUST_PROJECT=0`, temp HOME.
2. **Diff the first request payload first** (one task, B flag on). Must be identical (tool
   description unchanged); any diff stops the A/B.
3. Run B = `OMK_EDIT_FUZZY_MATCH=1`, A = unset; **66 tasks × n ≥ 5** per arm, same model, interleaved.
4. Primary: pass-rate B − A, **task-clustered 95% CI, lower bound > −3pt**.
5. Cost: mean tokens B/A **≤ 1.10×**, wall time B/A **≤ 1.25×**.
6. Secondary: edit failures per task by reason, stage histogram (B), retries after
   `indent_only`, wrong-location edits (stage ≥3 edits later reverted on the same file).
7. Free models only unless 인호 posts a dollar cap.
8. Report baseline SHA, B SHA, model, n, CI, ratios, secondary counts, raw log path. No
   performance wording in CHANGELOG without this result ("flag, default off").

## Resolved decisions (Tech Lead, answers to Q1-Q6)

- **D1** No Unicode stage in v1. `fuzzyFindText` already folds quotes/dashes; the only new
  stage is leading-indent-insensitive (`trim`).
- **D2** Duplicate rejection already holds for the existing stages (normalized
  `countOccurrences` + `getDuplicateError`). The new `trim` stage must keep it: 2+ candidates
  fail with the duplicate error (test case 8). No separate fix PR is needed.
- **D3** Scope = edit tool + `computeEditsDiff`, with a test that both give identical results.
- **D4** Re-indent: apply the file-vs-model indent delta uniformly to every replacement line;
  mixed tabs/spaces → fail, don't edit.
- **D5** Tool description unchanged; first-request payload diff must be 0.
- **D6** v1 records the match stage in the run log only, not in the tool result.
- **D7** A/B baseline SHA = main after spec 107 PR #250 (`OMK_EDIT_DIAGNOSTICS`) merges; the same main SHA is used for the 107 A/B.
- **D8** Code ported from Codex `seek_sequence.rs` counts as porting: Apache-2.0 source header at
  the top of the file and a `NOTICE` entry in the same PR (create root `NOTICE` if missing).
