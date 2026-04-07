Edits files by addressing syntax-aware chunks from `read` output.

Read the file first with `read(path="file.ts")`. Copy `target` directly from the latest chunk anchors. The `#CRC` suffix in `target` is the chunk checksum.

Successful edit responses include the updated chunk tree with checksums. Do not re-read just to refresh checksums unless the file changed externally.

**Checksum scope:** Each chunk has its own CRC over its source span. Editing non-overlapping lines elsewhere does not change unrelated chunks' checksums.

<operations>
**Choosing the right edit shape:**
- To rewrite an entire chunk → `{ "target": "chunk#CRC", "content": "..." }`
- To fix a single line → add `"line": 13`
- To fix a contiguous range → add `"line": 13, "end_line": 17`
- To delete a chunk → `{ "target": "chunk#CRC", "delete": true }`
- To append/prepend inside a container → add `"append": true` or `"prepend": true`
- To insert relative to a named child → use `"after": "child_name"` or `"before": "child_name"` on the parent target

|shape|effect|
|---|---|
|`{ "target": "chunk#CRC", "content": "..." }`|replace the target chunk|
|`{ "target": "chunk#CRC", "line": 13, "content": "..." }`|replace one line within the target chunk|
|`{ "target": "chunk#CRC", "line": 13, "end_line": 17, "content": "..." }`|replace an inclusive line range within the target chunk|
|`{ "target": "chunk#CRC", "delete": true }`|delete the target chunk|
|`{ "target": "chunk", "append": true, "content": "..." }`|append as last child of the target chunk|
|`{ "target": "chunk", "prepend": true, "content": "..." }`|prepend as first child of the target chunk|
|`{ "target": "parent", "after": "child", "content": "..." }`|insert after the named child within `parent`|
|`{ "target": "parent", "before": "child", "content": "..." }`|insert before the named child within `parent`|

- `line`/`end_line` are **absolute file line numbers** from the `read` gutter. `line` alone = single line. `line` + `end_line` = inclusive range. `line` with `end_line` = `line`-1 = zero-width insert.
- `path` is always just the file path. Do not embed `:chunk` selectors in `path`.
- `target` is the chunk path, optionally followed by `#CRC` copied from the anchor. Example: `"class_Server.fn_start#HTST"`.
- Insert edits usually omit the checksum because they do not rewrite the target chunk itself.
- For file-root replace/delete, use the file header checksum as `"target": "#VSKB"`.
- Content must already include the intended inner indentation for the destination block.
- Batch edits observe earlier edits. If edit 1 changes checksum/span/path, edit 2 must use the post-edit anchor values.
- `replace`/`delete` include leading comments/attributes attached to the chunk.
</operations>

<examples>
All examples reference this `read` output:
```
  | server.ts·40L·ts·#VSKB
 5| class Server {
  | {{anchor "class_Server" "XKQZ"}}
12|   start(): void {
  |   {{anchor "fn_start" "HTST"}}
13|     log("booting on " + this.port);
14|     for (let i = 0; i < MAX_RETRIES; i++) {
15|       this.tryBind();
16|     }
17|   }
19|   private tryBind(): boolean {
  |   {{anchor "fn_tryBind" "VNWR"}}
20|     // TODO: add backoff
21|     return bind(this.port);
22|   }
```

<example name="replace a method">
```
"path": "server.ts",
"edits": [
  {
    "target": "{{sel "class_Server.fn_start"}}#HTST",
    "content": "start(): void {\n  log(\"starting\");\n  this.tryBind();\n}"
  }
]
```
</example>

<example name="replace a single line">
```
"path": "server.ts",
"edits": [
  {
    "target": "{{sel "class_Server.fn_start"}}#HTST",
    "line": 13,
    "content": " warn(\"booting on \" + this.port);"
  }
]
```
</example>

<example name="delete a chunk">
```
"path": "server.ts",
"edits": [
  {
    "target": "{{sel "class_Server.fn_tryBind"}}#VNWR",
    "delete": true
  }
]
```
</example>

<example name="append a child method">
```
"path": "server.ts",
"edits": [
  {
    "target": "{{sel "class_Server"}}",
    "append": true,
    "content": "status(): string {\n  return \"ok\";\n}"
  }
]
```
</example>

<example name="insert after a named child">
```
"path": "server.ts",
"edits": [
  {
    "target": "{{sel "class_Server"}}",
    "after": "fn_start",
    "content": "reset(): void {\n  this.port = 0;\n}"
  }
]
```
</example>
</examples>

<critical>
- **MUST** include `path` in every edit call.
- **MUST** read the latest chunk output before editing.
- **MUST** include a `#CRC` suffix in `target` for every replace or delete edit.
- **MUST** use updated chunk output from the edit response for follow-up edits.
- **MUST** use the smallest correct target; do not rewrite siblings unnecessarily.
- **MUST NOT** invent chunk paths. Copy them from `read` output including `fn_*` prefixes. Nesting uses `.`.
- For line-scoped replace edits, use file line numbers from the `read` gutter.
- Do NOT batch multiple line-scoped replace edits on the same chunk. Combine them into one wider range or use separate calls.
</critical>
</output>