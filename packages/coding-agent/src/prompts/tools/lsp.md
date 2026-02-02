# LSP

Interact with Language Server Protocol servers for code intelligence.

<operations>
- `diagnostics`: Get errors/warnings for file
- `workspace_diagnostics`: Check entire project (uses tsc, cargo check, go build, etc.)
- `definition`: Go to symbol definition
- `references`: Find all references to symbol
- `hover`: Get type info and documentation
- `symbols`: List symbols in file (functions, classes, etc.)
- `workspace_symbols`: Search for symbols across project
- `rename`: Rename symbol across codebase
- `actions`: List and apply code actions (quick fixes, refactors)
- `incoming_calls`: Find all callers of function
- `outgoing_calls`: Find all functions called by function
</operations>

<output>
Returns vary by operation:
- `diagnostics`/`workspace_diagnostics`: List of errors/warnings with file, line, severity, message
- `definition`: File path and position of definition
- `references`: List of locations (file + position) where symbol used
- `hover`: Type signature and documentation text
- `symbols`/`workspace_symbols`: List of symbol names, kinds, locations
- `rename`: Confirmation of changes made across files
- `actions`: List of available code actions; when applied, returns result
- `incoming_calls`/`outgoing_calls`: Call hierarchy with caller/callee locations
</output>

<important>
- Requires running LSP server for target language
- Some operations require file to be saved to disk
- `workspace_diagnostics` may be slow on large projects
</important>