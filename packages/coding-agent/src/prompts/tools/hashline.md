Applies precise, surgical file edits by referencing `LINE#ID` tags from `read` output. Each tag uniquely identifies a line, so edits remain stable even when lines shift.

<workflow>
Follow these steps in order for every edit:
1. You **SHOULD** issue a `read` call before editing to get fresh `LINE#ID` tags. Editing without current tags causes mismatches because other edits or external changes may have shifted line numbers since your last read.
2. You **MUST** submit one `edit` call per file with all operations. Multiple calls to the same file require re-reading between each one (tags shift after each edit), so batching avoids wasted round-trips. Think your changes through before submitting.
3. You **MUST** pick the smallest operation per change site. Each operation should be one logical mutation — a single replace, insert, or delete. Combining unrelated changes into one operation makes errors harder to diagnose and recover from.
</workflow>

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
1. **Anchor on unique, structural lines.** When inserting between blocks, anchor on the nearest unique declaration using `prepend` or `append`.
2. **Use `prepend`/`append` only when the anchor line itself is not changing.** Inserting near an unchanged boundary keeps the edit minimal.
3. **Use range `replace` when any line in the span changes.** If you need to both insert lines and modify a neighboring line, a range replace covering all lines to remove is way to go.
</rules>

<recovery>
Edits can fail in two ways. Here is exactly what to do for each:
1. **Tag mismatch (`>>>`):** The file changed since your last read, so the tag no longer matches. You **MUST** retry using the fresh tags from the error snippet. If the snippet lacks enough context, or if you fail repeatedly, you **MUST** re-read the entire file and submit a simpler, single-op edit.
2. **No-op (`identical`):** Your replacement is identical to the existing content — nothing changed. You **MUST NOT** resubmit the same edit. Re-read the target lines to understand what is actually there, then adjust your edit.
</recovery>

<example name="single-line replace">
```ts
{{hlinefull 23 "  const timeout: number = 5000;"}}
```
```
{
  path: "…",
  edits: [{
    op: "replace",
    pos: {{hlineref 23 "  const timeout: number = 5000;"}},
    lines: ["  const timeout: number = 30_000;"]
  }]
}
```
</example>

<example name="delete lines">
Single line — `lines: null` deletes entirely:
```
{
  path: "…",
  edits: [{
    op: "replace",
    pos: {{hlineref 7 "// @ts-ignore"}},
    lines: null
  }]
}
```
Range — add `end`:
```
{
  path: "…",
  edits: [{
    op: "replace",
    pos: {{hlineref 80 "  // TODO: remove after migration"}},
    end: {{hlineref 83 "  }"}},
    lines: null
  }]
}
```
</example>

<example name="clear text but keep the line break">
```ts
{{hlinefull 14 "  placeholder: \"DO NOT SHIP\","}}
```
```
{
  path: "…",
  edits: [{
    op: "replace",
    pos: {{hlineref 14 "  placeholder: \"DO NOT SHIP\","}},
    lines: [""]
  }]
}
```
</example>

<example name="rewrite a block">
```ts
{{hlinefull 60 "    } catch (err) {"}}
{{hlinefull 61 "      console.error(err);"}}
{{hlinefull 62 "      return null;"}}
{{hlinefull 63 "    }"}}
```
```
{
  path: "…",
  edits: [{
    op: "replace",
    pos: {{hlineref 61 "      console.error(err);"}},
    end: {{hlineref 63 "    }"}},
    lines: [
      "      if (isEnoent(err)) return null;",
      "      throw err;",
      "    }"
    ]
  }]
}
```
</example>

<example name="inclusive end avoids duplicate boundary">
This example demonstrates why `end` must include the original closing line when your replacement also contains that closer.
```ts
{{hlinefull 70 "if (ok) {"}}
{{hlinefull 71 "  run();"}}
{{hlinefull 72 "}"}}
{{hlinefull 73 "after();"}}
```
Bad — `end` stops before `}` while `lines` already includes `}`:
```
{
  path: "…",
  edits: [{
    op: "replace",
    pos: {{hlineref 70 "if (ok) {"}},
    end: {{hlineref 71 "  run();"}},
    lines: [
      "if (ok) {",
      "  runSafe();",
      "}"
    ]
  }]
}
```
Good — include original `}` in the replaced range when replacement keeps `}`:
```
{
  path: "…",
  edits: [{
    op: "replace",
    pos: {{hlineref 70 "if (ok) {"}},
    end: {{hlineref 72 "}"}},
    lines: [
      "if (ok) {",
      "  runSafe();",
      "}"
    ]
  }]
}
```
</example>

<example name="insert between sibling declarations">
```ts
{{hlinefull 44 "function x() {"}}
{{hlinefull 45 "  runX();"}}
{{hlinefull 46 "}"}}
{{hlinefull 47 ""}}
{{hlinefull 48 "function y() {"}}
{{hlinefull 49 "  runY();"}}
{{hlinefull 50 "}"}}
```
```
{
  path: "…",
  edits: [{
    op: "prepend",
    pos: {{hlineref 48 "function y() {"}},
    lines: [
      "function z() {",
      "  runZ();",
      "}",
      ""
    ]
  }]
}
```
Use a trailing `""` to preserve the blank line between top-level sibling declarations.
</example>

<example name="disambiguate anchors">
Blank lines and repeated patterns (`}`, `return null;`) appear many times. Always anchor on a unique line nearby instead.
```ts
{{hlinefull 101 "}"}}
{{hlinefull 102 ""}}
{{hlinefull 103 "export function serialize(data: unknown): string {"}}
```
Bad — anchoring on the blank line (ambiguous, may shift):
```
{
  path: "…",
  edits: [{
    op: "append",
    pos: {{hlineref 102 ""}},
    lines: [
      "function validate(data: unknown): boolean {",
      "  return data != null && typeof data === \"object\";",
      "}",
      ""
    ]
  }]
}
```
Good — anchor on the unique declaration line:
```
{
  path: "…",
  edits: [{
    op: "prepend",
    pos: {{hlineref 103 "export function serialize(data: unknown): string {"}},
    lines: [
      "function validate(data: unknown): boolean {",
      "  return data != null && typeof data === \"object\";",
      "}",
      ""
    ]
  }]
}
```
</example>

<critical>
- Edit payload: `{ path, edits[] }`. Each entry: `op`, `lines`, optional `pos`/`end`. No extra keys.
- Every tag **MUST** be copied exactly from your most recent `read` output as `N#ID`. Stale or mistyped tags cause mismatches.
- You **MUST** re-read the file after each edit call before issuing another on the same file. Tags shift after every edit, so reusing old tags produces mismatches.
- You **MUST NOT** use this tool to reformat, reindent, or adjust whitespace — run the project's formatter instead. If the only difference is whitespace, it is formatting; leave it alone.
- `lines` entries **MUST** be literal file content with indentation copied exactly from the `read` output. If the file uses tabs, use `\t` in JSON (a real tab character). Using `\\t` (backslash + t) writes the literal two-character string `\t` into the file.
</critical>