Applies precise file edits using `LINE#ID` tags from `read` output.

<workflow>
1. You **SHOULD** issue a `read` call before editing if you have no tagged context for a file.
2. You **MUST** pick the smallest operation per change site.
3. You **MUST** submit one `edit` call per file with all operations, think your changes through before submitting.
</workflow>

<operations>
Every edit has `op`, `pos`, and `lines`. Range replaces also have `end`. Both `pos` and `end` use `"N#ID"` format (e.g. `"23#XY"`).
**`pos`** — the anchor line. Meaning depends on `op`:
- `replace`: start of range (or the single line to replace)
- `prepend`: insert new lines **before** this line; omit for beginning of file
- `append`: insert new lines **after** this line; omit for end of file
**`end`** — range replace only. The last line of the range (inclusive). Omit for single-line replace.
**`lines`** — the replacement content:
- `["line1", "line2"]` — replace with these lines (array of strings)
- `"line1"` — shorthand for `["line1"]` (single-line replace)
- `[""]` — replace content with a blank line (line preserved, content cleared)
- `null` or `[]` — **delete** the line(s) entirely

### Line or range replace/delete
- `{ path: "…", edits: [{ op: "replace", pos: "N#ID", lines: null }] }` — delete one line
- `{ path: "…", edits: [{ op: "replace", pos: "N#ID", end: "M#ID", lines: null }] }` — delete a range
- `{ path: "…", edits: [{ op: "replace", pos: "N#ID", lines: […] }] }` — replace one line
- `{ path: "…", edits: [{ op: "replace", pos: "N#ID", end: "M#ID", lines: […] }] }` — replace a range

### Insert new lines
- `{ path: "…", edits: [{ op: "prepend", pos: "N#ID", lines: […] }] }` — insert before tagged line
- `{ path: "…", edits: [{ op: "prepend", lines: […] }] }` — insert at beginning of file (no tag)
- `{ path: "…", edits: [{ op: "append", pos: "N#ID", lines: […] }] }` — insert after tagged line
- `{ path: "…", edits: [{ op: "append", lines: […] }] }` — insert at end of file (no tag)

### File-level controls
- `{ path: "…", delete: true, edits: [] }` — delete the file
- `{ path: "…", move: "new/path.ts", edits: […] }` — move file to new path (edits applied first)
**Atomicity:** all ops in one call validate against the same pre-edit snapshot; tags reference the last `read`. Edits are applied bottom-up, so earlier tags stay valid even when later ops add or remove lines.
</operations>

<rules>
1. **Minimize scope:** You **MUST** use one logical mutation per operation.
2. **Prefer insertion over neighbor rewrites:** You **SHOULD** anchor on structural boundaries (`}`, `]`, `},`), not interior lines.
3. **Range end tag (inclusive):** `end` is inclusive and **MUST** point to the final line being replaced.
   - If `lines` includes a closing boundary token (`}`, `]`, `)`, `);`, `},`), `end` **MUST** include the original boundary line.
   - You **MUST NOT** set `end` to an interior line and then re-add the boundary token in `lines`; that duplicates the next surviving line.
   - To remove a line while keeping its neighbors, **delete** it (`lines: null`). You **MUST NOT** replace it with the content of an adjacent line — that line still exists and will be duplicated.
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
    pos: "{{hlineref 23 "  const timeout: number = 5000;"}}",
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
    pos: "{{hlineref 7 "// @ts-ignore"}}",
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
    pos: "{{hlineref 80 "  // TODO: remove after migration"}}",
    end: "{{hlineref 83 "  }"}}",
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
    pos: "{{hlineref 14 "  placeholder: \"DO NOT SHIP\","}}",
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
    pos: "{{hlineref 60 "    } catch (err) {"}}",
    end: "{{hlineref 63 "    }"}}",
    lines: [
      "    } catch (err) {",
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
    pos: "{{hlineref 70 "if (ok) {"}}",
    end: "{{hlineref 71 "  run();"}}",
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
    pos: "{{hlineref 70 "if (ok) {"}}",
    end: "{{hlineref 72 "}"}}",
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
    pos: "{{hlineref 48 "function y() {"}}",
    lines: [
      "function z() {",
      "  runZ();",
      "}",
      ""
    ]
  }]
}
```
Result:
```ts
{{hlinefull 44 "function x() {"}}
{{hlinefull 45 "  runX();"}}
{{hlinefull 46 "}"}}
{{hlinefull 47 ""}}
{{hlinefull 48 "function z() {"}}
{{hlinefull 49 "  runZ();"}}
{{hlinefull 50 "}"}}
{{hlinefull 51 ""}}
{{hlinefull 52 "function y() {"}}
{{hlinefull 53 "  runY();"}}
{{hlinefull 54 "}"}}
```
</example>

<example name="anchor to structure, not whitespace">
Trailing `""` in `lines` preserves blank-line separators. Anchor to the structural line, not the blank line above — blank lines are ambiguous and shift.
```ts
{{hlinefull 101 "}"}}
{{hlinefull 102 ""}}
{{hlinefull 103 "export function serialize(data: unknown): string {"}}
```
Bad — append after "}"
Good — anchors to structural line:
```
{
  path: "…",
  edits: [{
    op: "prepend",
    pos: "{{hlineref 103 "export function serialize(data: unknown): string {"}}",
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
- Formatting is a batch operation. You **MUST** never use this tool for formatting.
- `lines` entries **MUST** be literal file content with real space indentation. (`\\t` in JSON inserts a literal backslash-t into the file, not a tab.)
</critical>