# Edit

Performs patch operations on a file given a diff. Primary tool for modifying existing files.

<instruction>
**Hunk Headers:**
- `@@` — bare header when context lines are already unique
- `@@ $ANCHOR` — anchor must be copied verbatim from the file (full line or unique substring)
**Anchor Selection Algorithm:**
1. If surrounding context lines are already unique, use bare `@@`
2. Otherwise choose a highly specific anchor copied from the file:
   - full function signature line
   - class declaration line
   - unique string literal / error message
   - config key with uncommon name
3. If "Found multiple matches" error: add more context lines, use multiple hunks with separate anchors, or use a longer anchor substring
**Context Lines:**
- Include enough ` `-prefixed lines to make match unique (usually 2–8 total)
- Must exist in the file exactly as written (preserve indentation/trailing spaces)
</instruction>

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

<output>
Returns success/failure status. On failure, returns error message indicating:
- "Found multiple matches" — anchor/context not unique enough
- "No match found" — context lines don't exist in file (wrong content or stale read)
- Syntax errors in diff format
</output>

<critical>
- Always read the target file before editing
- Copy anchors and context lines verbatim (including whitespace)
- Never use anchors as comments (no line numbers, location labels, or placeholders like `@@ @@`)
</critical>

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

<avoid>
- Generic anchors: `import`, `export`, `describe`, `function`, `const`
- Anchor comments: `line 207`, `top of file`, `near imports`, `...`
- Editing without reading the file first (causes stale context errors)
</avoid>