Edits files via syntax-aware chunks. Run `read(path="file.ts")` first — the default read output shows anchors like `class_X.fn_y.if_2#CCCC`. Copy that exact `class_X.fn_y.if_2#CCCC` into `target`.

<rules>
- **MUST** `read` first. NEVER invent chunk names or CRCs — copy them from the latest read output or edit response.
- `target` **MUST** be the **fully-qualified** path: `class_X.fn_y.if_2#CCCC`
- If the exact path is unclear, or your anchor style omits full paths, run `read(path="file", sel="?")` and copy a canonical target from that listing.
- `content` must match the full chunk region you are replacing (same span as read output), with correct inner indentation — except use `content: ""` to remove the chunk.
- Prefer `replace_body` when you are only changing a function/class implementation. It preserves the surrounding declaration shape and avoids accidentally dropping attached doc comments.
- Successful edits return refreshed anchors — use them for follow-ups, don't re-read just for new CRCs.
</rules>

<ops>
|op|fields|effect|
|---|---|---|
|`replace`|`target#CRC`, `content`|rewrite or, with empty content, entire chunk|
|`replace_body`|`target#CRC`, `content`|rewrite only the inner body of the chunk, preserving signature and closing delimiter|
|`append_child` / `prepend_child`|`target`, `content`|insert as child of target|
|`append_sibling` / `prepend_sibling`|`target`, `anchor` (child name), `content`|insert as sibling of anchor|

For file-root edits, `target` is the file header CRC alone (e.g. `"#VSKB"`).
</ops>
