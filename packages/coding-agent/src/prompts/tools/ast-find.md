Performs structural code search using AST matching via native ast-grep.

<instruction>
- Use this when syntax shape matters more than raw text (calls, declarations, specific language constructs)
- Prefer a precise `path` scope to keep results targeted and deterministic (`path` accepts files, directories, or glob patterns)
- `pattern` is required; `lang` is optional (`lang` is inferred per file extension when omitted)
- Use `selector` only for contextual pattern mode; otherwise provide a direct pattern
- Enable `include_meta` when metavariable captures are needed in output
</instruction>

<output>
- Returns grouped matches with file path, byte range, and line/column ranges
- Includes summary counts (`totalMatches`, `filesWithMatches`, `filesSearched`) and parse issues when present
</output>

<critical>
- `pattern` is required
- Set `lang` explicitly to constrain matching when path pattern spans mixed-language trees
- If exploration is broad/open-ended across subsystems, use Task tool with explore subagent first
</critical>