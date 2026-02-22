# Edit

Apply precise file edits using `LINE#ID` tags from `read` output.

<workflow>
1. You SHOULD issue a `read` call before editing if you have no tagged context for a file.
2. You MUST pick the smallest operation per change site.
3. You MUST submit one `edit` call per file with all operations, think your changes through before submitting.
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
- `{ file: "…", edits: [{ op: "replace", pos: "N#ID", lines: null }] }` — delete one line
- `{ file: "…", edits: [{ op: "replace", pos: "N#ID", end: "M#ID", lines: null }] }` — delete a range
- `{ file: "…", edits: [{ op: "replace", pos: "N#ID", lines: […] }] }` — replace one line
- `{ file: "…", edits: [{ op: "replace", pos: "N#ID", end: "M#ID", lines: […] }] }` — replace a range

### Insert new lines
- `{ file: "…", edits: [{ op: "prepend", pos: "N#ID", lines: […] }] }` — insert before tagged line
- `{ file: "…", edits: [{ op: "prepend", lines: […] }] }` — insert at beginning of file (no tag)
- `{ file: "…", edits: [{ op: "append", pos: "N#ID", lines: […] }] }` — insert after tagged line
- `{ file: "…", edits: [{ op: "append", lines: […] }] }` — insert at end of file (no tag)

### File-level controls
- `{ file: "…", delete: true, edits: [] }` — delete the file
- `{ file: "…", move: "new/path.ts", edits: […] }` — move file to new path (edits applied first)
**Atomicity:** all ops in one call validate against the same pre-edit snapshot; tags reference the last `read`. Edits are applied bottom-up, so earlier tags stay valid even when later ops add or remove lines.
</operations>

<rules>
1. **Minimize scope:** You MUST use one logical mutation per operation.
2. **No no-ops:** replacement MUST differ from current.
3. **Prefer insertion over neighbor rewrites:** You SHOULD anchor on structural boundaries (`}`, `]`, `},`), not interior lines.
4. **For swaps/moves:** You SHOULD prefer one range op over multiple single-line ops.
</rules>

<recovery>
**Tag mismatch (`>>>`):** You MUST retry using fresh tags from the error snippet. Re-read only if snippet lacks context.
**No-op (`identical`):** You MUST NOT resubmit. Re-read target lines and adjust the edit.
</recovery>

<example name="single-line replace">
```ts
{{hlinefull 23 "  const timeout: number = 5000;"}}
```
```
{
  file: "…",
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
  file: "…",
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
  file: "…",
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
  file: "…",
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
  file: "…",
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

<example name="insert between siblings">
```ts
{{hlinefull 44 "  \"build\": \"bun run compile\","}}
{{hlinefull 45 "  \"test\": \"bun test\""}}
```
```
{
  file: "…",
  edits: [{
    op: "prepend",
    pos: "{{hlineref 45 "  \"test\": \"bun test\""}}",
    lines: ["  \"lint\": \"biome check\","]
  }]
}
```
Result:
```ts
{{hlinefull 44 "  \"build\": \"bun run compile\","}}
{{hlinefull 45 "  \"lint\": \"biome check\","}}
{{hlinefull 46 "  \"test\": \"bun test\""}}
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
  file: "…",
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
- Edit payload: `{ file, edits[] }`. Each entry: `op`, `lines`, optional `pos`/`end`. No extra keys.
- Every tag MUST be copied exactly from fresh tool result as `N#ID`.
- You MUST re-read after each edit call before issuing another on same file.
</critical>