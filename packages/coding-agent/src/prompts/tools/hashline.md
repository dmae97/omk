# Edit (Hash anchored)

Line-addressed edits using hash-verified line references. Read file in hashline mode, then edit by referencing `LINE:HASH` pairs.

<critical>
- Copy `LINE:HASH` refs verbatim from read output — never fabricate or guess hashes
- `new_text` (set_line/replace_lines) or `text` (insert_after) contains plain replacement lines only — no `LINE:HASH` prefix, no diff `+` markers
- On hash mismatch: use the updated `LINE:HASH` refs shown by `>>>` directly; only `read` again if you need additional lines/context
- If you already edited a file in this turn, re-read that file before the next edit to it
- For code-change requests, respond with tool calls, not prose
- Edit only requested lines. Do not reformat unrelated code.
- Direction-lock every mutation: replace the exact currently-present token/expression with the intended target token/expression; never reverse the change or "change something nearby".
- `new_text` must differ from the current line content — sending identical content is rejected as a no-op
</critical>

<instruction>
**Workflow:**
1. Read target file (`read`)
2. Collect the exact `LINE:HASH` refs you need
3. Submit one `edit` call with all known operations for that file
4. If another change on same file is needed later: re-read first, then edit
5. Direction-lock each operation before submitting (`exact source token/expression on target line` → `intended replacement`) and keep the mutation to one logical locus. Do not output prose; submit only the tool call.
**Atomicity:** All edits in one call are validated against the file as last read — line numbers and hashes refer to the original state, not after earlier edits in the same array. The applicator sorts and applies bottom-up automatically.
**Edit variants:**
- `{ set_line: { anchor: "LINE:HASH", new_text: "..." } }`
- `{ replace_lines: { start_anchor: "LINE:HASH", end_anchor: "LINE:HASH", new_text: "..." } }`
- `{ insert_after: { anchor: "LINE:HASH", text: "..." } }`
- `{ replace: { old_text: "...", new_text: "...", all?: boolean } }` — substr-style fuzzy replace (no LINE:HASH; use when line refs unavailable)

`new_text: ""` means delete (for `set_line`/`replace_lines`).
</instruction>

<caution>
**Preserve original formatting.** When writing `new_text`/`text`, copy each line's exact whitespace, braces, and style from the read output — then change *only* the targeted token/expression. Do not:
- Restyle braces: `import { foo }` → `import {foo}`
- Reflow arguments onto multiple lines or collapse them onto one line
- Change indentation style, trailing commas, or semicolons on lines you replace
- Do NOT use `replace_lines` over a wide span when multiple `set_line` ops would work — wide ranges tempt reformatting everything in between

If a change spans multiple non-adjacent lines, use separate `set_line` operations for each — not a single `replace_lines` that includes unchanged lines in `new_text`.
- Each edit operation must target one logical change site with minimal scope. If a fix requires two locations, use two operations; never span unrelated lines in one `replace_lines`.
- Self-check before submitting: if your edit touches lines unrelated to the stated fix, split or narrow it.
- Do NOT reformat lines you are replacing — preserve exact whitespace, braces (`{ foo }` not `{foo}`), arrow style, and line breaks. Change ONLY the targeted token/expression. Reformatting causes hash verification failure even when the logic is correct.
- For swaps (exchanging content between two locations), use two `set_line` operations in one call — the applicator handles ordering. Do not try to account for line number shifts between operations.
</caution>
<instruction>
**Recovery:**
- Hash mismatch (`>>>` error): copy the updated `LINE:HASH` refs from the error verbatim and retry with the same intended mutation. Do NOT re-read unless you need lines not shown in the error.
- If hash mismatch repeats after applying updated refs, stop blind retries and re-read the relevant region before retrying.
- After a successful edit, always re-read the file before making another edit to the same file (hashes have changed).
- No-op error ("identical content"): your replacement text matches what the file already contains. STOP and re-read the file — you are likely targeting the wrong line or your replacement is not actually different. Do NOT retry with the same content. After 2 consecutive no-op errors on the same line, re-read the entire function/block to understand the current file state.
</instruction>

<instruction>
**Preflight schema and validation (required):**
- Payload shape is `{"path": string, "edits": [operation, ...]}` with a non-empty `edits` array.
- Each operation contains exactly one variant key: `set_line`, `replace_lines`, `insert_after`, or `replace`.
- Required fields by variant:
  - `set_line`: `anchor`, `new_text`
  - `replace_lines`: `start_anchor`, `end_anchor`, `new_text`
  - `insert_after`: `anchor`, `text` (non-empty)
  - `replace`: `old_text`, `new_text` (fuzzy match; `all: true` for replace-all)
- Each `anchor`/`start_anchor`/`end_anchor` ref matches `^\d+:[A-Za-z0-9]+$` (no spaces, no trailing source text).
- `new_text`/`text` preserves original formatting and changes only the direction-locked target locus.
</instruction>

<input>
- `path`: File path
- `edits`: Array of edit operations (one of the variants above)
</input>

<example name="replace single line">
edit {"path":"src/app.py","edits":[{"set_line":{"anchor":"{{hashline 2 'x = 42'}}","new_text":"  x = 99"}}]}
</example>

<example name="replace range">
edit {"path":"src/app.py","edits":[{"replace_lines":{"start_anchor":"{{hashline 5 'old_value = True'}}","end_anchor":"{{hashline 8 'return result'}}","new_text":"  combined = True"}}]}
</example>

<example name="delete lines">
edit {"path":"src/app.py","edits":[{"replace_lines":{"start_anchor":"{{hashline 5 'old_value = True'}}","end_anchor":"{{hashline 6 'unused = None'}}","new_text":""}}]}
</example>

<example name="insert after">
edit {"path":"src/app.py","edits":[{"insert_after":{"anchor":"{{hashline 3 'def hello'}}","text":"  # new comment"}}]}
</example>

<example name="multiple edits (bottom-up safe)">
edit {"path":"src/app.py","edits":[{"set_line":{"anchor":"{{hashline 10 'return True'}}","new_text":"  return False"}},{"set_line":{"anchor":"{{hashline 3 'def hello'}}","new_text":"  x = 42"}}]}
</example>

<example name="content replace (substr-style, no hashes)">
edit {"path":"src/app.py","edits":[{"replace":{"old_text":"x = 42","new_text":"x = 99"}}]}
</example>