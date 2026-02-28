Performs structural AST-aware rewrites via native ast-grep.

<instruction>
- Use for codemods and structural rewrites where plain text replace is unsafe
- Narrow scope with `path` before replacing (`path` accepts files, directories, or glob patterns)
- `pattern` + `rewrite` are required; `lang` is optional only when all matched files resolve to a single language
- Keep `dry_run` enabled unless explicit apply intent is clear
- Use `max_files` and `max_replacements` as safety caps on broad rewrites
</instruction>

<output>
- Returns replacement summary, per-file replacement counts, and change previews
- Reports whether changes were applied or only previewed
- Includes parse issues when files cannot be processed
</output>

<critical>
- `pattern` + `rewrite` are required
- If the path pattern spans multiple languages, set `lang` explicitly for deterministic rewrites
- For one-off local text edits, prefer the Edit tool instead of AST replace
</critical>