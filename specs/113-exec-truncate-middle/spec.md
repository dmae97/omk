# Spec 113: `OMK_EXEC_TRUNCATE_MIDDLE`: head + tail bash output with a middle marker

Status: draft (spec only, no code), PR #245. Tech Lead answers applied (see Resolved decisions). Base: omk `9617e1effb` (main after #238).
Candidate 1 of the 107 A/B queue (Agent Researcher order: truncate-middle, edit fuzzy-indent, compaction).

## Problem

The bash tool shows the model only the **tail** of long output: last 2000 lines or 50KB
(51,200 bytes), whichever is hit first.

- `packages/coding-agent/src/core/tools/truncate.ts:11-12`: `DEFAULT_MAX_LINES = 2000`,
  `DEFAULT_MAX_BYTES = 50 * 1024`.
- `packages/coding-agent/src/core/tools/output-accumulator.ts`: `OutputAccumulator` keeps a
  decoded rolling tail (`appendDecodedText`, `trimTail`, `maxRollingBytes = 2 * maxBytes`),
  and `snapshot()` runs `truncateTail(getSnapshotText())`. It spills the raw bytes to
  `<tmpdir>/omk-bash-<16 hex>.log` (0600) once a limit is passed (`shouldUseTempFile`,
  `ensureTempFile`).
- `packages/coding-agent/src/core/tools/bash.ts:147` makes the accumulator; `emitOutputUpdate`
  (≈`:152-164`) streams `snapshot({ persistIfTruncated: true })`; `finishOutput` (≈`:197-206`)
  takes the final snapshot (and the RTK filter path).
- `packages/coding-agent/src/core/tools/bash-output.ts`: `formatBashOutput` appends the
  `[Showing lines X-Y of N ... Full output: <path>]` notice.
- `packages/coding-agent/src/core/bash-executor.ts:53` `executeBashWithOperations`
  (user `!` commands / RPC bash) has its own char rolling buffer (`maxOutputBytes =
  DEFAULT_MAX_BYTES * 2`, `:61`), fixed in #238 to trim the oldest chunk without splitting a
  surrogate pair (`:120-140`), then `truncateTail` (`:157`).

So the start of the output is lost: the command echo, the first compiler/test error, the
"N tests, first failure" line of a runner that later prints thousands of lines. The model has
to re-run or `read` the temp file. MCP output already keeps the start and the end
(spec 066: `truncateHeadTail` in `truncate.ts`, `capMcpContent` in
`packages/coding-agent/src/core/mcp/output-cap.ts`).

## Reference (idea only)

Codex CLI (`openai/codex`, **Apache-2.0**, verified: `LICENSE` is Apache License 2.0 and the
repo ships a `NOTICE`, both at commit `d6817454d76885e9d0e118bbf82e507aed6f715a`) keeps a
prefix and a suffix and puts a marker in the middle:

