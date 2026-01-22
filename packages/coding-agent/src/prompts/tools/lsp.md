# LSP

Interact with Language Server Protocol (LSP) servers to get code intelligence features.

<operations>
- diagnostics: Get errors/warnings for a file
- workspace_diagnostics: Check entire project for errors (uses tsc, cargo check, go build, etc.)
- definition: Go to symbol definition
- references: Find all references to a symbol
- hover: Get type info and documentation
- symbols: List symbols in a file (functions, classes, etc.)
- workspace_symbols: Search for symbols across the project
- rename: Rename a symbol across the codebase
- actions: List and apply code actions (quick fixes, refactors)
- incoming_calls: Find all callers of a function
- outgoing_calls: Find all functions called by a function
</operations>
