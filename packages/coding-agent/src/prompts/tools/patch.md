# Edit (Patch)

Patch operations on file given diff. Primary tool for existing-file edits.

<instruction>
**Hunk Headers:**
- `@@` — bare header when context lines unique
- `@@ $ANCHOR` — anchor copied verbatim from file (full line or unique substring)
**Anchor Selection:**
1. Otherwise choose highly specific anchor copied from file:
   - full function signature
   - class declaration
   - unique string literal/error message
   - config key with uncommon name
2. On "Found multiple matches": add context lines, use multiple hunks with separate anchors, or use longer anchor substring
**Context Lines:**
Use enough ` `-prefixed lines to make match unique (usually 2–8)
When editing structured blocks (nested braces, tags, indented regions), include opening and closing lines so edit stays inside block
</instruction>

<parameters>
```ts
type T =
   // Diff is one or more hunks in the same file.
   // - Each hunk begins with "@@" (anchor optional).
   // - Each hunk body only has lines starting with ' ' | '+' | '-'.
   // - Each hunk includes at least one change (+ or -).
   | { path: string, op: "update", diff: string }
   // Diff is full file content, no prefixes.
   | { path: string, op: "create", diff: string }
   // No diff for delete.
   | { path: string, op: "delete" }
   // New path for update+move.
   | { path: string, op: "update", rename: string, diff: string }
```
</parameters>

<output>
Returns success/failure; on failure, error message indicates:
- "Found multiple matches" — anchor/context not unique enough
- "No match found" — context lines don't exist in file (wrong content or stale read)
- Syntax errors in diff format
</output>

<critical>
- Always read target file before editing
- Copy anchors and context lines verbatim (including whitespace)
- Never use anchors as comments (no line numbers, location labels, placeholders like `@@ @@`)
- Do not place new lines outside intended block
- If edit fails or breaks structure, re-read file and produce new patch from current content—do not retry same diff
- **NEVER** use edit to fix indentation, whitespace, or reformat code. Formatting is a single command run once at the end (`bun fmt`, `cargo fmt`, `prettier --write`, etc.)—not N individual edits. If you see inconsistent indentation after an edit, leave it; the formatter will fix all of it in one pass.
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
- Repeating same addition in multiple hunks (duplicate blocks)
- Full-file overwrites for minor changes (acceptable for major restructures or short files)
</avoid>