Interacts with Language Server Protocol servers for code intelligence.

<operations>
- `diagnostics`: Get errors/warnings for a file, a glob of files, or the entire workspace (`file: "*"`)
- `definition`: Go to symbol definition → file path + position + 3-line source context
- `type_definition`: Go to symbol type definition → file path + position + 3-line source context
- `implementation`: Find concrete implementations → file path + position + 3-line source context
- `references`: Find references → locations with 3-line source context (first 50), remaining location-only
- `hover`: Get type info and documentation → type signature + docs
- `symbols`: List symbols in a file, or search workspace with `file: "*"` and a `query`
- `rename`: Rename symbol across codebase → preview or apply edits
- `code_actions`: List available quick-fixes/refactors/import actions; apply one when `apply: true` and `query` matches title or index
- `status`: Show active language servers
- `reload`: Restart a specific server (via `file`) or all servers with `file: "*"`
</operations>

<parameters>
- `file`: File path, glob pattern (e.g. `src/**/*.ts`), or `"*"` for workspace scope. Globs are expanded locally before dispatch. `"*"` routes `diagnostics`/`symbols`/`reload` to their workspace-wide form.
- `line`: 1-indexed line number for position-based actions
- `symbol`: Substring on the target line used to resolve column automatically
- `occurrence`: 1-indexed match index when `symbol` appears multiple times on the same line
- `query`: Symbol search query, code-action kind filter (list mode), or code-action selector (apply mode)
- `new_name`: Required for rename
- `apply`: Apply edits for rename/code_actions (default true for rename, list mode for code_actions unless explicitly true)
- `timeout`: Request timeout in seconds (clamped to 5-60, default 20)
</parameters>

<caution>
- Requires running LSP server for target language
- Some operations require file to be saved to disk
- Glob expansion samples up to 20 files per request; use `file: "*"` for broader coverage
- When `symbol` is provided for position-based actions, missing symbols or out-of-bounds `occurrence` values return an explicit error instead of silently falling back
</caution>