- [`codex-rs/utils/string/src/truncate.rs`](https://github.com/openai/codex/blob/d6817454d76885e9d0e118bbf82e507aed6f715a/codex-rs/utils/string/src/truncate.rs):
  `truncate_middle_chars` / `truncate_middle_with_marker`, `split_budget` (50/50),
  `split_string` (cuts only on `char` boundaries), marker `…{N} chars truncated…`
  / `…{N} tokens truncated…`.
- [`codex-rs/utils/output-truncation/src/lib.rs`](https://github.com/openai/codex/blob/d6817454d76885e9d0e118bbf82e507aed6f715a/codex-rs/utils/output-truncation/src/lib.rs):
  `formatted_truncate_text` adds a header with the original token count and total lines.

**No code is copied.** It is Rust and works on a finished string; omk needs a streaming
TypeScript version. If a later PR does copy code, it must add an Apache-2.0 attribution
header on the file and create/update a root `NOTICE` (omk has no `NOTICE` today at
`9617e1effb`) carrying the Codex NOTICE lines. Same 1/2 split as Codex; differences on purpose: omk counts lines as well as bytes, counts the
marker inside the budget, and names the full-output file in the marker.

## Change

New env flag `OMK_EXEC_TRUNCATE_MIDDLE`, **default off**.

- **Off (unset, empty, or anything but `1`)**: no code path changes. Bash tool content,
  `details`, tool description and the temp file are byte-identical to `9617e1effb`.
  Patch releases never flip the default; turning it on by default needs a minor release,
  a green A/B (below) and Tech Lead sign-off.
- **On (`1`)**: bash tool output that passes a limit is shown as head + marker + tail.
  Output under both limits is unchanged (no marker, no temp file).
- Read once per tool call (`process.env` at `bash.ts` `execute`), like `OMK_RTK_OUTPUT`
  (`rtk-output.ts:39`), so tests can toggle it.
- 0 new dependencies, no workflow edits.

### Budget split

Same totals as today, **marker included**, so the model gets the same bytes in both arms (D2).

Let `M` = byte length of the marker line incl. its `\n` (computed with the final numbers;
if a digit count changes after the split, recompute once and re-split).

| | bytes | lines |
|---|---|---|
| marker | `M` (typically ≤ ~250) | 1 |
| head | `floor((maxBytes - M) / 2)` (≈ 25,475 for M = 250) | `floor((maxLines - 1) / 2)` = 999 |
| tail | `maxBytes - M - headBytesUsed` (≥ 25,475) | `maxLines - 1 - headLinesUsed` (≥ 1,000) |

- Head + marker + tail ≤ 51,200 bytes and ≤ 2000 lines (strict; unlike MCP spec 066).
- Head keeps whole lines. If line 1 alone exceeds the head byte budget, head is a UTF-8 safe
  byte prefix of line 1 (same as `truncateHeadTail`).
- Unused head budget goes to the tail.
- Why 1/2: Codex `split_budget` and MCP spec 066 precedent (D1). A 1/3 head is only measured
  as a separate follow-up if the A/B result is ambiguous.
- Streaming head capture uses the upper bound `floor((maxBytes - 256) / 2)` = 25,472 bytes;
  `snapshot()` trims the head further if the real `M` needs it.

### Marker

One line between head and tail, own line (a `\n` is inserted before it if the head ends
mid-line):

```
[... omitted {L} lines ({S}) of {N} lines ({T}) between line {a} and line {b}. Full output: {path} (use read with offset/limit to see the middle) ...]
```

- `{L}` omitted lines, `{S}` omitted bytes (`formatSize`), `{N}`/`{T}` totals,
  `{a}` last head line, `{b}` first tail line (1-based). When the cut is inside a single
  line, `{L}` is 0 and the text says `inside line {a}`.
- If the temp file could not be opened: `Full output could not be saved.`
- `formatBashOutput` keeps its trailing notice but with the new shape:
  `[Showing lines 1-{a} and {b}-{N} of {N} (50.0KB limit). Full output: {path}]`.
  Off: today's notices unchanged.
- English only, ASCII apart from the data, so it is stable for tests and the A/B diff.

### UTF-8 and surrogate safety

- The head is built from text already decoded by the accumulator's streaming
  `TextDecoder` (`append` → `decoder.decode(data, { stream: true })`), so a multi-byte
  sequence split across chunks is never cut. Bytes are counted with
  `Buffer.byteLength(..., "utf-8")`.
- Cutting the head to its budget uses a code-point boundary cut (move `truncateStringToBytesFromStart`
  in `truncate.ts` to an export); on JS strings, never end on a high surrogate
  (`0xD800-0xDBFF`) — same rule #238 uses for the start of the tail.
- The tail keeps today's `trimTail` (UTF-8 continuation-byte skip) and `truncateTail`.
- Invalid input bytes are already U+FFFD from the decoder; counts are on decoded bytes
  (`totalDecodedBytes`), as today.

### Streaming

`OutputAccumulator` gets an option `headTail?: boolean` (bash passes
`headTail: process.env.OMK_EXEC_TRUNCATE_MIDDLE === "1"`).

- New fields: `headText`, `headBytes`, `headLines`, `headDone`.
- In `appendDecodedText`, before the tail logic: while `!headDone`, append the incoming
  decoded text to `headText` up to the head budget (bytes and lines). When the budget is hit,
  cut on the last full line (or code-point prefix if line 1 is too long) and set `headDone`.
  After that the head is frozen; memory stays O(head budget + 2×rolling tail).
- The tail ring buffer runs unchanged on **all** text (including what went into the head),
  so off/on share the same tail code.
- `snapshot()` when on and truncated: head = `headText`; tail = `truncateTail` of the
  snapshot text with `maxBytes - headBytes` / `maxLines - headLines`, **minus any overlap**:
  if `totalDecodedBytes - tailBytes < headBytes` (head and tail overlap, i.e. output is only
  a little over the limit), drop the overlapping start of the tail so no byte is shown
  twice. Omitted = total − head − tail (bytes and lines), never negative.
- Partial updates (`emitOutputUpdate`) use the same snapshot, so the TUI and `onUpdate`
  show head + marker + tail while running.

### `truncated` flag, `details` and the temp file

- `details.truncation.truncated` keeps its meaning (a limit was passed) and its current
  value in both arms. That is the A/B secondary metric (count of `truncated:true` calls), so
  it must not change with the flag.
- Additive fields only when on and truncated: `truncation.strategy: "head-tail"`,
  `headLines`, `headBytes`, `omittedLines`, `omittedBytes`. Off: absent (byte-identical
  details).
- Temp file: unchanged. Still the full raw bytes, same path rule, 0600, created by the same
  `shouldUseTempFile` / `persistIfTruncated` rule, registered as `tool-output-log`.
- RTK filter (`OMK_RTK_OUTPUT=1`) path: unchanged; it replaces the snapshot only when it
  applies (successful vitest/tsc). If both flags are on and RTK applies, RTK output wins.

### Tool description

`bash.ts:117` ("truncated to last 2000 lines or 50KB") is **unchanged** in both arms (D5), so
the A/B isolates the output change. `toolsHash` and the first request payload are identical
across arms (see A/B step 2).

### Workers

Subagent / worker processes are expected to inherit `process.env`, so they get the flag with no
extra code; the bash tool reads it per call. Test 14 asserts that a subagent worker spawned
through omk's real spawn path sees `OMK_EXEC_TRUNCATE_MIDDLE=1` from the parent (D4). Any spawn
path that builds a clean env is listed here by the implementation PR and is treated as
**flag-off** (no explicit pass-through in phase 1).

### Out of scope

- `executeBashWithOperations` (user `!` / RPC bash, `bash-executor.ts`). Phase 2 behind the
  same flag, after the A/B (D3). Phase 1 = agent bash tool only.
- read/grep/find/ls truncation, MCP cap (already head+tail), limits themselves.

## Code integration points (at `9617e1effb`)

| file | function | change |
|---|---|---|
| `packages/coding-agent/src/core/tools/output-accumulator.ts` | `OutputAccumulatorOptions`, `constructor`, `appendDecodedText`, `snapshot`, new `buildHeadTailSnapshot` | head capture + head/tail snapshot |
| `packages/coding-agent/src/core/tools/truncate.ts` | export `truncateStringToBytesFromStart`; extend `TruncationResult` with optional head-tail fields | helper + types |
| `packages/coding-agent/src/core/tools/bash-output.ts` | `formatBashOutput` | marker + new trailing notice when `strategy === "head-tail"` |
| `packages/coding-agent/src/core/tools/bash.ts` | `execute` (accumulator creation `:147`) | read flag, pass option (description unchanged) |
| `packages/coding-agent/README.md` / `docs` | env flag list | document flag |

## Tests (unit)

New `packages/coding-agent/test/spec113-exec-truncate-middle.test.ts`:

1. Flag off: 3 fixtures (small, 3000 lines, one 200KB line) → content, details
   byte-identical to a snapshot taken at `9617e1effb`.
2. On, under limits → identical to off (no marker, no temp file).
3. On, 5000 short lines → first 999 lines, marker, last lines; head+marker+tail ≤ 2000
   lines / 51,200 bytes; `omittedLines` = 5000 − kept.
4. On, byte-limited (500 lines × 1KB) → head = `floor((51,200 − M)/2)` bytes or less, head+marker+tail ≤ 51,200, omitted bytes exact.
5. On, single 200KB line → head = code-point prefix, marker says `inside line 1`, `omittedLines` 0.
6. On, just over limit (51,300 bytes) → no byte shown twice (overlap rule).
7. UTF-8: 3- and 4-byte chars (한글, emoji) split across `append` chunk borders at every
   offset 0..3 → output is valid UTF-8, no U+FFFD that was not in the input, no lone surrogate.
8. Streaming: `snapshot()` mid-stream (partial update) has head frozen after the budget,
   tail moving; final snapshot equals one-shot result for the same bytes.
9. `truncated` flag and `truncatedBy` equal in off and on for all fixtures.
10. Temp file content equals raw input bytes, mode 0600, in both arms.
11. Marker numbers (`a`, `b`, `L`, `S`, `N`, `T`) match a brute-force count from the temp file.
12. Head ends mid-line (line 1 too long) → marker on its own line.
13. RTK + flag: RTK applied output unchanged.
14. Env: a subagent worker spawned through omk's normal spawn path inherits
    `OMK_EXEC_TRUNCATE_MIDDLE=1` from the parent env; flag read per call (toggle between two
    calls in one process); tool description identical with flag on/off.
15. Memory: 50MB streamed → accumulator retained text ≤ head budget + 4×maxBytes.

Existing to keep green: `bash-output-tail.test.ts`, `spec076-bash-correctness.test.ts`,
`oversized-output-hang*.test.ts`, `bash-rtk-output.test.ts`, `spec066-mcp-output-cap.test.ts`,
full `npm run check`.

## A/B plan

Owner: Bench Analyst; method: Agent Researcher (shared 107 rules).

0. **Gate (D6)**: existing box logs are pre-#224 and have no `truncated` field, so they are not
   used. The count of **distinct tasks** with at least one bash call `truncated:true` is taken
   from the 107 A/B run logs at `9617e1effb` (run log on, free models); no separate run.
   Agent Researcher aggregates. If < 3 tasks: no A/B, merge on unit tests only (flag stays
   default off). If ≥ 3: steps 1-8.

1. **Build both arms** from baseline `9617e1effb` (A) and the spec 113 head (B) in two
   directories of **equal path length** (e.g. `/workspace/ab113-a`, `/workspace/ab113-b`),
   same Node 22, `env -u TYPESAFE_API_KEY`, `OMK_TRUST_PROJECT=0`, temp HOME.
2. **Diff the first request payload first** (one task, both arms, B with the flag on). No diff is
   allowed (tool description is unchanged). Anything else (paths, ordering, cache
   boundary) stops the A/B until fixed.
3. **Run**: B = `OMK_EXEC_TRUNCATE_MIDDLE=1`, A = unset. 66 tasks × n ≥ 5 per arm, same
   model, same seeds/order rules, interleaved.
4. **Primary**: pass-rate difference B − A, task-clustered 95% CI; ship gate: lower bound
   **> −3pt**.
5. **Cost gates**: mean tokens B/A ≤ **1.10×**, wall time B/A ≤ **1.25×**.
6. **Secondary**: number of bash calls with `truncated:true` per arm (and per task);
   number of follow-up `read` calls on `omk-bash-*.log`; re-runs of the same command.
7. **Models**: free models only, unless 인호 posts a dollar cap. If 66 × 5 × 2 does not fit
   the free quota, Bench Analyst estimates the cost first and asks 인호 for a cap before any
   paid run.
8. Report: baseline SHA, B SHA, model, n, CI, token/time ratios, secondary counts, raw logs path.
   No ranking claims; public text only "self-measured under TB 4.0 rules".

## Resolved decisions (Tech Lead)

- **D1** Head share 1/2 (Codex / MCP spec 066 precedent). 1/3 only as a separate follow-up if
  the A/B is ambiguous.
- **D2** Marker counts inside the 50KB / 2000-line budget, so both arms give the model equal
  bytes.
- **D3** Phase 1 = agent bash tool only; user `!` / RPC (`executeBashWithOperations`) deferred
  to phase 2.
- **D4** Test that subagent workers inherit the parent env flag; any non-inheriting path is
  documented in this spec and treated as flag-off.
- **D5** Tool description unchanged.
- **D6** Distinct-task count of `truncated:true` from the 107 A/B run logs at `9617e1effb`
  (Agent Researcher); < 3 tasks => no A/B, merge on tests only.
