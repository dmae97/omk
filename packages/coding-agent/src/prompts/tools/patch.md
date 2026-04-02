Patches files given diff hunks. Primary tool for existing-file edits.

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
{{#if editManageImportsEnabled}}
**Imports:**
- `imports` is **OPTIONAL**. Use it when the edit adds code that now requires new imports/includes.
- Each entry starts with `from` and **MAY** include named `imports`, `default`, `namespace`, `alias`, or `system`, depending on language.
- Import management runs after the main edit, so the diff should focus on the code change and `imports` should describe declarations to merge or add.
{{/if}}
</instruction>

<parameters>
```ts
type T =
   // Diff is one or more hunks in the same file.
   // - Each hunk begins with "@@" (anchor optional).
   // - Each hunk body only has lines starting with ' ' | '+' | '-'.
   // - Each hunk includes at least one change (+ or -).
  | { path: string, op: "update", diff: string{{#if editManageImportsEnabled}}, imports?: ImportSpec[]{{/if}} }
   // Diff is full file content, no prefixes.
  | { path: string, op: "create", diff: string{{#if editManageImportsEnabled}}, imports?: ImportSpec[]{{/if}} }
   // No diff for delete.
   | { path: string, op: "delete" }
{{#if editManageImportsEnabled}}

type ImportSpec = {
  from: string;
  imports?: string[];
  default?: string;
  namespace?: string;
  alias?: string;
  system?: boolean;
}
{{/if}}
```
</parameters>

<output>
Returns success/failure; on failure, error message indicates:
- "Found multiple matches" — anchor/context not unique enough
- "No match found" — context lines don't exist in file (wrong content or stale read)
- Syntax errors in diff format
</output>

<critical>
- You **MUST** read the target file before editing
- You **MUST** copy anchors and context lines verbatim (including whitespace)
- You **MUST NOT** use anchors as comments (no line numbers, location labels, placeholders like `@@ @@`)
- You **MUST NOT** place new lines outside the intended block
- If edit fails or breaks structure, you **MUST** re-read the file and produce a new patch from current content — you **MUST NOT** retry the same diff
- **NEVER** use edit to fix indentation, whitespace, or reformat code. Formatting is a single command run once at the end (`bun fmt`, `cargo fmt`, `prettier —write`, etc.)—not N individual edits. If you see inconsistent indentation after an edit, leave it; the formatter will fix all of it in one pass.
</critical>

{{#if editManageImportsEnabled}}
<example name="update">
```json
{
  "path": "src/app.ts",
  "op": "update",
  "diff": "@@ function run() {\n function run() {\n-\treturn value;\n+\treturn format(value);\n }\n",
  "imports": [
    {
      "from": "./format",
      "imports": ["format"]
    }
  ]
}
```
`imports` are merged after the diff applies, so existing imports are reused when possible and only missing declarations are added.
</example>

<example name="typescript-mixed-import">
```json
{
  "path": "src/app.ts",
  "op": "update",
  "diff": "@@\n ...\n",
  "imports": [
    {
      "from": "react",
      "default": "React",
      "imports": [
        "useMemo",
        "type FC",
        "useState"
      ]
    }
  ]
}
```
Use only supported fields: `from`, optional `imports`, `default`, `namespace`, `alias`, and `system`.
</example>
{{/if}}

<avoid>
{{#if editManageImportsEnabled}}
- Do not duplicate imports already present in the file; describe the desired imports once and let merge logic dedupe.
- Do not rely on `imports` to perform unrelated code edits; it only manages import/include declarations after the main edit.
{{/if}}
</avoid>
