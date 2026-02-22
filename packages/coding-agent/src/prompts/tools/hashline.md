# Edit

Apply precise file edits using `LINE#ID` tags, anchoring to the file content.

<workflow>
1. You MUST `read` the target range to capture current `LINE#ID` tags.
2. You MUST pick the smallest operation per change site (line/range/insert/content-replace).
3. You MUST direction-lock every edit: exact current text → intended text.
4. You MUST submit one `edit` call per file containing all operations.
5. If another edit is needed in that file, you MUST re-read first (hashes changed).
6. You MUST output tool calls only; no prose.
</workflow>

<operations>
- **Line or range replace/delete**
  - `{ op: "replace", tag: "N#ID", content: […] }`
  - `{ op: "replace", first: "N#ID", last: "N#ID", content: […] }`
  - Use for swaps, block rewrites, or deleting a full span (`content: null`).
- **Insert** (new content)
  - `{ op: "prepend", before: "N#ID", content: […] }` or `{ op: "prepend", content: […] }` (no `before` = insert at beginning of file)
  - `{ op: "append", after: "N#ID", content: […] }` or `{ op: "append", content: […] }` (no `after` = insert at end of file)
  - `{ op: "insert", after: "N#ID", before: "N#ID", content: […] }` (between adjacent anchors; safest for blocks)
- **File-level controls**
  - `{ delete: true, edits: [] }` deletes the file (cannot be combined with `rename`).
  - `{ rename: "new/path.ts", edits: […] }` writes result to new path and removes old path.
**Atomicity:** all ops validate against the same pre-edit file snapshot; refs are interpreted against last `read`; applicator applies bottom-up.
</operations>

<rules>
1. **Minimize scope:** You MUST use one logical mutation site per operation.
2. **Preserve formatting:** You MUST keep indentation, punctuation, line breaks, trailing commas, brace style.
3. **Prefer insertion over neighbor rewrites:** You SHOULD anchor on structural boundaries (`}`, `]`, `},`) not interior property lines.
4. **No no-ops:** replacement content MUST differ from current content.
5. **Touch only requested code:** You MUST NOT make incidental edits.
6. **Use exact current tokens:** You MUST NOT rewrite approximately; mutate the token that exists now.
7. **For swaps/moves:** You SHOULD prefer one range operation over multiple single-line operations.
</rules>

<op-choice>
- One wrong line → MUST use `set`
- Adjacent block changed → MUST use `insert`
- Missing line/block → MUST use `append`/`prepend`
</op-choice>

<tag-choice>
- You MUST copy tags exactly from the prefix of the `read` or error output.
- You MUST NOT guess tags.
- For inserts, you SHOULD prefer `insert` > `append`/`prepend` when both boundaries are known.
- You MUST re-read after each successful edit call before issuing another on same file.
</tag-choice>

<recovery>
**Tag mismatch (`>>>`)**
- You MUST retry with the updated tags shown in error output.
- You MUST re-read only if required tags are missing from error snippet.
- If mismatch repeats, you MUST stop and re-read the exact block.
</recovery>

<example name="fix a value or type">
```ts
{{hlinefull 23 "  const timeout: number = 5000;"}}
```
```
op: "replace"
tag: "{{hlineref 23 "  const timeout: number = 5000;"}}"
content: ["  const timeout: number = 30_000;"]
```
</example>

<example name="remove a line entirely">
```ts
{{hlinefull 7 "// @ts-ignore"}}
{{hlinefull 8 "const data = fetchSync(url);"}}
```
```
op: "replace"
tag: "{{hlineref 7 "// @ts-ignore"}}"
content: null
```
</example>

<example name="clear content but keep the line break">
```ts
{{hlinefull 14 "  placeholder: \"DO NOT SHIP\","}}
```
```
op: "replace"
tag: "{{hlineref 14 "  placeholder: \"DO NOT SHIP\","}}"
content: [""]
```
</example>

