# Edit (Hash anchored)

Line-addressed edits using hash-verified line references. Read file with hashes first, then edit by referencing `LINE:HASH` pairs.

<critical>
- Copy `LINE:HASH` refs verbatim from read output — never fabricate or guess hashes
- `content` contains plain replacement lines only — no `LINE:HASH|` prefix, no diff `+` markers
- On hash mismatch: use the updated `LINE:HASH` refs shown by `>>>` directly; only `read` again if you need additional lines/context
- If you already edited a file in this turn, re-read that file before the next edit to it
- For code-change requests, respond with tool calls, not prose
- Edit only requested lines. Do not reformat unrelated code.
- Do not submit a replacement whose content is identical to the current line. If unsure, re-read the target lines first.
</critical>

<instruction>
**Workflow:**
1. Read target file (`read` with `hashes: true`)
2. Collect the exact `LINE:HASH` refs you need
3. Submit one `edit` call with all known operations for that file
4. If another change on same file is needed later: re-read first, then edit
5. Internally verify direction before submitting (`before token/expression` → `after token/expression`). Do not output prose; submit only the tool call.
**Edit variants:**
- `{ replaceLine: { loc: "LINE:HASH", content: "..." } }`
- `{ replaceLines: { start: "LINE:HASH", end: "LINE:HASH", content: "..." } }`
- `{ insertAfter: { loc: "LINE:HASH", content: "..." } }`

`content: ""` means delete (for `replaceLine`/`replaceLines`).
</instruction>

<caution>
**Preserve original formatting.** When writing `content`, copy each line's exact whitespace, braces, and style from the read output — then change *only* the targeted token/expression. Do not:
- Restyle braces: `import { foo }` → `import {foo}`
- Reflow arguments onto multiple lines or collapse them onto one line
- Change indentation style, trailing commas, or semicolons on lines you replace
- Use `replaceLines` over a wide range when multiple `replaceLine` ops would work — wide ranges tempt reformatting everything in between

If a change spans multiple non-adjacent lines, use separate `replaceLine` operations for each — not a single `replaceLines` that includes unchanged lines in `content`.
- Each edit operation must target a single logical change site. If a fix requires changes at two separate locations, use two separate edit operations — never a single `replaceLines` spanning both.
- Self-check before submitting: if your edit would touch lines unrelated to the stated fix, split or narrow it.
</caution>
<instruction>
**Recovery:**
- Hash mismatch (`>>>` error): copy the updated `LINE:HASH` refs from the error verbatim and retry. Do NOT re-read the file unless you need lines not shown in the error.
- After a successful edit, always re-read the file before making another edit to the same file (hashes have changed).
- No-op error ("identical content"): your replacement content matches what's already in the file. Re-read the target lines — the mutation is likely on a different line or the content has already been fixed.
</instruction>

<instruction>
**Before submitting each edit call, verify:**
- `path` is set and points to the correct file
- Each `loc`/`start`/`end` ref matches `^\d+:[A-Za-z0-9]+$` — no spaces, no content after hash
- `content` reproduces the original line's formatting with only the targeted change applied
</instruction>

<input>
- `path`: File path
- `edits`: Array of edit operations (one of the variants above)
</input>

<example name="replace single line">
edit {"path":"src/app.py","edits":[{"replaceLine":{"loc":"{{hashline 2 'x = 42'}}","content":"  x = 99"}}]}
</example>

<example name="replace range">
edit {"path":"src/app.py","edits":[{"replaceLines":{"start":"{{hashline 5 'old_value = True'}}","end":"{{hashline 8 'return result'}}","content":"  combined = True"}}]}
</example>

<example name="delete lines">
edit {"path":"src/app.py","edits":[{"replaceLines":{"start":"{{hashline 5 'old_value = True'}}","end":"{{hashline 6 'unused = None'}}","content":""}}]}
</example>

<example name="insert after">
edit {"path":"src/app.py","edits":[{"insertAfter":{"loc":"{{hashline 3 'def hello'}}","content":"  # new comment"}}]}
</example>

<example name="multiple edits (bottom-up safe)">
edit {"path":"src/app.py","edits":[{"replaceLine":{"loc":"{{hashline 10 'return True'}}","content":"  return False"}},{"replaceLine":{"loc":"{{hashline 3 'def hello'}}","content":"  x = 42"}}]}
</example>