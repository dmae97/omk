# Patch

Performs patch operations on a file given a diff.
This is your primary tool for making changes to existing files.

<critical>
- Always read the target file before editing.
- Copy anchors + context lines verbatim (including whitespace).
- Output the clean patch format below.
</critical>

<parameters>
```ts
type T = 
   // Diff is one or more hunks, within the same file.
   // - Each hunk begins with "@@" (optionally with an anchor).
   // - Each hunk body contains only lines starting with: ' ' | '+' | '-'.
   // - Each hunk must include at least one real change (+ or -). No no-op hunks.
   | { path: string, op: "update", diff: string }
   // Diff is the full file content, no prefixes.
   | { path: string, op: "create", diff: string }
   // Omit diff for delete operation.
   | { path: string, op: "delete" }
   // New path for update-and-move operation.
   | { path: string, op: "update", rename: string, diff: string }
```
</parameters>

<hunk_header>
Allowed:
- `@@`
- `@@ $ANCHOR`

ANCHOR RULES:
- `$ANCHOR` MUST be copied verbatim from the file as either:
  - a full existing line, OR
  - a unique substring of a single existing line.
- NEVER use it as a comment:
  - line numbers / ranges: `line 207`, `lines 26-37`
  - location labels: `top of file`, `start`, `near imports`
  - placeholders: `@@ @@`, `...`
</hunk_header>

<anchor_selection>
ANCHOR SELECTION ALGORITHM (use in this order):
1) If the surrounding context lines are already unique in the file, use bare `@@`.
2) Else choose an anchor that is highly specific and stable, copied from the file, e.g.:
   - full function signature line
   - class declaration line
   - a unique string literal / error message
   - a config key with uncommon name
3) If you get "Found multiple matches", escalate by:
   - adding more context lines, OR
   - using multiple hunks with separate nearby anchors, OR
   - using a more specific anchor substring (longer, includes identifiers).
NEVER use generic anchors like `import`, `export`, `describe`, `function`, `const`.
</anchor_selection>

<context_rules>
- Include enough context lines (' ' prefixed) to make the match unique (usually 2–8 total).
- Context lines must exist in the file exactly as written; preserve indentation/trailing spaces.
</context_rules>

<example name="create">
edit {"path":"hello.txt","op":"create","diff":"Hello\n"}
</example>

<example name="update">
edit {"path":"src/app.py","op":"update","diff":"@@ def greet():\n def greet():\n-print('Hi')\n+print('Hello')\n"}
</example>

<example name="rename">
edit {"path":"src/app.py","op":"update","rename":"src/main.py","diff":"@@\n ...\n"}
</example>

<example name="delete">
edit {"path":"obsolete.txt","op":"delete"}
</example>
