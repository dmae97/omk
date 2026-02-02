# Bash

Executes bash command in shell session for terminal operations like git, bun, cargo, python.

<instruction>
- Use `cwd` parameter to set working directory instead of `cd dir && ...`
- Paths with spaces must use double quotes: `cd "/path/with spaces"`
- For sequential dependent operations, chain with `&&`: `mkdir foo && cd foo && touch bar`
- For parallel independent operations, make multiple tool calls in one message
- Use `;` only when later commands should run regardless of earlier failures
</instruction>

<output>
Returns stdout, stderr, exit code from command execution.
- Output truncated after 50KB or 2000 lines (whichever first); use `head` parameter to limit output
- If output truncated, full output stored under $ARTIFACTS and referenced as `artifact://<id>` in metadata
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

<avoid>
Do NOT pipe through `head` or `tail`—use `head` and `tail` parameters instead:
- `command | head -n 50` → use `head: 50` parameter
- `command | tail -n 100` → use `tail: 100` parameter

Pipe pattern breaks streaming output and prevents artifact storage.

Do NOT use `2>&1`—stdout and stderr already merged.
</avoid>