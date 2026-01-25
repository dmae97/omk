# Grep

A powerful search tool built on ripgrep.

<instruction>
- Supports full regex syntax (e.g., `log.*Error`, `function\\s+\\w+`)
- Filter files with `glob` (e.g., `*.js`, `**/*.tsx`) or `type` (e.g., `js`, `py`, `rust`)
- Pattern syntax uses ripgrep—literal braces need escaping (`interface\\{\\}` to find `interface{}` in Go)
- For cross-line patterns like `struct \\{[\\s\\S]*?field`, use `multiline: true`
</instruction>

<output>
Results depend on `output_mode`:
- `content`: Matching lines with file paths and line numbers
- `files_with_matches`: File paths only (one per line)
- `count`: Match counts per file

In `content` mode, truncated at 100 matches by default (configurable via `limit`).
For `files_with_matches` and `count` modes, use `head_limit` to truncate results.
</output>

<critical>
- ALWAYS use Grep for search tasks—NEVER invoke `grep` or `rg` via Bash. This tool has correct permissions and access.
</critical>

<avoid>
- Open-ended searches requiring multiple rounds—use Task tool with explore subagent instead
</avoid>