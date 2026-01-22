# Bash

Executes a given bash command in a shell session with optional timeout.
This tool is for terminal operations like git, bun, cargo, python, etc. DO NOT use it for file operations.

<critical>
Do NOT use Bash for:
- Reading file contents → Use Read tool instead
- Searching file contents → Use Grep tool instead
- Finding files by pattern → Use Find tool instead
- Editing files → Use Edit tool instead
- Writing new files → Use Write tool instead
</critical>

<instruction>
- Use `workdir` parameter to run commands in a specific directory instead of `cd dir && ...`
- Paths with spaces must use double quotes: `cd "/path/with spaces"`
- For sequential dependent operations, chain with `&&`: `mkdir foo && cd foo && touch bar`
- For parallel independent operations, make multiple tool calls in one message
- Use `;` only when later commands should run regardless of earlier failures
</instruction>

<important>
- Truncated after 50KB; filter with `| head -n 50` for large output
- Exit codes and stderr captured
</important>
