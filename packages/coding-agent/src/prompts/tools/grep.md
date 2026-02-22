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
- Results are always content mode.
- Results grouped by directory (`# dir`) and file (`## └─ file`) headings
{{#if IS_HASHLINE_MODE}}
- Text output is CID prefixed: `LINE#ID:content`
{{else}}
{{#if IS_LINE_NUMBER_MODE}}
- Text output is line-number-prefixed
{{/if}}
{{/if}}
</output>

<critical>
- You MUST use Grep when searching for content.
- You MUST NOT invoke `grep` or `rg` via Bash.
- If the search is open-ended, requiring multiple rounds, you MUST use Task tool with explore subagent instead.
</critical>