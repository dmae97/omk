Performs structural AST-aware rewrites via native ast-grep.

<instruction>
- Use for codemods and structural rewrites where plain text replace is unsafe
- Narrow scope with `path` before replacing (`path` accepts files, directories, or glob patterns)
- Default to language-scoped rewrites in mixed repositories: set `lang` and keep `path` narrow
- Keep `preview` enabled unless explicit apply intent is clear
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
- Rename a call site across a directory, preview first:
  `{"ops":[{"pat":"oldApi($$$ARGS)","out":"newApi($$$ARGS)"}],"lang":"typescript","path":"src/","preview":true}`
- Multi-op codemod, apply after previewing:
  `{"ops":[{"pat":"require($A)","out":"import $A"},{"pat":"module.exports = $E","out":"export default $E"}],"lang":"javascript","path":"src/","preview":false}`
- Swap two arguments using captures:
  `{"ops":[{"pat":"assertEqual($A, $B)","out":"assertEqual($B, $A)"}],"lang":"typescript","path":"tests/","preview":true}`
</examples>

<critical>
- `ops` **MUST** contain at least one concrete `{ pat, out }` entry
- If the path pattern spans multiple languages, set `lang` explicitly for deterministic rewrites
- Run `preview: true` first, review changes, then rerun with `preview: false` only when intent is explicit
- For one-off local text edits, prefer the Edit tool instead of AST edit
</critical>