<example name="rewrite a block of logic">
```ts
{{hlinefull 60 "    } catch (err) {"}}
{{hlinefull 61 "      console.error(err);"}}
{{hlinefull 62 "      return null;"}}
{{hlinefull 63 "    }"}}
```
```
op: "replace"
first: "{{hlineref 60 "    } catch (err) {"}}"
last: "{{hlineref 63 "    }"}}"
content: ["    } catch (err) {", "      if (isEnoent(err)) return null;", "      throw err;", "    }"]
```
</example>

<example name="remove a full block">
```ts
{{hlinefull 80 "  // TODO: remove after migration"}}
{{hlinefull 81 "  if (legacy) {"}}
{{hlinefull 82 "    legacyHandler(req);"}}
{{hlinefull 83 "  }"}}
```
```
op: "replace"
first: "{{hlineref 80 "  // TODO: remove after migration"}}"
last: "{{hlineref 83 "  }"}}"
content: null
```
</example>

<example name="add an import above the first import">
```ts
{{hlinefull 1 "import * as fs from \"node:fs/promises\";"}}
{{hlinefull 2 "import * as path from \"node:path\";"}}
```
```
op: "prepend"
before: "{{hlineref 1 "import * as fs from \"node:fs/promises\";"}}"
content: ["import * as os from \"node:os\";"]
```
Use `before` for anchored insertion before a specific line. Omit `before` to prepend at BOF.
</example>

<example name="append at end of file">
```ts
{{hlinefull 260 "export { serialize, deserialize };"}}
```
```
op: "append"
after: "{{hlineref 260 "export { serialize, deserialize };"}}"
content: ["export { validate };"]
```
Use `after` for anchored insertion after a specific line. Omit `after` to append at EOF.
</example>

<example name="add an entry between known siblings">
```ts
{{hlinefull 44 "  \"build\": \"bun run compile\","}}
{{hlinefull 45 "  \"test\": \"bun test\""}}
```
```
op: "insert"
after: "{{hlineref 44 "  \"build\": \"bun run compile\","}}"
before: "{{hlineref 45 "  \"test\": \"bun test\""}}"
content: ["  \"lint\": \"biome check\","]
```
Dual anchors pin the insert to exactly one gap, preventing drift from edits elsewhere in the file. **Always prefer dual anchors when both boundaries are content lines.**
</example>

<example name="insert a function before another function">
```ts
{{hlinefull 100 "  return buf.toString(\"hex\");"}}
{{hlinefull 101 "}"}}
{{hlinefull 102 ""}}
{{hlinefull 103 "export function serialize(data: unknown): string {"}}
```
```
op: "insert"
before: "{{hlineref 103 "export function serialize(data: unknown): string {"}}"
content: ["function validate(data: unknown): boolean {", "  return data != null && typeof data === \"object\";", "}", ""]
```
The trailing `""` in `content` preserves the blank-line separator. **Anchor to the structural line (`export function ...`), not the blank line above it** — blank lines are ambiguous and may be added or removed by other edits.
</example>

<example name="file delete">
```
path: "src/deprecated/legacy.ts"
delete: true
```
</example>

<example name="file rename with edits">
```
path: "src/utils.ts"
rename: "src/helpers/utils.ts"
edits: […]
```
</example>

<example name="anti-pattern: anchoring to whitespace">
Bad — tags to a blank line; fragile if blank lines shift:
```
after: "{{hlineref 102 ""}}"
content: ["function validate() {", …, "}"]
```

Good — anchors to the structural target:

```
before: "{{hlineref 103 "export function serialize(data: unknown): string {"}}"
content: ["function validate() {", …, "}"]
```
</example>

<critical>
You MUST ensure:
- Payload shape is `{ "path": string, "edits": [operation, …], "delete"?: boolean, "rename"?: string }`
- Every edit MUST match exactly one variant
- Every tag MUST be copied EXACTLY from a tool result as `N#ID`
- Scope MUST be minimal and formatting MUST be preserved except targeted token changes
</critical>
**Final reminder:** tags are immutable references to the last read snapshot. You MUST re-read when state changes, then edit.