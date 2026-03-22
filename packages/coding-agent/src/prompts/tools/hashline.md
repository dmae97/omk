Applies precise, surgical file edits by referencing `LINE#ID` tags from `read` output. Each tag uniquely identifies a line, so edits remain stable even when lines shift.

Read the file first to get fresh tags. Submit one `edit` call per file with all operations batched — tags shift after each edit, so multiple calls require re-reading between them.

<operations>
**`path`** — the path to the file to edit.
**`move`** — if set, move the file to the given path.
**`delete`** — if true, delete the file.

**`edits[n].pos`** — the anchor line. Meaning depends on `op`:
  - if `replace`: first line to rewrite
  - if `prepend`: line to insert new lines **before**; omit for beginning of file
  - if `append`: line to insert new lines **after**; omit for end of file
**`edits[n].end`** — range replace only. The last line of the range (inclusive). Omit for single-line replace.
**`edits[n].lines`** — the replacement content:
  - for `replace`: the exact lines that will replace `[pos, end??pos]` inclusively (or the single `pos` line when `end` is omitted)
  - for `prepend`/`append`: the new lines to insert
  - `[""]` — blank line
  - `null` or `[]` — delete if replace
- If `lines` contains content that already exists after `end`, those lines **will be duplicated** in the output.
- Keep `lines` to exactly what belongs inside the consumed range.
- Ops are applied bottom-up. Tags **MUST** be referenced from the most recent `read` output.
</operations>

<examples>
All examples below reference the same file, `util.ts`:
```ts
{{hlinefull  1 "// @ts-ignore"}}
{{hlinefull  2 "const timeout = 5000;"}}
{{hlinefull  3 "const tag = \"DO NOT SHIP\";"}}
{{hlinefull  4 ""}}
{{hlinefull  5 "function alpha() {"}}
{{hlinefull  6 "\tlog();"}}
{{hlinefull  7 "}"}}
{{hlinefull  8 ""}}
{{hlinefull  9 "function beta() {"}}
{{hlinefull 10 "\t// TODO: remove after migration"}}
{{hlinefull 11 "\tlegacy();"}}
{{hlinefull 12 "\ttry {"}}
{{hlinefull 13 "\t\treturn parse(data);"}}
{{hlinefull 14 "\t} catch (err) {"}}
{{hlinefull 15 "\t\tconsole.error(err);"}}
{{hlinefull 16 "\t\treturn null;"}}
{{hlinefull 17 "\t}"}}
{{hlinefull 18 "}"}}
```

<example name="single-line replace">
Change the timeout from `5000` to `30_000`:
```
{
  path: "util.ts",
  edits: [{
    op: "replace",
    pos: {{hlineref 2 "const timeout = 5000;"}},
    lines: ["const timeout = 30_000;"]
  }]
}
```
</example>

<example name="delete lines">
Single line — `lines: null` deletes entirely:
```
{
  path: "util.ts",
  edits: [{
    op: "replace",
    pos: {{hlineref 1 "// @ts-ignore"}},
    lines: null
  }]
}
```
Range — remove the legacy block (lines 10–11):
```
{
  path: "util.ts",
  edits: [{
    op: "replace",
    pos: {{hlineref 10 "\t// TODO: remove after migration"}},
    end: {{hlineref 11 "\tlegacy();"}},
    lines: null
  }]
}
```
</example>

<example name="rewrite a block body — shape (a)">
Replace the catch body with smarter error handling. Shape (a): `pos` is the first body line, `end` is the last body line. The catch header (line 14) and its closer (line 17) are outside the range and stay untouched.

When changing body content, replace the **entire** body span — not just one line inside it. Patching one line leaves the rest of the body stale.
```
{
  path: "util.ts",
  edits: [{
    op: "replace",
    pos: {{hlineref 15 "\t\tconsole.error(err);"}},
    end: {{hlineref 16 "\t\treturn null;"}},
    lines: [
      "\t\tif (isEnoent(err)) return null;",
      "\t\tthrow err;"
    ]
  }]
}
```
</example>

<example name="replace whole block — shape (b)">
Simplify `beta()` to a one-liner. Shape (b): `pos`=header, `end`=closer, re-emit all in `lines`.

