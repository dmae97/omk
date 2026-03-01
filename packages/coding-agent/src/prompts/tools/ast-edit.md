Performs structural AST-aware rewrites via native ast-grep.

<instruction>
- Use for codemods and structural rewrites where plain text replace is unsafe
- Narrow scope with `path` before replacing (`path` accepts files, directories, or glob patterns)
- Default to language-scoped rewrites in mixed repositories: set `lang` and keep `path` narrow
- Keep `dry_run` enabled unless explicit apply intent is clear
- Use `max_files` and `max_replacements` as safety caps on broad rewrites
- Treat parse issues as a scoping signal: tighten `path`/`lang` before retrying
- Metavariables captured in each rewrite pattern (`$A`, `$$$ARGS`) are substituted into that entry's rewrite template
- Each matched rewrite is a 1:1 structural substitution; you cannot split one capture into multiple nodes or merge multiple captures into one node
</instruction>

<output>
- Returns replacement summary, per-file replacement counts, and change previews
- Reports whether changes were applied or only previewed
- Includes parse issues when files cannot be processed
</output>

<examples>
- Preview a single exact-shape rewrite in one file:
  `{"ops":[{"pat":"renderStatusLine({ icon: \"pending\", title: \"AST Grep\", description, meta }, uiTheme)","out":"renderStatusLine({ icon: \"success\", title: \"AST Grep\", description, meta }, uiTheme)"}],"lang":"typescript","path":"packages/coding-agent/src/tools/ast-grep.ts","dry_run":true}`
- Preview multiple rewrites with safety caps across many files:
  `{"ops":[{"pat":"renderPromptTemplate($A)","out":"String(renderPromptTemplate($A))"},{"pat":"oldApi($$$ARGS)","out":"newApi($$$ARGS)"}],"lang":"typescript","path":"packages/coding-agent/src/tools/**/*.ts","dry_run":true,"max_files":2,"max_replacements":3}`
- Swap two arguments using captures:
  `{"ops":[{"pat":"assertEqual($A, $B)","out":"assertEqual($B, $A)"}],"lang":"typescript","path":"tests/**/*.ts","dry_run":true}`
</examples>

<critical>
- `ops` **MUST** contain at least one concrete `{ pat, out }` entry
- If the path pattern spans multiple languages, set `lang` explicitly for deterministic rewrites
- Run `dry_run: true` first, review preview, then rerun with `dry_run: false` only when intent is explicit
- For one-off local text edits, prefer the Edit tool instead of AST edit
</critical>