Reads files using syntax-aware chunks.

<instruction>
- `path` — file path or URL; may include `:selector` suffix
- `sel` — optional selector: `class_Foo`, `class_Foo.fn_bar#ABCD~`, `?`, `L50`, `L50-L120`, or `raw`
- `timeout` — seconds, for URLs only

Each opening anchor `[< full.chunk.path#CCCC ]` in the default output identifies a chunk. Use `full.chunk.path#CCCC` as-is to read truncated chunks.
If you need a canonical target list, run `read(path="file", sel="?")`. That listing shows chunk paths with CRCs.
Line numbers in the gutter are absolute file line numbers.

`L20` (single line, no explicit end) is shorthand for `L20` to end-of-file. Use `L20-L20` for a one-line window.

{{#if chunkAutoIndent}}
Chunk reads normalize leading indentation so copied content round-trips cleanly into chunk edits.
{{else}}
Chunk reads preserve literal leading tabs/spaces from the file. When editing, keep the same whitespace characters you see here.
{{/if}}

Chunk trees: JS, TS, TSX, Python, Rust, Go. Others use blank-line fallback.
</instruction>

<critical>
- **MUST** `read` before editing — never invent chunk names or CRCs.
</critical>
