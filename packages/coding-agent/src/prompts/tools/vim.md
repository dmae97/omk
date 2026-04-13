Stateful Vim-style editor with multi-buffer support.

Every call requires `file` — the path to edit. The buffer is loaded automatically on first use.

- `{"file": "path/to/file.py"}` — view file (loads buffer if needed)
- `{"file": "path/to/file.py", "kbd": ["…"], "insert": "…"}` — edit file

How `kbd` + `insert` work together:
- `kbd` runs Vim key sequences (motions, commands, operators)
- `insert` is **raw text** (with real `\n` newlines in JSON) that gets typed into the buffer
- For `insert` to work, the last `kbd` entry **MUST** leave the buffer in INSERT mode (via `i`, `o`, `O`, `a`, `A`, `cc`, `C`, `s`, `S`, etc.)
- After the call, the tool auto-exits INSERT mode and auto-saves to disk
- Set `pause: true` to skip auto-save and stay in the current mode

Rules:
- Each non-final `kbd` entry must end in NORMAL mode — use `<Esc>` or merge into one string
- To recover from mistakes: `{"file": "f.py", "kbd": ["u"]}` to undo, or `{"file": "f.py", "kbd": [":e!<CR>"]}` to reload from disk

Supported: motions (`h/j/k/l`, `w/b/e`, `0/$`, `gg/G`, `{/}`, `f/t`), counts, `.` repeat, insert (`i/a/o/O/I/A/cc/C/s/S`), visual (`v/V`), operators (`d/c/y/p`), text objects (`iw/aw/i"/a"/i(/a(`), undo/redo (`u`/`<C-r>`), search (`/pattern<CR>`, `n/N`), ex (`:s`, `:%s`, `:e`, `:e!`, ranged `:d`).

Special keys: `<Esc>`, `<Escape>`, `<CR>`, `<Enter>`, `<BS>`, `<Tab>`, `<C-d>`, `<C-u>`, `<C-r>`, `<C-w>`, `<C-o>`.

Examples:
- `{"file": "src/app.ts"}` — view file
- `{"file": "src/app.ts", "kbd": ["3G", "ciwnewName<Esc>"]}` — rename word on line 3
- `{"file": "src/app.ts", "kbd": ["5G", "cc"], "insert": "    if b == 0:\n        return None"}` — replace line 5
- `{"file": "src/app.ts", "kbd": ["3G", "o"], "insert": "def multiply(a, b):\n    return a * b"}` — insert after line 3
- `{"file": "src/app.ts", "kbd": [":%s/oldName/newName/g<CR>"]}` — find and replace
- `{"file": "src/app.ts", "kbd": ["/TODO<CR>", "dd"]}` — search and delete
- `{"file": "src/app.ts", "kbd": [":3,5d<CR>"]}` — delete line range
