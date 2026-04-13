Applies precise file edits using `LINE#ID` anchors from `read` output.

Read the file first. Copy anchors exactly from the latest `read` output. After any successful edit, re-read before editing that file again.

<operations>
**Top level**
- `edits` — array of edit entries

**Edit entry**: `{ path, loc, content }` or `{ path, delete: true }` or `{ path, move: "new/path" }`
- `path` — file path
- `loc` — where to apply the edit (see below)
- `content` — replacement/inserted lines (array of strings preferred, `null` to delete)
- `delete` — delete the file
- `move` — move/rename the file

**`loc` values**
- `"append"` / `"prepend"` — insert at end/start of file
- `{ append: "N#ID" }` / `{ prepend: "N#ID" }` — insert after/before anchored line
- `{ range: { pos: "N#ID", end: "N#ID" } }` — replace inclusive range of lines `pos..end` with new content
  </operations>

<examples>
All examples below reference the same file:
```ts title="a.ts"
{{hline  1 "// @ts-ignore"}}
{{hline  2 "const timeout = 5000;"}}
{{hline  3 "const tag = \"DO NOT SHIP\";"}}
{{hline  4 ""}}
{{hline  5 "function alpha() {"}}
{{hline  6 "\tlog();"}}
{{hline  7 "}"}}
{{hline  8 ""}}
{{hline  9 "function beta() {"}}
{{hline 10 "\t// TODO: remove after migration"}}
{{hline 11 "\tlegacy();"}}
{{hline 12 "\ttry {"}}
{{hline 13 "\t\treturn parse(data);"}}
{{hline 14 "\t} catch (err) {"}}
{{hline 15 "\t\tconsole.error(err);"}}
{{hline 16 "\t\treturn null;"}}
{{hline 17 "\t}"}}
{{hline 18 "}"}}
```

<example name="replace a block body">
Replace only the catch body. Do not target the shared boundary line `} catch (err) {`.
```
{
  edits: [{
    path: "a.ts",
    loc: { range: { pos: {{href 15 "\t\tconsole.error(err);"}}, end: {{href 16 "\t\treturn null;"}} } },
    content: [
      "\t\tif (isEnoent(err)) return null;",
      "\t\tthrow err;"
    ]
  }]
}
```
</example>

<example name="replace whole block including closing brace">
Replace the entire body of `alpha`, including its closing `}`. `end` **MUST** be {{href 7 "}"}} because `content` includes `}`.
```
{
  edits: [{
    path: "a.ts",
    loc: { range: { pos: {{href 6 "\tlog();"}}, end: {{href 7 "}"}} } },
    content: [
      "\tvalidate();",
      "\tlog();",
      "}"
    ]
  }]
}
```
**Wrong**: using `end: {{href 6 "\tlog();"}}` with the same content — line 7 (`}`) survives the replacement AND content emits `}`, producing two closing braces.
</example>

<example name="replace one line">
```
{
  edits: [{
    path: "a.ts",
    loc: { range: { pos: {{href 2 "const timeout = 5000;"}}, end: {{href 2 "const timeout = 5000;"}} } },
    content: ["const timeout = 30_000;"]
  }]
}
```
</example>

<example name="delete a range">
```
{
  edits: [{
    path: "a.ts",
    loc: { range: { pos: {{href 10 "\t// TODO: remove after migration"}}, end: {{href 11 "\tlegacy();"}} } },
    content: null
  }]
}
```
</example>

<example name="insert before sibling">
When adding a sibling declaration, prefer `prepend` on the next declaration.
```
{
  edits: [{
    path: "a.ts",
    loc: { prepend: {{href 9 "function beta() {"}} },
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
- `range` requires both `pos` and `end`.
- When your replacement `content` ends with a closing delimiter (`}`, `*/`, `)`, `]`), verify `end` includes the original line carrying that delimiter. If `end` stops one line too early, the original delimiter survives and your content adds a second copy.
- **Self-check**: compare the last line of `content` with the line immediately after `end` in the file. If they match (e.g., both are `}`), extend `end` to include that line.
- For a range, either replace only the body or replace the whole range. Do not split range boundaries.
- `content` must be literal file content with matching indentation. If the file uses tabs, use real tabs.
- You **MUST NOT** use this tool to reformat or clean up unrelated code. **ALWAYS** use project-specific tooling like linters or code formatters which are much more efficient and reliable.
  </critical>
