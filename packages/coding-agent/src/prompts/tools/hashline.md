# Edit (Hash Anchored)

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
  - `new_content: []` deletes the line; `new_content: [""]` keeps a blank line.
- **Range replace/delete**
  - `{ first: "LINE#ID", last: "LINE#ID", new_content: ["..."] }`
  - Use for swaps, block rewrites, or deleting a full span (`new_content: []`).
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

<example name="single-line token fix (set)">
```ts
{{hlinefull 41 "  return record != null && record.status === 'fulfilled';"}}
```
```json
{ target: "{{hlineref 41 "  return record != null && record.status === 'fulfilled';"}}", new_content: ["  return record != null && record?.status === 'fulfilled';"] }
```
</example>

<example name="restore missing declaration (insert before)">
```ts
{{hlinefull 15 "export function useX(...): boolean {"}}
{{hlinefull 16 "  useEffect(() => {"}}
```
```json
{ before: "{{hlineref 16 "  useEffect(() => {"}}", inserted_lines: ["  const [isVisible, setIsVisible] = useState(true);"] }
```
</example>

<example name="insert between siblings (after+before)">
```ts
{{hlinefull 120 "      doFirst();"}}
{{hlinefull 121 "      doThird();"}}
```
```json
{ after: "{{hlineref 120 "      doFirst();"}}", before: "{{hlineref 121 "      doThird();"}}", inserted_lines: ["      doSecond();"] }
```
</example>

<example name="swap adjacent lines atomically (set_range)">
```ts
{{hlinefull 190 "      thenable.then(resolve, ignoreReject);"}}
{{hlinefull 191 "      chunkCache.set(chunkId, thenable);"}}
```
```json
{ first: "{{hlineref 190 "      thenable.then(resolve, ignoreReject);"}}", last: "{{hlineref 191 "      chunkCache.set(chunkId, thenable);"}}", new_content: ["      chunkCache.set(chunkId, thenable);", "      thenable.then(resolve, ignoreReject);"] }
```
</example>

<example name="insert guard before comment">
```ts
{{hlinefull 188 ""}}
{{hlinefull 189 "          // If we don't find a Fiber on the comment..."}}
```
```json
{ after: "{{hlineref 188 ""}}", inserted_lines: ["          if (targetFiber) {", "            targetInst = targetFiber;", "          }"] }
```
</example>

<example name="anti-pattern: interior anchor vs boundary anchor">
Bad:
```json
{ after: "195#d3", inserted_lines: ["  { id: \"nanogpt\", available: true },"] }
```
Good:
```json
{ after: "196#f6", before: "197#fc", inserted_lines: [" { id: \"nanogpt\", available: true },"] }
```
</example>

<example name="explicit EOF append">
```ts
{{hlinefull 260 "// last existing line"}}
```
```json
{ after: "{{hlineref 260 "// last existing line"}}", inserted_lines: ["// end marker"] }
```
</example>

{{#if allowReplaceText}}
<example name="replace fallback only">
```json
{ old_text: "x = 42", new_text: "x = 99" }
```
</example>
{{/if}}

<validation>
- [ ] Payload shape is `{ "path": string, "edits": [operation, ...], "delete"?: true, "rename"?: string }`
- [ ] Every operation matches exactly one variant
- [ ] Every anchor is copied exactly as `LINE#ID` (no spaces, no `|content`)
- [ ] `new_content` / `inserted_lines` lines are raw content only (no diff markers, no anchor prefixes)
- [ ] Every replacement is meaningfully different from current content
- [ ] Scope is minimal and formatting is preserved except targeted token changes
</validation>
**Final reminder:** anchors are immutable references to the last read snapshot. Re-read when state changes, then edit.