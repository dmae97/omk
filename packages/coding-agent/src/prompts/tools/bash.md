# Bash

Executes a bash command in a shell session for terminal operations like git, bun, cargo, python.

<instruction>
- Use `cwd` parameter to set working directory instead of `cd dir && ...`
- Paths with spaces must use double quotes: `cd "/path/with spaces"`
- For sequential dependent operations, chain with `&&`: `mkdir foo && cd foo && touch bar`
- For parallel independent operations, make multiple tool calls in one message
- Use `;` only when later commands should run regardless of earlier failures
</instruction>

<output>
Returns stdout, stderr, and exit code from command execution.
- Output truncated after 50KB or 2000 lines (whichever comes first); use `| head -n 50` for large output
- If output is truncated, full output is stored under $ARTIFACTS and referenced as `artifact://<id>` in metadata
- Exit codes shown on non-zero exit; stderr captured
</output>

<critical>
Do NOT use Bash for these operations—specialized tools exist:
- Reading file contents → Read tool
- Searching file contents → Grep tool
- Finding files by pattern → Find tool
- Content-addressed edits → Edit tool
- Writing new files → Write tool
</critical>