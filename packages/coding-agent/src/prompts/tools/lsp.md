# LSP

Interact with Language Server Protocol servers for code intelligence.

<operations>
- `definition`: Go to symbol definition
- `references`: Find all references to symbol
- `hover`: Get type info and documentation
- `symbols`: List symbols in file, or search workspace (with query, no file)
- `rename`: Rename symbol across codebase
- `diagnostics`: Get errors/warnings for file, or check entire project (no file)
- `reload`: Restart the language server
</operations>

<output>
- `definition`: File path and position of definition
- `references`: List of locations (file + position) where symbol used
- `hover`: Type signature and documentation text
- `symbols`: List of symbol names, kinds, locations
- `rename`: Confirmation of changes made across files
- `diagnostics`: List of errors/warnings with file, line, severity, message
- `reload`: Confirmation of server restart
</output>

<caution>
- Requires running LSP server for target language
- Some operations require file to be saved to disk
</caution>