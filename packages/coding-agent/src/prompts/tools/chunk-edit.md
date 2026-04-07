Edits files via syntax-aware chunks. Run `read(path="file.ts")` first — it returns chunks with anchors `[name#CRC]` where `#CRC` is a 4-char hex checksum. Copy the full chunk path AND `#CRC` verbatim into `target`.

<rules>
- **MUST** `read` first. NEVER invent chunk names or CRCs — copy them from the latest read output or edit response.
- `target` **MUST** be the **fully-qualified** path (e.g. `class_X.fn_y.if_2`, not `if_2`), ending with `#CRC` for replace/delete.
- Prefer `line`/`end_line` (absolute file line numbers from the read gutter) for small fixes over whole-chunk replace.
- `content` must include the destination block's inner indentation.
- Successful edits return refreshed anchors — use them for follow-ups, don't re-read just for new CRCs.
</rules>

<ops>
|op|fields|effect|
|---|---|---|
|`replace` (default)|`target#CRC`, `content`, opt. `line`/`end_line`|rewrite chunk or a line range within it|
|`delete`|`target#CRC`|remove chunk|
|`append` / `prepend`|`target`, `content`|insert as last/first child of target|
|`after` / `before`|`target`, `anchor` (child name), `content`|insert at sibling position|

For file-root edits, `target` is the file CRC alone (e.g. `"#VSKB"`).
</ops>

<example>
Given read output:
```
  | server.ts·40L·ts·#VSKB
12|   start(): void {
  |   {{anchor "fn_start" "HTST"}}
13|     log("booting on " + this.port);
14|     this.tryBind();
15|   }
```

Fix the typo on line 13:
```json
{"path":"server.ts","edits":[{"target":"{{sel "class_Server.fn_start"}}#HTST","line":13,"content":"    warn(\"booting on \" + this.port);"}]}
```
</example>
