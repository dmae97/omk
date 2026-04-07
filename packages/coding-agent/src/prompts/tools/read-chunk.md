Reads files using syntax-aware chunks.

<instruction>
- `path` — file path or URL; may include `:selector` suffix
- `sel` — optional selector: `class_Foo`, `class_Foo.fn_bar`, `L50`, `L50-L120`, or `raw`
- `timeout` — seconds, for URLs only

Each anchor `[name#CCCC]` in the output is a chunk ID. Copy `name#CCCC` into the edit tool's `target` field.
Line numbers in the gutter are absolute — use them for `line`/`end_line` in edits.

Chunk trees: JS, TS, TSX, Python, Rust, Go. Others use blank-line fallback.
</instruction>

<critical>
- **MUST** `read` before editing — never invent chunk names or CRCs.
</critical>
