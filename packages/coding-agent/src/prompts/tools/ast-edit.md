Performs structural AST-aware rewrites via native ast-grep.

<instruction>
- Use for codemods and structural rewrites where plain text replace is unsafe
- Narrow scope with `path` before replacing (`path` accepts files, directories, glob patterns, or comma-separated path lists; use `glob` for an additional filter relative to `path`)
- Default to language-scoped rewrites in mixed repositories: set `lang` and keep `path`/`glob` narrow
- Treat parse issues as a scoping or pattern-shape signal: tighten `path`/`lang`, or rewrite the pattern into valid syntax before retrying
- Metavariables captured in each rewrite pattern (`$A`, `$$$ARGS`) are substituted into that entry's rewrite template
- For variadic captures (arguments, fields, statement lists), use `$$$NAME` (not `$$NAME`)
- Rewrite patterns must parse as valid AST for the target language; if a method or declaration does not parse standalone, wrap it in valid context or switch to a contextual `sel`
- If ast-grep reports `Multiple AST nodes are detected`, the rewrite pattern is not a single parseable node; wrap method snippets in valid context (for example `class $_ { … }`) and use `sel` to rewrite the inner node
- When using contextual `sel`, the match and replacement target the selected node, not the outer wrapper you used to make the pattern parse
- For TypeScript declarations and methods, prefer patterns that tolerate annotations you do not care about, e.g. `async function $NAME($$$ARGS): $_ { $$$BODY }` or `class $_ { method($ARG: $_): $_ { $$$BODY } }`
- Metavariables must be the sole content of an AST node; partial-text metavariables like `prefix$VAR` or `"hello $NAME"` do NOT work in patterns or rewrites
- To delete matched code, use an empty `out` string: `{"pat":"console.log($$$)","out":""}`
- Each matched rewrite is a 1:1 structural substitution; you cannot split one capture into multiple nodes or merge multiple captures into one node
</instruction>

<output>
- Returns replacement summary, per-file replacement counts, and change diffs
- Includes parse issues when files cannot be processed
</output>

<examples>
- Rename a call site across a directory:
  `{"ops":[{"pat":"oldApi($$$ARGS)","out":"newApi($$$ARGS)"}],"lang":"typescript","path":"src/"}`
- Delete all matching calls (empty `out` removes the matched node):
  `{"ops":[{"pat":"console.log($$$ARGS)","out":""}],"lang":"typescript","path":"src/"}`
- Rewrite an import source path:
  `{"ops":[{"pat":"import { $$$IMPORTS } from \"old-package\"","out":"import { $$$IMPORTS } from \"new-package\""}],"lang":"typescript","path":"src/"}`
- Modernize to optional chaining (same metavariable enforces identity):
  `{"ops":[{"pat":"$A && $A()","out":"$A?.()"}],"lang":"typescript","path":"src/"}`
- Swap two arguments using captures:
  `{"ops":[{"pat":"assertEqual($A, $B)","out":"assertEqual($B, $A)"}],"lang":"typescript","path":"tests/"}`
- Rename a TypeScript function declaration while tolerating any return type annotation:
  `{"ops":[{"pat":"async function fetchData($$$ARGS): $_ { $$$BODY }","out":"async function loadData($$$ARGS): $_ { $$$BODY }"}],"sel":"function_declaration","lang":"typescript","path":"src/api.ts"}`
- Rewrite a TypeScript method body fragment by wrapping it in parseable context and selecting the method node:
  `{"ops":[{"pat":"class $_ { async execute($INPUT: $_) { $$$BEFORE; const $PARSED = $_.parse($INPUT); $$$AFTER } }","out":"class $_ { async execute($INPUT: $_) { $$$BEFORE; const $PARSED = $SCHEMA.parse($INPUT); $$$AFTER } }"}],"sel":"method_definition","lang":"typescript","path":"src/tools/todo.ts"}`
- Convert Python print calls to logging:
  `{"ops":[{"pat":"print($$$ARGS)","out":"logger.info($$$ARGS)"}],"lang":"python","path":"src/"}`
</examples>

<critical>
- `ops` **MUST** contain at least one concrete `{ pat, out }` entry
- If the path pattern spans multiple languages, set `lang` explicitly for deterministic rewrites
- Parse issues mean the rewrite request is malformed or mis-scoped; do not assume a clean no-op until the pattern parses successfully
- For one-off local text edits, prefer the Edit tool instead of AST edit
</critical>