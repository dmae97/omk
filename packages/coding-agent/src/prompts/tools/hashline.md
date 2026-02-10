# Edit

Line-addressed edits using hash-verified line references. Read file with hashes first, then edit by referencing `lineNumber:hash` pairs.

<instruction>
**Workflow:**
1. Read target file (hashes are included automatically in output)
2. Identify lines to change by their `LINE:HASH` prefix
3. Submit edit with `old` (line refs to replace) and `new` (new content)
**Operations:**
- **Replace**: `old: ["5:ab", "6:ef"], new: ["new line 1", "new line 2"]` — replaces lines 5-6
- **Delete**: `old: ["5:ab", "6:ef"], new: []` — deletes lines 5-6
- **Insert**: `old: [], new: ["inserted line"], after: "3:e7"` — inserts after line 3
**Rules:**
- `old` line refs must be consecutive (e.g., 5,6,7 — not 5,7,8)
- Multiple edits in one call are applied bottom-up (safe for non-overlapping edits)
- Hashes verify file hasn't changed since your last read — stale hashes produce clear errors
- Hashes are derived from both line content and line number (copy them verbatim from read output)
</instruction>

<input>
- `path`: Path to the file to edit
- `edits`: Array of edit operations
  - `old`: Array of line references to replace (e.g., `["5:ab", "6:ef"]`)
  - `new`: Array of new content lines (e.g., `["new line 1", "new line 2"]`)
  - `after`: Line reference to insert after (e.g., `"3:e7"`)
</input>

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
- Each `old` entry is a line reference like `"5:abcd"`, each `new` entry is plain content (no prefix)
</critical>

<example name="replace">
edit {"path":"src/app.py","edits":[{"old":["2:9b"],"new":["  print('Hello')"]}]}
</example>

<example name="delete">
edit {"path":"src/app.py","edits":[{"old":["5:ab","6:ef"],"new":[]}]}
</example>

<example name="insert">
edit {"path":"src/app.py","edits":[{"old":[],"new":["  # new comment"],"after":"3:e7"}]}
</example>

<example name="multiple edits">
edit {"path":"src/app.py","edits":[{"old":["10:f1"],"new":["  return True"]},{"old":["3:c4"],"new":["  x = 42"]}]}
</example>

<avoid>
- Fabricating or guessing hash values
- Using stale hashes after file has been modified
- Non-consecutive old line refs in a single edit
- Overlapping edits in the same call
</avoid>
