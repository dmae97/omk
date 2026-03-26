Applies precise file edits using `LINE#ID` anchors from `read` output.

Read the file first. Copy anchors exactly from the latest `read` output. In one `edit` call, batch all edits for one file. After any successful edit, re-read before editing that file again.

<operations>
**Top level**
- `path` — file path
- `move` — optional rename target
- `delete` — optional whole-file delete
- `edits` — array of `{ loc, content }` entries

**Edit entry**: `{ loc, content }`
- `loc` — where to apply the edit (see below)
- `content` — replacement/inserted lines (array of strings preferred, `null` to delete)

**`loc` values**
- `"append"` / `"prepend"` — insert at end/start of file
- `{ append: "N#ID" }` / `{ prepend: "N#ID" }` — insert after/before anchored line
- `{ line: "N#ID" }` — replace exactly one anchored line
- `{ block: { pos: "N#ID", end: "N#ID" } }` — replace inclusive `pos..end`
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

<example name="replace a block body">
Replace only the catch body. Do not target the shared boundary line `} catch (err) {`.
```
{
  path: "util.ts",
  edits: [{
    loc: { block: { pos: {{hlineref 15 "\t\tconsole.error(err);"}}, end: {{hlineref 16 "\t\treturn null;"}} } },
    content: [
      "\t\tif (isEnoent(err)) return null;",
      "\t\tthrow err;"
    ]
  }]
}
```
</example>

<example name="replace whole block including closing brace">
Replace the entire body of `alpha`, including its closing `}`. `end` **MUST** be {{hlineref 7 "}"}} because `content` includes `}`.
```
{
  path: "util.ts",
  edits: [{
    loc: { block: { pos: {{hlineref 6 "\tlog();"}}, end: {{hlineref 7 "}"}} } },
    content: [
      "\tvalidate();",
      "\tlog();",
      "}"
    ]
  }]
}
```
**Wrong**: using `end: {{hlineref 6 "\tlog();"}}` with the same content — line 7 (`}`) survives the replacement AND content emits `}`, producing two closing braces.
</example>

<example name="replace one line">
```
{
  path: "util.ts",
  edits: [{
    loc: { line: {{hlineref 2 "const timeout = 5000;"}} },
    content: ["const timeout = 30_000;"]
  }]
}
```
</example>

<example name="delete a range">
```
{
  path: "util.ts",
  edits: [{
    loc: { block: { pos: {{hlineref 10 "\t// TODO: remove after migration"}}, end: {{hlineref 11 "\tlegacy();"}} } },
    content: null
  }]
}
```
</example>

<example name="insert before sibling">
When adding a sibling declaration, prefer `prepend` on the next declaration.
```
{
  path: "util.ts",
  edits: [{
    loc: { prepend: {{hlineref 9 "function beta() {"}} },
    content: [
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
- `block` requires both `pos` and `end`. Other anchored ops require one anchor.
- When your replacement `content` ends with a closing delimiter (`}`, `*/`, `)`, `]`), verify `end` includes the original line carrying that delimiter. If `end` stops one line too early, the original delimiter survives and your content adds a second copy.
- **Self-check**: compare the last line of `content` with the line immediately after `end` in the file. If they match (e.g., both are `}`), extend `end` to include that line.
- For a block, either replace only the body or replace the whole block. Do not split block boundaries.
- `content` must be literal file content with matching indentation. If the file uses tabs, use real tabs.
- Do not use this tool to reformat or clean up unrelated code.
</critical>