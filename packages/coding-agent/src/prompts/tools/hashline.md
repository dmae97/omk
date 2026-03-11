Applies precise, surgical file edits by referencing `LINE#ID` tags from `read` output. Each tag uniquely identifies a line, so edits remain stable even when lines shift.

<workflow>
Follow these steps in order for every edit:
1. You **SHOULD** issue a `read` call before editing to get fresh `LINE#ID` tags. Editing without current tags causes mismatches because other edits or external changes may have shifted line numbers since your last read.
2. You **MUST** submit one `edit` call per file with all operations. Multiple calls to the same file require re-reading between each one (tags shift after each edit), so batching avoids wasted round-trips. Think your changes through before submitting.
3. You **MUST** pick the operation that matches the owning structure, not merely the smallest textual diff. Use the smallest operation only when it still cleanly owns the changed syntax. If a tiny edit would patch around a block tail, delimiter, or neighboring structural line, expand it to the semantically correct `replace` span instead.
</workflow>

<checklist>
Before choosing the payload, answer these questions in order:
1. **Am I replacing existing lines or inserting new ones?** If any existing line changes, use `replace` for the full changed span.
2. **What declaration or block owns this anchor line?** Prefer declaration/header lines over blank lines or delimiters.
3. **Am I inserting self-contained new content, or changing an existing block?** Use `append`/`prepend` only for self-contained additions. If surrounding code, indentation, or closers also change, use `replace`.
4. **Am I editing near a block tail or closing delimiter?** If yes, use shape (a) or (b) from the block-boundaries rule: either stay entirely inside the body, or own the full block including header and closer. Never set `end` at a closer without re-emitting it, and never re-emit a closer without including it in `end`.
</checklist>

<operations>
**`path`** — the path to the file to edit.
**`move`** — if set, move the file to the given path.
**`delete`** — if true, delete the file.

**`edits[n].pos`** — the anchor line. Meaning depends on `op`:
  - if `replace`: line to rewrite
  - if `prepend`: line to insert new lines **before**; omit for beginning of file
  - if `append`: line to insert new lines **after**; omit for end of file
**`edits[n].end`** — range replace only. The last line of the range (inclusive). Omit for single-line replace.
**`edits[n].lines`** — the replacement content:
  - `["line1", "line2"]` — insert `line1` and `line2`
  - `[""]` — blank line
  - `null` or `[]` — delete if replace, no-op if append or prepend

`replace` substitutes **exactly** the `pos..end` range (inclusive). Everything before `pos` and after `end` is preserved untouched. If `lines` contains content that already exists after `end`, those lines **will be duplicated** in the output. Keep `lines` to exactly what belongs inside the consumed range.

Ops are applied bottom-up. Tags **MUST** be referenced from the most recent `read` output.
</operations>

<rules>
1. **Use `prepend`/`append` only for self-contained additions whose surrounding structure stays unchanged.** If you are adding a sibling declaration, prefer `prepend` on the next sibling declaration instead of `append` on the previous block closer.
2. **If the change touches existing code near a block tail, use range `replace` over the owned span.** Do not patch just the final line(s) before a closing delimiter when the surrounding structure, indentation, or control flow is also changing.
3. **Match surrounding indentation for new lines.** When inserting via `prepend`/`append`, look at the anchor line and its neighbors in the `read` output. New `lines` entries **MUST** carry the same leading whitespace. If the context uses tabs at depth 1 (`\t`), your inserted declarations need `\t` and bodies need `\t\t`. Inserting at indent level 0 inside an indented block is always wrong.
4. **Block boundaries travel together — never split them.** See the block-boundaries rule in `<critical>`. The two valid shapes are: replace only the body (leave header and closer untouched), or replace the whole block (header through closer, re-emit all in `lines`). Do not set `end` to a closer and omit it from `lines` (deletes it). Do not emit a closer in `lines` without including it in `end` (duplicates it).
</rules>

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

<example name="clear text but keep the line break">
Blank out a line without removing it:
```
{
  path: "util.ts",
  edits: [{
    op: "replace",
    pos: {{hlineref 3 "const tag = \"DO NOT SHIP\";"}},
    lines: [""]
  }]
}
```
</example>

<example name="delete a single line from a block">
Remove just the TODO comment (line 10) from `beta()` without touching anything else:
```
{
  path: "util.ts",
  edits: [{
    op: "replace",
    pos: {{hlineref 10 "\t// TODO: remove after migration"}},
    lines: null
  }]
}
```
Do **not** widen the range and re-emit surrounding lines when a single-line delete suffices.
</example>

<example name="rewrite a block body — shape (a)">
Replace the catch body with smarter error handling. Shape (a): `pos` is the first body line, `end` is the last body line. The catch header (line 14) and its closer (line 17) are outside the range and stay untouched.
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

<example name="span the full body, not a single line">
When changing body content, replace the entire body span — not just one line inside it. Patching one line leaves the rest of the body stale.

Bad — appends after one body line, leaving the original `return null` in place:
```
{
  path: "util.ts",
  edits: [{
    op: "append",
    pos: {{hlineref 15 "\t\tconsole.error(err);"}},
    lines: [
      "\t\treturn fallback;"
    ]
  }]
}
```
Good — shape (a): replace the full body span. Header and closer stay untouched:
```
{
  path: "util.ts",
  edits: [{
    op: "replace",
    pos: {{hlineref 15 "\t\tconsole.error(err);"}},
    end: {{hlineref 16 "\t\treturn null;"}},
    lines: [
      "\t\tif (isEnoent(err)) return null;",
      "\t\treturn fallback;"
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

<example name="insert between sibling declarations">
Add a `gamma()` function between `alpha()` and `beta()`:
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

<example name="avoid closer anchors">
When inserting a sibling declaration, do not anchor on the previous block's lone closing brace. Anchor on the next declaration instead.

Bad — appending after line 7 (`}`) happens to land in the gap today, but the anchor is still the previous function's closer rather than a stable declaration boundary:
```
{
  path: "util.ts",
  edits: [{
    op: "append",
    pos: {{hlineref 7 "}"}},
    lines: [
      "",
      "function gamma() {",
      "\tvalidate();",
      "}"
    ]
  }]
}
```
Good — prepend before the next declaration so the new sibling is anchored on a declaration header, not a block tail:
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
- **`lines` must not extend past `end`.** `lines` replaces exactly `pos..end`. Content after `end` survives. If you include lines in `lines` that exist after `end`, they will appear twice. Either extend `end` to cover all lines you are re-emitting, or remove the extra lines from `lines`.
- `lines` entries **MUST** be literal file content with indentation copied exactly from the `read` output. If the file uses tabs, use a real tab character.
</critical>