Stateful single-buffer Vim-style editor.

Use this for surgical text edits when motions and compact viewport feedback are more efficient than rewriting full regions.

Actions:
- `open`: load a file into the buffer (auto-saves any previous buffer)
- `kbd`: run Vim key sequences, then optionally insert literal text

Rules:
- One active buffer at a time; `open` replaces it
- Each `kbd` call auto-saves to disk (unless `pause: true`)
- `kbd` array entries run in order; every non-final entry must leave NORMAL mode — if an entry enters INSERT mode, end it with `<Esc>` or merge into one string
- `insert` is **raw text** (newlines = real `\n` in JSON), NOT Vim key syntax; the buffer must already be in INSERT mode (via `i`, `o`, `O`, `a`, `A`, `cc`, etc.)
- After `insert`, the tool exits INSERT mode and saves automatically (unless `pause: true`)
- `pause: true` keeps the current mode active and skips auto-save; use it for multi-step edits
- Use `:e!` to reload from disk and discard unsaved changes

Supported Vim subset: motions (`h/j/k/l`, `w/b/e`, `0/$`, `gg/G`, `{/}`, `f/t`), counts, `.` repeat, insert commands (`i/a/o/O/I/A/cc/C/s/S`), visual mode (`v/V`), operators (`d/c/y/p`), text objects (`iw/aw/i"/a"/i(/a(`), undo/redo (`u`/`<C-r>`), search (`/pattern<CR>`, `n/N`), ex commands (`:s`, `:%s`, `:e`, `:e!`, ranged `:d`).

Special keys: `<Esc>` or `<Escape>`, `<CR>` or `<Enter>`, `<BS>`, `<Tab>`, `<C-d>`, `<C-u>`, `<C-r>`, `<C-w>`, `<C-o>`.

Examples:
- Open file: `{"open":"src/app.ts"}`
- Open at line: `{"open":"src/app.ts", "line":42}`
- Rename word: `{"kbd":["42G", "ciwnewName<Esc>"]}`
- Replace line with multi-line text: `{"kbd":["5G", "cc"], "insert":"    if b == 0:\n        return None"}`
- Add lines below: `{"kbd":["3G", "o"], "insert":"def multiply(a, b):\n    return a * b"}`
- Global substitution: `{"kbd":[":%s/oldName/newName/g<CR>"]}`
- Search and delete: `{"kbd":["/TODO<CR>", "dd"]}`
- Delete range of lines: `{"kbd":[":3,5d<CR>"]}`
