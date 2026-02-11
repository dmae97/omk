# Edit (Replace lines)

Line-addressed edits using hash-verified line references. Read file with hashes first, then edit by referencing `LINE:HASH` pairs.

<critical>
- Copy `LINE:HASH` refs verbatim from read output — never fabricate or guess hashes
- `dst` contains plain content lines only — no `LINE:HASH|` prefix, no diff `+` markers
- On hash mismatch: the error shows correct `LINE:HASH` refs with `>>>` markers — use those directly
- Edit only the lines that need to change. Do not reformat, restyle, adjust whitespace, change brace spacing, or break/join lines you were not asked to modify.
</critical>

<instruction>
**Workflow:**
1. Read target file (output includes `LINE:HASH| content` on every line)
2. Identify lines to change by their `LINE:HASH` prefix
3. Submit edit with `src` (line reference) and `dst` (replacement content)
**Operations:**
- **Replace single**: `src: { kind: "single", ref: "{{hashline 5 'old_value = True'}}" }` — replaces line 5
- **Replace range**: `src: { kind: "range", start: "{{hashline 5 'old_value = True'}}", end: "{{hashline 9 'return result'}}" }` — replaces lines 5-9 (fewer dst lines = net deletion)
- **Delete range**: same as replace range with `dst: ""`
- **Insert after**: `src: { kind: "insertAfter", after: "{{hashline 5 'old_value = True'}}" }` — inserts after line 5
- **Insert before**: `src: { kind: "insertBefore", before: "{{hashline 5 'old_value = True'}}" }` — inserts before line 5

Multiple edits in one call are applied bottom-up (safe for non-overlapping edits).
**`dst` rules — get this right:**
- Write only the new content — no `LINE:HASH| ` prefixes, no `+` diff markers.
- Preserve the original indentation of surrounding code.
- Do not echo anchor/boundary lines into `dst` (for insertAfter, write only the new lines — not the anchor line followed by new lines).
</instruction>

<input>
- `path`: File path
- `edits`: Array of edit operations
	- `src`: Source spec — one of:
		- `{ kind: "single", ref: "LINE:HASH" }`
		- `{ kind: "range", start: "LINE:HASH", end: "LINE:HASH" }`
		- `{ kind: "insertAfter", after: "LINE:HASH" }`
		- `{ kind: "insertBefore", before: "LINE:HASH" }`
		- `{ type: "substr", needle: "text" }`
	- `dst`: Replacement content (`\n`-separated for multi-line, `""` for delete)
</input>

<example name="replace single line">
edit {"path":"src/app.py","edits":[{"src":{"kind":"single","ref":"{{hashline 2 'x = 42'}}"},"dst":"  x = 99"}]}
</example>

<example name="replace range">
edit {"path":"src/app.py","edits":[{"src":{"kind":"range","start":"{{hashline 5 'old_value = True'}}","end":"{{hashline 8 'return result'}}"},"dst":"  combined = True"}]}
</example>

<example name="delete lines">
edit {"path":"src/app.py","edits":[{"src":{"kind":"range","start":"{{hashline 5 'old_value = True'}}","end":"{{hashline 6 'unused = None'}}"},"dst":""}]}
</example>

<example name="insert after">
edit {"path":"src/app.py","edits":[{"src":{"kind":"insertAfter","after":"{{hashline 3 'def hello'}}"},"dst":"  # new comment"}]}
</example>

<example name="insert before">
edit {"path":"src/app.py","edits":[{"src":{"kind":"insertBefore","before":"{{hashline 3 'def hello'}}"},"dst":"  # new comment"}]}
</example>

<example name="multiple edits (bottom-up safe)">
edit {"path":"src/app.py","edits":[{"src":{"kind":"single","ref":"{{hashline 10 'return True'}}"},"dst":"  return False"},{"src":{"kind":"single","ref":"{{hashline 3 'def hello'}}"},"dst":"  x = 42"}]}
</example>