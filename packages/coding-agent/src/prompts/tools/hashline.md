# Edit (Hash anchored)

Line-addressed edits using hash-verified line references. Read file with hashes first, then edit by referencing `LINE:HASH` pairs.

<critical>
- Copy `LINE:HASH` refs verbatim from read output — never fabricate or guess hashes
- `replacement` (single/range) or `content` (insertAfter) contains plain replacement lines only — no `LINE:HASH|` prefix, no diff `+` markers
- On hash mismatch: use the updated `LINE:HASH` refs shown by `>>>` directly; only `read` again if you need additional lines/context
- If you already edited a file in this turn, re-read that file before the next edit to it
- For code-change requests, respond with tool calls, not prose
- Edit only requested lines. Do not reformat unrelated code.
- Direction-lock every mutation: replace the exact currently-present token/expression with the intended target token/expression; never reverse the change or "change something nearby".
</critical>

<instruction>
**Workflow:**
1. Read target file (`read` with `hashes: true`)
2. Collect the exact `LINE:HASH` refs you need
3. Submit one `edit` call with all known operations for that file
4. If another change on same file is needed later: re-read first, then edit
5. Direction-lock each operation before submitting (`exact source token/expression on target line` → `intended replacement`) and keep the mutation to one logical locus. Do not output prose; submit only the tool call.
**Edit variants:**
- `{ single: { loc: "LINE:HASH", replacement: "..." } }`
- `{ range: { start: "LINE:HASH", end: "LINE:HASH", replacement: "..." } }`
- `{ insertAfter: { loc: "LINE:HASH", content: "..." } }`

`replacement: ""` means delete (for `single`/`range`).
</instruction>

<caution>
**Preserve original formatting.** When writing `replacement`/`content`, copy each line's exact whitespace, braces, and style from the read output — then change *only* the targeted token/expression. Do not:
- Restyle braces: `import { foo }` → `import {foo}`
- Reflow arguments onto multiple lines or collapse them onto one line
- Change indentation style, trailing commas, or semicolons on lines you replace
- Use `range` over a wide span when multiple `single` ops would work — wide ranges tempt reformatting everything in between

If a change spans multiple non-adjacent lines, use separate `single` operations for each — not a single `range` that includes unchanged lines in `replacement`.
- Each edit operation must target one logical change site with minimal scope. If a fix requires two locations, use two operations; never span unrelated lines in one `range`.
- Self-check before submitting: if your edit touches lines unrelated to the stated fix, split or narrow it.
</caution>
<instruction>
**Recovery:**
- Hash mismatch (`>>>` error): copy the updated `LINE:HASH` refs from the error verbatim and retry with the same intended mutation. Do NOT re-read unless you need lines not shown in the error.
- If hash mismatch repeats after applying updated refs, stop blind retries and re-read the relevant region before retrying.
- After a successful edit, always re-read the file before making another edit to the same file (hashes have changed).
- No-op error ("identical content"): do not resend the same payload. Re-read the target lines, confirm mutation direction, and change either target refs or replacement content before retrying.
</instruction>

<instruction>
**Preflight schema and validation (required):**
- Payload shape is `{"path": string, "edits": [operation, ...]}` with a non-empty `edits` array.
- Each operation contains exactly one variant key: `single`, `range`, or `insertAfter`.
- Required fields by variant:
  - `single`: `loc`, `replacement`
  - `range`: `start`, `end`, `replacement`
  - `insertAfter`: `loc`, `content` (non-empty)
- Each `loc`/`start`/`end` ref matches `^\d+:[A-Za-z0-9]+$` (no spaces, no trailing source text).
- `replacement`/`content` preserves original formatting and changes only the direction-locked target locus.
</instruction>

<input>
- `path`: File path
- `edits`: Array of edit operations (one of the variants above)
</input>

<example name="replace single line">
edit {"path":"src/app.py","edits":[{"single":{"loc":"{{hashline 2 'x = 42'}}","replacement":"  x = 99"}}]}
</example>

<example name="replace range">
edit {"path":"src/app.py","edits":[{"range":{"start":"{{hashline 5 'old_value = True'}}","end":"{{hashline 8 'return result'}}","replacement":"  combined = True"}}]}
</example>

<example name="delete lines">
edit {"path":"src/app.py","edits":[{"range":{"start":"{{hashline 5 'old_value = True'}}","end":"{{hashline 6 'unused = None'}}","replacement":""}}]}
</example>

<example name="insert after">
edit {"path":"src/app.py","edits":[{"insertAfter":{"loc":"{{hashline 3 'def hello'}}","content":"  # new comment"}}]}
</example>

<example name="multiple edits (bottom-up safe)">
edit {"path":"src/app.py","edits":[{"single":{"loc":"{{hashline 10 'return True'}}","replacement":"  return False"}},{"single":{"loc":"{{hashline 3 'def hello'}}","replacement":"  x = 42"}}]}
</example>