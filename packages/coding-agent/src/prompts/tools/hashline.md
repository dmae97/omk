# Edit (Hash Anchored)

Line-addressed edits using hash-verified line references. Read files in hashline mode, collect exact `LINE:HASH` references, and submit edits that change only the targeted token or expression.
**CRITICAL: Copy `LINE:HASH` refs verbatim from read output. Use only the anchor prefix (e.g., `{{hashline 42 "const x = 1"}}`), never the trailing source text after `|`.**

<workflow>
1. Read the target file (`read`) to obtain `LINE:HASH` references
2. Collect the exact `LINE:HASH` refs for lines you will change
3. Direction-lock each mutation: identify the exact current token/expression → the intended replacement
4. Submit one `edit` call containing all operations for that file
5. If another edit is needed on the same file: re-read first, then edit (hashes change after every edit)
6. Respond with tool calls only — no prose
</workflow>

<operations>
Four edit variants are available:
- **`set_line`**: Replace a single line
  `{ set_line: { anchor: "LINE:HASH", new_text: "..." } }`
  `new_text: ""` keeps the line but makes it blank.
- **`replace_lines`**: Replace a contiguous range (use for deletions with `new_text: ""`)
  `{ replace_lines: { start_anchor: "LINE:HASH", end_anchor: "LINE:HASH", new_text: "..." } }`
- **`insert_after`**: Add new content after an anchor line
  `{ insert_after: { anchor: "LINE:HASH", text: "..." } }`
- **`replace`**: Substring-style fuzzy match (when line refs are unavailable)
  `{ replace: { old_text: "...", new_text: "...", all?: boolean } }`
**Atomicity:** All edits in one call validate against the file as last read. Line numbers and hashes refer to the original state, not post-edit state. The applicator sorts and applies bottom-up automatically.
</operations>

<rules>
1. **Scope each operation minimally.** One logical change site per operation. Use separate `set_line` ops for non-adjacent lines instead of a wide `replace_lines` that spans unchanged code.
2. **Preserve original formatting exactly.** Copy each line's whitespace, braces, semicolons, trailing commas, and style — then change only the targeted token/expression. Keep `import { foo }` as-is; keep indentation and line breaks as-is.
3. **Use `insert_after` for additions.** When adding a field, argument, or import near existing lines, prefer `insert_after` over replacing a neighboring line.
4. **Ensure `new_text` differs from current content.** Identical content is rejected as a no-op.
5. **Edit only requested lines.** Leave unrelated code untouched.
6. **Lock mutation direction.** Replace the exact currently-present token with the intended target. For swaps between two locations, use two `set_line` ops in one call.
</rules>

<recovery>
**Hash mismatch (`>>>` error):**
→ Copy the updated `LINE:HASH` refs from the error output verbatim and retry with the same intended mutation.
→ Re-read only if you need lines not shown in the error.
→ If mismatch repeats after applying updated refs, stop and re-read the relevant region.
**No-op error ("identical content"):**
→ Stop. Re-read the file — you are targeting the wrong line or your replacement is not different.
→ After 2 consecutive no-op errors on the same line, re-read the entire function/block.
</recovery>

<examples>
<example name="replace single line">
set_line: { anchor: "{{hashline 2 "  x"}}", new_text: "  x = 99" }
</example>

<example name="replace range">
replace_lines: { start_anchor: "{{hashline 5 "old start line"}}", end_anchor: "{{hashline 8 "old end line"}}", new_text: "  combined = True" }
</example>

<example name="delete lines">
replace_lines: { start_anchor: "{{hashline 5 "line to delete A"}}", end_anchor: "{{hashline 6 "line to delete B"}}", new_text: "" }
</example>

<example name="insert after">
insert_after: { anchor: "{{hashline 3 "anchor line content"}}", text: "  # new comment" }
</example>

<example name="multiple edits (bottom-up safe)">
set_line: { anchor: "{{hashline 10 "old line 10"}}", new_text: "  return False" }
set_line: { anchor: "{{hashline 3 "old line 3"}}", new_text: "  x = 42" }
</example>

<example name="content replace (substr-style, no hashes)">
replace: { old_text: "x = 42", new_text: "x = 99" }
</example>
</examples>

<validation>
Before submitting, verify:
- [ ] Payload shape: `{"path": string, "edits": [operation, ...]}`  with non-empty `edits` array
- [ ] Each operation has exactly one variant key: `set_line` | `replace_lines` | `insert_after` | `replace`
- [ ] Each anchor is copied exactly from the `LINE:HASH` prefix (no spaces, no trailing source text)
- [ ] `new_text`/`text` contains plain replacement lines only — no `LINE:HASH` prefixes, no diff `+` markers
- [ ] Each replacement differs from the current line content
- [ ] Each operation targets one logical change site with minimal scope
- [ ] Formatting of replaced lines matches the original exactly, except for the targeted change
</validation>
**REMINDER: Copy `LINE:HASH` refs verbatim. Anchors are `LINE:HASH` only — never `LINE:HASH|content`. Preserve exact formatting. Change only the targeted token.**