Applies precise, surgical file edits by referencing `LINE#ID` tags from `read` output. Each tag uniquely identifies a line, so edits remain stable even when lines shift.

<critical>
- Never anchor insertions on blank lines or lone closing delimiters like `}`, `]`, `)`, `};`, or `),` — they are mechanically valid tags but semantically unstable edit boundaries.
- For `append`/`prepend`, `lines` **MUST** contain only the newly introduced content. Do not re-emit surrounding braces, brackets, parentheses, or sibling declarations that already exist in the file.
- `append`/`prepend` are for self-contained new content only: sibling declarations, new object/list members, new test cases, or similar additions whose surrounding structure stays unchanged.
- When changing existing code near a block tail or closing delimiter, default to `replace` over the owned span instead of inserting around the boundary.
- When adding a sibling declaration, default to `prepend` on the next sibling declaration instead of `append` on the previous block's closing brace.
- If any inserted line is just a closing delimiter, stop and re-check the edit shape. A closing line is only valid when it belongs to newly introduced structure; if it belongs to surrounding existing structure, your edit should be a `replace` that consumes the old boundary.
</critical>

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
4. **Am I editing near a block tail or closing delimiter?** If yes, expand the edit to own that tail instead of patching just the last line or two.
5. **Does `lines` contain only new content?** For `append`/`prepend`, do not include existing closing braces or other surrounding syntax from the file.
6. **Would the replacement duplicate the line immediately after `end`?** If yes, extend the range to consume the old boundary.
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

Tags are applied bottom-up: later edits (by position) are applied first, so earlier tags remain valid even when subsequent ops add or remove lines. Tags **MUST** be referenced from the most recent `read` output.
</operations>

<rules>
1. **Anchor on unique declaration or header lines, not delimiters.** Safe anchors are lines like `function beta() {`, `if (…) {`, `const value =`, or other unique structural headers. Blank lines and lone closers like `}` are never good insertion anchors.
2. **Use `prepend`/`append` only for self-contained additions whose surrounding structure stays unchanged.** If you are adding a sibling declaration, prefer `prepend` on the next sibling declaration instead of `append` on the previous block closer.
3. **If the change touches existing code near a block tail, use range `replace` over the owned span.** Do not patch just the final line(s) before a closing delimiter when the surrounding structure, indentation, or control flow is also changing.
4. **Match surrounding indentation for new lines.** When inserting via `prepend`/`append`, look at the anchor line and its neighbors in the `read` output. New `lines` entries **MUST** carry the same leading whitespace. If the context uses tabs at depth 1 (`\t`), your inserted declarations need `\t` and bodies need `\t\t`. Inserting at indent level 0 inside an indented block is always wrong.
5. **Consume the old closing boundary when your replacement emits one.** If the replacement's final line is a closing delimiter like `}`, `]`, or `)`, the `end` line **MUST** include the original matching closer that would otherwise remain in the file. Before submitting, compare the replacement's last line with the line immediately after `end`; if they would be the same boundary, extend the range so the old closer is removed.
6. **If you expect a second tiny cleanup edit for `}`, `};`, indentation, or a duplicated boundary, your first edit shape is wrong.** Expand the first `replace` so it owns the structural tail in one shot.
</rules>

<recovery>
Edits can fail in two ways. Here is exactly what to do for each:
1. **Tag mismatch (`>>>`):** The file changed since your last read, so the tag no longer matches. You **MUST** retry using the fresh tags from the error snippet. If the snippet lacks enough context, or if you fail repeatedly, you **MUST** re-read the entire file and submit a simpler, single-op edit.
2. **No-op (`identical`):** Your replacement is identical to the existing content — nothing changed. You **MUST NOT** resubmit the same edit. Re-read the target lines to understand what is actually there, then adjust your edit.
</recovery>

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

<example name="rewrite a block">
Replace the catch body with smarter error handling:
```
{
  path: "util.ts",
  edits: [{
    op: "replace",
    pos: {{hlineref 15 "\t\tconsole.error(err);"}},
    end: {{hlineref 17 "\t}"}},
    lines: [
      "\t\tif (isEnoent(err)) return null;",
      "\t\tthrow err;",
      "\t}"
    ]
  }]
}
```
</example>

<example name="own the block tail instead of patching around it">
When changing the tail of an existing block, replace the owned span instead of appending just before the closer.

Bad — appending a new return before the existing closer leaves the old tail in place and often leads to a second cleanup edit:
```
{
  path: "util.ts",
  edits: [{
    op: "append",
    pos: {{hlineref 16 "\t\treturn null;"}},
    lines: [
      "\t\treturn fallback;"
    ]
  }]
}
```
Good — replace the block tail so the new logic and the closing boundary are owned by one edit:
```
{
  path: "util.ts",
  edits: [{
    op: "replace",
    pos: {{hlineref 15 "\t\tconsole.error(err);"}},
    end: {{hlineref 17 "\t}"}},
    lines: [
      "\t\tif (isEnoent(err)) return null;",
      "\t\treturn fallback;",
      "\t}"
    ]
  }]
}
```
</example>

<example name="inclusive end avoids duplicate boundary">
Simplify `beta()` to a one-liner. `end` must include the original closing `}` when the replacement also ends with `}`.

Bad — `end` stops at line 17 (`\t}`), so the replacement adds `}` and the original function closer on line 18 survives. Result: two consecutive `}` lines.
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
Good — include the function's own `}` on line 18 in the range, so the old closing boundary is consumed:
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
- Edit payload: `{ path, edits[] }`. Each entry: `op`, `lines`, optional `pos`/`end`. No extra keys.
- Every tag **MUST** be copied exactly from your most recent `read` output as `N#ID`. Stale or mistyped tags cause mismatches.
- You **MUST** re-read the file after each edit call before issuing another on the same file. Tags shift after every edit, so reusing old tags produces mismatches.
- You **MUST NOT** use this tool to reformat, reindent, or adjust whitespace — run the project's formatter instead. If the only difference is whitespace, it is formatting; leave it alone.
- `lines` entries **MUST** be literal file content with indentation copied exactly from the `read` output. If the file uses tabs, use `\t` in JSON (a real tab character). Using `\\t` (backslash + t) writes the literal two-character string `\t` into the file.
- For `append`/`prepend`, `lines` **MUST NOT** repeat surrounding delimiters or existing sibling code. Insert only the new content.
- Before any range `replace`, you **MUST** check whether the replacement's last line duplicates the original line immediately after `end` (most often a closing `}`, `]`, or `)`). If it does, extend the range to consume that old boundary instead of leaving two closers behind.
</critical>