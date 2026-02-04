# Grep

Powerful search tool built on ripgrep.

<instruction>
- Supports full regex syntax (e.g., `log.*Error`, `function\\s+\\w+`)
- Filter files with `glob` (e.g., `*.js`, `**/*.tsx`) or `type` (e.g., `js`, `py`, `rust`)
- Pattern syntax uses ripgrep—literal braces need escaping (`interface\\{\\}` to find `interface{}` in Go)
- For cross-line patterns like `struct \\{[\\s\\S]*?field`, set `multiline: true` if needed
- If the pattern contains a literal `\n`, multiline defaults to true
</instruction>

<output>
Results are always content mode: matching lines with file paths and line numbers.
Truncated at 100 matches by default (configurable via `limit`).
</output>

<critical>
- ALWAYS use Grep for search tasks—NEVER invoke `grep` or `rg` via Bash. Has correct permissions and access.
</critical>

<avoid>
- Open-ended searches requiring multiple rounds—use Task tool with explore subagent instead
</avoid>