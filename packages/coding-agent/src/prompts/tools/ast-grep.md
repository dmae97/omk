Performs structural code search using AST matching via native ast-grep.

<instruction>
- Use this when syntax shape matters more than raw text (calls, declarations, specific language constructs)
- Prefer a precise `path` scope to keep results targeted and deterministic (`path` accepts files, directories, or glob patterns; use `glob` for an additional filter relative to `path`)
- Default to language-scoped search in mixed repositories: pair `path` + `glob` + explicit `lang` to avoid parse-noise from non-source files
- `pat` is required and must include at least one non-empty AST pattern; `lang` is optional (`lang` is inferred per file extension when omitted)
- Multiple patterns run in one native pass; results are merged and then `offset`/`limit` are applied to the combined match set
- Use `sel` only for contextual pattern mode; otherwise provide direct patterns
- In contextual pattern mode, results are returned for the selected node (`sel`), not the outer wrapper used to make the pattern parse
- For variadic captures (arguments, fields, statement lists), use `$$$NAME` (not `$$NAME`)
- Patterns must parse as a single valid AST node for the target language; if a bare pattern fails, wrap it in valid context or use `sel`
- If ast-grep reports `Multiple AST nodes are detected`, your pattern is not a single parseable node; wrap method snippets in valid context (for example `class $_ { … }`) and use `sel` to target the inner node
- Patterns match AST structure, not text — whitespace/formatting differences are ignored
- When the same metavariable appears multiple times, all occurrences must match identical code
- For TypeScript declarations and methods, prefer shapes that tolerate annotations you do not care about, e.g. `async function $NAME($$$ARGS): $_ { $$$BODY }` or `class $_ { method($ARG: $_): $_ { $$$BODY } }` instead of omitting annotations entirely
- Metavariables must be the sole content of an AST node; partial-text metavariables like `prefix$VAR`, `"hello $NAME"`, or `a $OP b` do NOT work — match the whole node instead
- `$$$` captures are lazy (non-greedy): they stop when the next element in the pattern can match; place the most specific node after `$$$` to control where capture ends
- `$_` is a non-capturing wildcard (matches any single node without binding); use it when you need to tolerate a node but don't need its value
- Search the right declaration form before concluding absence: top-level function, class method, and variable-assigned function are different AST shapes
- If you only need to prove a symbol exists, prefer a looser contextual search such as `pat: ["executeBash"]` with `sel: "identifier"`
</instruction>

<output>
- Returns grouped matches with file path, byte range, line/column ranges, and metavariable captures
- Includes summary counts (`totalMatches`, `filesWithMatches`, `filesSearched`) and parse issues when present
</output>

<examples>
- Find all console logging calls in one pass (multi-pattern, scoped):
  `{"pat":["console.log($$$)","console.error($$$)"],"lang":"typescript","path":"src/"}`
- Find all named imports from a specific package:
  `{"pat":["import { $$$IMPORTS } from \"react\""],"lang":"typescript","path":"src/"}`
- Match arrow functions assigned to a const (different AST shape than function declarations):
  `{"pat":["const $NAME = ($$$ARGS) => $BODY"],"lang":"typescript","path":"src/utils/"}`
- Match any method call on an object using wildcard `$_` (ignores method name):
  `{"pat":["logger.$_($$$ARGS)"],"lang":"typescript","path":"src/"}`
- Contextual pattern with selector — match only the identifier `foo`, not the whole call:
  `{"pat":["foo()"],"sel":"identifier","lang":"typescript","path":"src/utils.ts"}`
- Match a TypeScript function declaration without caring about its exact return type:
  `{"pat":["async function processItems($$$ARGS): $_ { $$$BODY }"],"sel":"function_declaration","lang":"typescript","path":"src/worker.ts"}`
- Match a TypeScript method body fragment by wrapping it in parseable context and selecting the method node:
  `{"pat":["class $_ { async execute($INPUT: $_) { $$$BEFORE; const $PARSED = $_.parse($INPUT); $$$AFTER } }"],"sel":"method_definition","lang":"typescript","path":"src/tools/todo.ts"}`
- Loosest existence check for a symbol in one file:
  `{"pat":["processItems"],"sel":"identifier","lang":"typescript","path":"src/worker.ts"}`
</examples>

<critical>
- `pat` is required
- Set `lang` explicitly to constrain matching when path pattern spans mixed-language trees
- Avoid repo-root AST scans when the target is language-specific; narrow `path` first
- Treat parse issues as query failure, not evidence of absence: repair the pattern or tighten `path`/`glob`/`lang` before concluding "no matches"
- If exploration is broad/open-ended across subsystems, use Task tool with explore subagent first
</critical>