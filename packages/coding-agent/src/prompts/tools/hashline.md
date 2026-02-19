# Edit

Apply precise file edits using `LINE#ID` anchors from `read` output.
**CRITICAL:** anchors are `LINE#ID` only. Copy verbatim from the prefix (example: `{{hlineref 42 "const x = 1"}}`). Never include `|content`.

<workflow>
1. `read` the target range to capture current `LINE#ID` anchors.
2. Pick the smallest operation per change site (line/range/insert/content-replace).
3. Direction-lock every edit: exact current text -> intended text.
4. Submit one `edit` call per file containing all operations.
5. If another edit is needed in that file, re-read first (hashes changed).
6. Output tool calls only; no prose.
</workflow>

<operations>
- **Single line replace/delete**
  - `{ target: "LINE#ID", new_content: ["..."] }`
  - `new_content: null` deletes the line; `new_content: [""]` keeps a blank line.
- **Range replace/delete**
  - `{ first: "LINE#ID", last: "LINE#ID", new_content: ["..."] }`
  - Use for swaps, block rewrites, or deleting a full span (`new_content: null`).
- **Insert** (new content)
  - `{ before: "LINE#ID", inserted_lines: ["..."] }`
  - `{ after: "LINE#ID", inserted_lines: ["..."] }`
  - `{ after: "LINE#ID", before: "LINE#ID", inserted_lines: ["..."] }` (between adjacent anchors; safest for blocks)
  - `inserted_lines` must be non-empty.
{{#if allowReplaceText}}
- **Content replace** (fallback when anchors unavailable)
  - `{ old_text: "...", new_text: "...", all?: boolean }`
{{/if}}
- **File-level controls**
  - `{ delete: true, edits: [] }` deletes the file (cannot be combined with `rename`).
  - `{ rename: "new/path.ts", edits: [...] }` writes result to new path and removes old path.
**Atomicity:** all ops validate against the same pre-edit file snapshot; refs are interpreted against last `read`; applicator applies bottom-up.
</operations>

<rules>
1. **Minimize scope:** one logical mutation site per operation.
2. **Preserve formatting:** keep indentation, punctuation, line breaks, trailing commas, brace style.
3. **Prefer insertion over neighbor rewrites:** anchor on structural boundaries (`}`, `]`, `},`) not interior property lines.
4. **No no-ops:** replacement content must differ from current content.
5. **Touch only requested code:** avoid incidental edits.
6. **Use exact current tokens:** never rewrite approximately; mutate the token that exists now.
7. **For swaps/moves:** prefer one range operation over multiple single-line operations.
</rules>

<selection_heuristics>
- One wrong line -> `{ target, new_content }`
- Adjacent block changed -> `{ first, last, new_content }`
- Missing line/block -> insert with `before`/`after` + `inserted_lines`
</selection_heuristics>

<anchor_hygiene>
- Copy anchor IDs exactly from `read` or error output.
- Never handcraft hashes.
- For inserts, prefer `after+before` dual anchors when both boundaries are known.
- Re-read after each successful edit call before issuing another on same file.
</anchor_hygiene>

<recovery>
**Hash mismatch (`>>>`)**
- Retry with the updated anchors shown in error output.
- Re-read only if required anchors are missing from error snippet.
- If mismatch repeats, stop and re-read the exact block.
**No-op / identical content**
- Re-read immediately; target is stale or replacement equals current text.
- After two no-ops on same area, re-read the full function/block before retry.
</recovery>

<example name="single line replace — fix a value or type">
```ts
{{hlinefull 23 "  const timeout: number = 5000;"}}
```
```
target: "{{hlineref 23 "  const timeout: number = 5000;"}}"
new_content: ["  const timeout: number = 30_000;"]
```
</example>

<example name="single line delete — remove a line entirely">
```ts
{{hlinefull 7 "// @ts-ignore"}}
{{hlinefull 8 "const data = fetchSync(url);"}}
```
```
target: "{{hlineref 7 "// @ts-ignore"}}"
new_content: null
```
</example>

<example name="single line blank — clear content but keep the line break">
```ts
{{hlinefull 14 "  placeholder: \"DO NOT SHIP\","}}
```
```
target: "{{hlineref 14 "  placeholder: \"DO NOT SHIP\","}}"
new_content: [""]
```
</example>

<example name="range replace — rewrite a block of logic">
```ts
{{hlinefull 60 "    } catch (err) {"}}
{{hlinefull 61 "      console.error(err);"}}
{{hlinefull 62 "      return null;"}}
{{hlinefull 63 "    }"}}
```
```
first: "{{hlineref 60 "    } catch (err) {"}}"
last: "{{hlineref 63 "    }"}}"
new_content: ["    } catch (err) {", "      if (isEnoent(err)) return null;", "      throw err;", "    }"]
```
</example>

<example name="range delete — remove a full block">
```ts
{{hlinefull 80 "  // TODO: remove after migration"}}
{{hlinefull 81 "  if (legacy) {"}}
{{hlinefull 82 "    legacyHandler(req);"}}
{{hlinefull 83 "  }"}}
```
```
first: "{{hlineref 80 "  // TODO: remove after migration"}}"
last: "{{hlineref 83 "  }"}}"
new_content: null
```
</example>

<example name="insert with before — add an import above the first import">
```ts
{{hlinefull 1 "import * as fs from \"node:fs/promises\";"}}
{{hlinefull 2 "import * as path from \"node:path\";"}}
```
```
before: "{{hlineref 1 "import * as fs from \"node:fs/promises\";"}}"
inserted_lines: ["import * as os from \"node:os\";"]
```
Use `before` when prepending at the top of a block or file — there is no meaningful anchor above.
</example>

<example name="insert with after — append at end of file">
```ts
{{hlinefull 260 "export { serialize, deserialize };"}}
```
```
after: "{{hlineref 260 "export { serialize, deserialize };"}}"
inserted_lines: ["export { validate };"]
```
Use `after` when appending at the bottom — there is no anchor below.
</example>

<example name="insert with after + before (dual anchor) — add an entry between known siblings">
```ts
{{hlinefull 44 "  \"build\": \"bun run compile\","}}
{{hlinefull 45 "  \"test\": \"bun test\""}}
```
```
after: "{{hlineref 44 "  \"build\": \"bun run compile\","}}"
before: "{{hlineref 45 "  \"test\": \"bun test\""}}"
inserted_lines: ["  \"lint\": \"biome check\","]
```
Dual anchors pin the insert to exactly one gap, preventing drift from edits elsewhere in the file. **Always prefer dual anchors when both boundaries are content lines.**
</example>

<example name="insert a function before another function — anchor to the target, not whitespace">
```ts
{{hlinefull 100 "  return buf.toString(\"hex\");"}}
{{hlinefull 101 "}"}}
{{hlinefull 102 ""}}
{{hlinefull 103 "export function serialize(data: unknown): string {"}}
```
```
before: "{{hlineref 103 "export function serialize(data: unknown): string {"}}"
inserted_lines: ["function validate(data: unknown): boolean {", "  return data != null && typeof data === \"object\";", "}", ""]
```
The trailing `""` in `inserted_lines` preserves the blank-line separator. **Anchor to the structural line (`export function ...`), not the blank line above it** — blank lines are ambiguous and may be added or removed by other edits.
</example>

{{#if allowReplaceText}}
<example name="content replace (fallback) — when anchors are unavailable">
```
old_text: "x = 42"
new_text: "x = 99"
```
Use only when line anchors aren't available. `old_text` must match exactly one location in the file (or set `"all": true` for all occurrences).
</example>
{{/if}}

<example name="file delete">
```
path: "src/deprecated/legacy.ts"
delete: true
```
</example>

<example name="file rename with edits — move and modify in one atomic call">
```
path: "src/utils.ts"
rename: "src/helpers/utils.ts"
edits: [..]
```
</example>

<example name="anti-pattern: anchoring to whitespace">
Bad — anchors to a blank line; fragile if blank lines shift:
```
after: "{{hlineref 102 ""}}"
inserted_lines: ["function validate() { ... }"]
```

Good — anchors to the structural target:
```
before: "{{hlineref 103 "export function serialize(data: unknown): string {"}}"
inserted_lines: ["function validate() { ... }", ""]
```
</example>

<validation>
- [ ] Payload shape is `{ "path": string, "edits": [operation, ...], "delete"?: true, "rename"?: string }`
- [ ] Every operation matches exactly one variant
- [ ] Every anchor is copied exactly as `LINE#ID` (no spaces, no `|content`)
- [ ] `new_content` / `inserted_lines` lines are raw content only (no diff markers, no anchor prefixes)
- [ ] Every replacement is meaningfully different from current content
- [ ] Scope is minimal and formatting is preserved except targeted token changes
</validation>
**Final reminder:** anchors are immutable references to the last read snapshot. Re-read when state changes, then edit.