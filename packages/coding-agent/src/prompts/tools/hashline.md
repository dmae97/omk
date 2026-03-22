Applies precise file edits using `LINE#ID` anchors from `read` output.

Read the file first. Copy anchors exactly from the latest `read` output. In one `edit` call, batch all edits for one file. After any successful edit, re-read before editing that file again.

This matters: your output is checked against the real file state. Invalid anchors, invalid op/field combinations, duplicated boundary lines, or semantically equivalent rewrites will fail.

<operations>
**Top level**
- `path` — file path
- `move` — optional rename target
- `delete` — optional whole-file delete
- `edits` — array of edit entries

**Edit entry shape**
Each entry is:
- `op` — one of `replace_line`, `replace_range`, `append_at`, `prepend_at`, `append_file`, `prepend_file`
- `lines` — replacement/inserted content
- `pos` — required for `replace_line`, `replace_range`, `append_at`, `prepend_at`
- `end` — required only for `replace_range`

**Meaning**
- `replace_line`: replace exactly one anchored line
- `replace_range`: replace inclusive `pos..end`
- `append_at`: insert after `pos`
- `prepend_at`: insert before `pos`
- `append_file`: insert at end of file
- `prepend_file`: insert at beginning of file

**`lines`**
- Array of literal file lines is preferred
- `""` means a blank line
- `null` or `[]` deletes for `replace_line` / `replace_range`
- For insert ops, `lines` must contain only the new content
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

<example name="replace one line">
```
{
  path: "util.ts",
  edits: [{
    op: "replace_line",
    pos: {{hlineref 2 "const timeout = 5000;"}},
    lines: ["const timeout = 30_000;"]
  }]
}
```
</example>

<example name="delete a range">
```
{
  path: "util.ts",
  edits: [{
    op: "replace_range",
    pos: {{hlineref 10 "\t// TODO: remove after migration"}},
    end: {{hlineref 11 "\tlegacy();"}},
    lines: null
  }]
}
```
</example>

<example name="replace a block body">
Replace only the catch body. Do not target the shared boundary line `} catch (err) {`.
```
{
  path: "util.ts",
  edits: [{
    op: "replace_range",
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

<example name="insert before sibling">
When adding a sibling declaration, prefer `prepend_at` on the next declaration.
```
{
  path: "util.ts",
  edits: [{
    op: "prepend_at",
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
- Make the minimum exact edit. Do not rewrite nearby code unless the consumed range requires it.
- Use anchors exactly as `N#ID` from the latest `read` output.
- `replace_range` requires both `pos` and `end`. All other anchored ops require `pos` only.
- `append_file` and `prepend_file` do not take anchors.
- Replace exactly the owned span. If `lines` re-emits content beyond `end`, it will duplicate.
- Do not target shared boundary lines such as `} else {`, `} catch (…) {`, `}),`, or `},{`.
- For a block, either replace only the body or replace the whole block. Do not split block boundaries.
- `lines` must be literal file content with matching indentation. If the file uses tabs, use real tabs.
- Do not use this tool to reformat or clean up unrelated code.
</critical>