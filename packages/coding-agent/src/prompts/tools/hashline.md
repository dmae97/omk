# Edit (Hash Anchored)

Apply precise file edits using `LINE#ID` anchors from `read` output.
**CRITICAL:** anchors are `LINE#ID` only. Copy verbatim from the prefix (example: `{{hlineref 42 "const x = 1"}}`). Never include `|content`.

<workflow>
1. `read` the target range to capture current `LINE#ID` anchors.
2. Pick the smallest operation per change site (`set`/`set_range`/`insert`/`replace`).
3. Direction-lock every edit: exact current text -> intended text.
4. Submit one `edit` call per file containing all operations.
5. If another edit is needed in that file, re-read first (hashes changed).
6. Output tool calls only; no prose.
</workflow>

<operations>
- **`set`** (single line replace/delete)
  - `{ set: { ref: "LINE#ID", body: ["..."] } }`
  - `body: []` deletes the line; `body: [""]` keeps a blank line.
- **`set_range`** (contiguous multi-line replace/delete)
  - `{ set_range: { beg: "LINE#ID", end: "LINE#ID", body: ["..."] } }`
  - Use for swaps, block rewrites, or deleting a full span (`body: []`).
- **`insert`** (new content)
  - `{ insert: { before: "LINE#ID", body: ["..."] } }`
  - `{ insert: { after: "LINE#ID", body: ["..."] } }`
  - `{ insert: { after: "LINE#ID", before: "LINE#ID", body: ["..."] } }` (between adjacent anchors; safest for blocks)
  - `{ insert: { body: ["..."] } }` (append EOF only when intentional)
- **`replace`** (fuzzy text fallback when anchors unavailable)
  - `{ replace: { old_text: "...", new_text: "...", all?: boolean } }`
**Atomicity:** all ops validate against the same pre-edit file snapshot; refs are interpreted against last `read`; applicator applies bottom-up.
</operations>

<rules>
1. **Minimize scope:** one logical mutation site per operation.
2. **Preserve formatting:** keep indentation, punctuation, line breaks, trailing commas, brace style.
3. **Prefer insertion over neighbor rewrites:** anchor on structural boundaries (`}`, `]`, `},`) not interior property lines.
4. **No no-ops:** replacement body must differ from current content.
5. **Touch only requested code:** avoid incidental edits.
6. **Use exact current tokens:** never "rewrite approximately"; mutate the token that exists now.
7. **For swaps/moves:** prefer one `set_range` over multiple conflicting `set`s.
</rules>

<selection_heuristics>
- One wrong line -> `set`
- Adjacent block changed -> `set_range`
- Missing line/block -> `insert`
- Cannot trust line anchors (generated/unknown offsets) -> `replace` (last resort)
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

<examples>
<example name="single-line token fix (set)">
Read:
{{hlinefull 41 "  return record != null && record.status === 'fulfilled';"}}
Edit:
set: { ref: "{{hlineref 41 "  return record != null && record.status === 'fulfilled';"}}", body: ["  return record != null && record?.status === 'fulfilled';"] }
</example>

<example name="restore missing declaration (insert before)">
Read:
{{hlinefull 15 "export function useX(...): boolean {"}}
{{hlinefull 16 "  useEffect(() => {"}}
Edit:
insert: { before: "{{hlineref 16 "  useEffect(() => {"}}", body: ["  const [isVisible, setIsVisible] = useState(true);"] }
</example>

<example name="insert between siblings (after+before)">
Read:
{{hlinefull 120 "      doFirst();"}}
{{hlinefull 121 "      doThird();"}}
Edit:
insert: { after: "{{hlineref 120 "      doFirst();"}}", before: "{{hlineref 121 "      doThird();"}}", body: ["      doSecond();"] }
</example>

<example name="swap adjacent lines atomically (set_range)">
Read:
{{hlinefull 190 "      thenable.then(resolve, ignoreReject);"}}
{{hlinefull 191 "      chunkCache.set(chunkId, thenable);"}}
Edit:
set_range: { beg: "{{hlineref 190 "      thenable.then(resolve, ignoreReject);"}}", end: "{{hlineref 191 "      chunkCache.set(chunkId, thenable);"}}", body: ["      chunkCache.set(chunkId, thenable);", "      thenable.then(resolve, ignoreReject);"] }
</example>

<example name="insert guard before comment">
Read:
{{hlinefull 188 ""}}
{{hlinefull 189 "          // If we don't find a Fiber on the comment..."}}
Edit:
insert: { after: "{{hlineref 188 ""}}", body: ["          if (targetFiber) {", "            targetInst = targetFiber;", "          }"] }
</example>

<example name="anti-pattern: interior anchor vs boundary anchor">
Bad:
insert: { after: "195#d3", body: ["  { id: \"nanogpt\", available: true },"] }
Good:
insert: { after: "196#f6", before: "197#fc", body: [" { id: \"nanogpt\", available: true },"] }
</example>

<example name="explicit EOF append">
insert: { body: ["// end marker"] }
</example>

<example name="replace fallback only">
replace: { old_text: "x = 42", new_text: "x = 99" }
</example>
</examples>

<validation>
- [ ] Payload shape is `{ "path": string, "edits": [operation, ...] }` and `edits` is non-empty
- [ ] Every operation has exactly one variant key: `set` | `set_range` | `insert` | `replace`
- [ ] Every anchor is copied exactly as `LINE#ID` (no spaces, no `|content`)
- [ ] `body` lines are raw content only (no diff markers, no anchor prefixes)
- [ ] Every replacement is meaningfully different from current content
- [ ] Scope is minimal and formatting is preserved except targeted token changes
</validation>
**Final reminder:** anchors are immutable references to the last read snapshot. Re-read when state changes, then edit.