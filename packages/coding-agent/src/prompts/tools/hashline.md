# Edit

Line-addressed edits using hash-verified line references. Read file with hashes first, then edit by referencing `lineNumber:hash` pairs.

<instruction>
**Workflow:**
1. Read target file (hashes are included automatically in output)
2. Identify lines to change by their `LINE:HASH` prefix
3. Submit edit with `src` (line refs to replace) and `dst` (new content)
**Operations:**
- **Replace**: `src: ["5:abcd", "6:ef01"], dst: ["new line 1", "new line 2"]` — replaces lines 5-6
- **Delete**: `src: ["5:abcd", "6:ef01"], dst: []` — deletes lines 5-6
- **Insert**: `src: [], dst: ["inserted line"], after: "3:e7c4"` — inserts after line 3
**Rules:**
- `src` line refs must be consecutive (e.g., 5,6,7 — not 5,7,8)
- Multiple edits in one call are applied bottom-up (safe for non-overlapping edits)
- Hashes verify file hasn't changed since your last read — stale hashes produce clear errors
- Hashes are derived from both line content and line number (copy them verbatim from read output)
</instruction>

<output>
Returns success/failure; on failure, error message indicates:
- "Line N has changed since last read" — file was modified, re-read it
- "Line N does not exist" — line number out of range
- Validation errors for malformed line refs
</output>

<critical>
- Always read target file before editing — line hashes come from the read output
- If edit fails with hash mismatch, re-read the file to get fresh hashes
- Never fabricate hashes — always copy from read output
- Each `src` entry is a line reference like `"5:abcd"`, each `dst` entry is plain content (no prefix)
</critical>

<example name="replace">
edit {"path":"src/app.py","edits":[{"src":["2:9b01"],"dst":["  print('Hello')"]}]}
</example>

<example name="delete">
edit {"path":"src/app.py","edits":[{"src":["5:abcd","6:ef01"],"dst":[]}]}
</example>

<example name="insert">
edit {"path":"src/app.py","edits":[{"src":[],"dst":["  # new comment"],"after":"3:e7c4"}]}
</example>

<example name="multiple edits">
edit {"path":"src/app.py","edits":[{"src":["10:f1a2"],"dst":["  return True"]},{"src":["3:c4d5"],"dst":["  x = 42"]}]}
</example>

<avoid>
- Fabricating or guessing hash values
- Using stale hashes after file has been modified
- Non-consecutive src line refs in a single edit
- Overlapping edits in the same call
</avoid>