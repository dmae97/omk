Reads files using syntax-aware chunks.

<instruction>
- `path` — file path or URL; may include `:selector` suffix
- `sel` — optional selector: `class_Foo`, `class_Foo.fn_bar`, `?`, `L50`, `L50-L120`, or `raw`
- `timeout` — seconds, for URLs only

Each anchor `[full.chunk.path#CCCC]` in the default output is an exact chunk ID. Copy `full.chunk.path#CCCC` into the edit tool's `target` field.
If you need a canonical target list, or your anchor style omits full paths, run `read(path="file", sel="?")` and copy a path from that listing.
Line numbers in the gutter are absolute file line numbers.

Chunk trees: JS, TS, TSX, Python, Rust, Go. Others use blank-line fallback.
</instruction>

<critical>
- **MUST** `read` before editing — never invent chunk names or CRCs.
</critical>
