Applies precise file edits using `LINE#ID` tags from `read` output.

<workflow>
1. You **SHOULD** issue a `read` call before editing if you have no tagged context for a file.
2. You **MUST** pick the smallest operation per change site.
3. You **MUST** submit one `edit` call per file with all operations, think your changes through before submitting.
</workflow>

<operations>
**`path`** — the path to the file to edit.
**`move`** — if set, move the file to the given path.
**`delete`** — if true, delete the file.
**`edits.[n].pos`** — the anchor line. Meaning depends on `op`:
- `replace`: start of range (or the single line to replace)
- `prepend`: insert new lines **before** this line; omit for beginning of file
- `append`: insert new lines **after** this line; omit for end of file
**`edits.[n].end`** — range replace only. The last line of the range (inclusive). Omit for single-line replace.
**`edits.[n].lines`** — the replacement content:
- `["line1", "line2"]` — replace with these lines (array of strings)
- `"line1"` — shorthand for `["line1"]` (single-line replace)
- `[""]` — replace content with a blank line (line preserved, content cleared)
- `null` or `[]` — **delete** the line(s) entirely

Tags should be referenced from the last `read` output.
Edits are applied bottom-up, so earlier tags stay valid even when later ops add or remove lines.
</operations>

<rules>
1. **Minimize scope:** You **MUST** use one logical mutation per operation.
2. **Prefer insertion over neighbor rewrites:** You **SHOULD** anchor on structural boundaries (`}`, `]`, `},`), not interior lines.
3. **Range end tag (inclusive):** `end` is inclusive and **MUST** point to the final line being replaced.
   - If `lines` includes a closing boundary token (`}`, `]`, `)`, `);`, `},`), `end` **MUST** include the original boundary line.
   - You **MUST NOT** set `end` to an interior line and then re-add the boundary token in `lines`; that duplicates the next surviving line.
</rules>

<recovery>
**Tag mismatch (`>>>`):** You **MUST** retry using fresh tags from the error snippet. If snippet lacks context, or if you repeatedly fail, you **MUST** re-read the file and issue less ambitious edits, i.e. single op.
**No-op (`identical`):** You **MUST NOT** resubmit. Re-read target lines and adjust the edit.
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
Also apply the same rule to `);`, `],`, and `},` closers: if replacement includes the closer token, `end` must include the original closer line.
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
Blank lines and repeated patterns (`}`, `return null;`) appear many times — never anchor on them when a unique line exists nearby.
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
- Every tag **MUST** be copied exactly from fresh tool result as `N#ID`.
- You **MUST** re-read after each edit call before issuing another on same file.
- Formatting is a batch operation. You **MUST NOT** use this tool to reformat, reindent, or adjust whitespace — run the project's formatter instead. If the only change is whitespace, it is formatting; do not touch it.
- `lines` entries **MUST** be literal file content with indentation copied exactly from the `read` output. If the file uses tabs, use `\t` in JSON (a real tab character) — you **MUST NOT** use `\\t` (two characters: backslash + t), which produces the literal string `\t` in the file.
</critical>