Bad — `end` stops at the inner `\t}` on line 17, so the outer `}` on line 18 survives. Result: two consecutive `}` lines.
```
{
  path: "util.ts",
  edits: [{
    op: "replace",
    pos: {{hlineref 9 "function beta() {"}},
    end: {{hlineref 17 "\t}"}},
    lines: [
      "function beta() {",
      "\treturn parse(data);",
      "}"
    ]
  }]
}
```
Good — `end` includes the function's own `}` on line 18, so the old closer is consumed:
```
{
  path: "util.ts",
  edits: [{
    op: "replace",
    pos: {{hlineref 9 "function beta() {"}},
    end: {{hlineref 18 "}"}},
    lines: [
      "function beta() {",
      "\treturn parse(data);",
      "}"
    ]
  }]
}
```
</example>

<example name="avoid shared boundary lines">
Do not anchor `replace` on a mixed boundary line such as `} catch (err) {`, `} else {`, `}),`, or `},{`. Those lines belong to two adjacent structures at once.

Bad — if you need to change code on both sides of that line, replacing just the boundary span will usually leave one side's syntax behind.

Good — choose one of two safe shapes instead:
- move inward and replace only body-owned lines
- expand outward and replace one whole owned block, consuming its real closer/separator too
</example>

<example name="insert between sibling declarations">
Add a `gamma()` function between `alpha()` and `beta()`. Use `prepend` on the next declaration — not `append` on the previous block's closing brace — so the anchor is a stable declaration boundary.
```
{
  path: "util.ts",
  edits: [{
    op: "prepend",
    pos: {{hlineref 9 "function beta() {"}},
    lines: [
      "function gamma() {",
      "\tvalidate();",
      "}",
      ""
    ]
  }]
}
```
Use a trailing `""` to preserve the blank line between sibling declarations.
</example>
</examples>

<critical>
- You **MUST NOT** use this tool to reformat, reindent, or adjust whitespace — run the project's formatter instead.
- Every tag **MUST** be copied exactly from your most recent `read` output as `N#ID`. Stale or mistyped tags cause mismatches.
- Edit payload: `{ path, edits[] }`. Each entry: `op`, `lines`, optional `pos`/`end`. No extra keys.
- For `append`/`prepend`, `lines` **MUST** contain only the newly introduced content. Do not re-emit surrounding content, or terminators that already exist.
- When changing existing code near a block tail or closing delimiter, default to `replace` over the owned span instead of inserting around the boundary.
- When adding a sibling declaration, default to `prepend` on the next sibling declaration instead of `append` on the previous block's closing brace.
- **Block boundaries travel together.** For a block `{ header / body / closer }`, there are exactly two valid replace shapes: (a) replace only the body — `pos`=first body line, `end`=last body line, leave the header and closer untouched; or (b) replace the whole block — `pos`=header, `end`=closer, re-emit all three in `lines`. Never split them: do not set `end` to the closer while omitting it from `lines` (deletes it), and do not emit the closer in `lines` without including it in `end` (duplicates it). This applies to every block terminator: `}`, `continue`, `break`, `return`, `throw`.
- **Never target shared boundary lines.** Do not use `replace` spans that start, end, or pivot on a line that closes one construct and opens/separates another, such as `},{`, `}),`, `} else {`, or `} catch (err) {`. Those lines are not owned by a single block. Move the range inward to body-only lines, or widen it to consume one whole owned construct including its true trailing delimiter.
- **`lines` must not extend past `end`.** `lines` replaces exactly `pos..end`. Content after `end` survives. If you include lines in `lines` that exist after `end`, they will appear twice. Either extend `end` to cover all lines you are re-emitting, or remove the extra lines from `lines`.
- `lines` entries **MUST** be literal file content with indentation copied exactly from the `read` output. If the file uses tabs, use a real tab character.
- After any successful `edit` call on a file, the next change to that same file **MUST** start with a fresh `read`. Do not chain a second `edit` call off stale mental state, even if the intended range is nearby.
- If you need a second change in the same local region, default to one wider `replace` over the whole owned block instead of a sequence of micro-edits on adjacent lines. Repeated small patches in a moving region are unstable.
- If a local region is already malformed or a prior patch partially landed, stop nibbling at it. Re-read the file and replace the full owned block from a stable boundary; for a small file, prefer rewriting the file over stacking more tiny repairs.
</critical>