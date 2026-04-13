Stateful Vim editor. Every call requires `file` — the buffer loads automatically on first use.
- `{"file": "path"}` — view file
- `{"file": "path", "kbd": ["…"], "insert": "…"}` — edit file

## kbd vs insert — get this right

`kbd` = Vim commands only (`dd`, `G`, `o`, `cc`, `gg`, etc.).
`insert` = text content to type into the buffer.

**Never put text content in kbd.** Only Vim keystrokes go there.
- BAD: `{"kbd": ["1Gohello world<Esc>"]}` — text mixed into kbd
- BAD: `{"kbd": ["1Go", "hello world"]}` — text as a separate kbd entry (gets executed as keystrokes!)
- BAD: `{"kbd": ["1Ao"], "insert": "text"}` — `A` enters INSERT so `o` is typed as text, not a command
- GOOD: `{"kbd": ["1Go"], "insert": "hello world"}` — command in kbd, text in insert

For `insert` to work, the last `kbd` entry must leave INSERT mode active (`o`, `O`, `i`, `a`, `A`, `cc`, `C`, `s`, `S`). The tool auto-exits INSERT and auto-saves after each call.

Each non-final `kbd` entry must end in NORMAL mode (add `<Esc>`).

Whitespace in `kbd` is literal. Do not use spaces as separators between keys; `ggdGi` is one sequence, not `ggdG i`.

## Editing patterns

**Insert after line N** — use `NGo` (Go to line N, open below). Include full indentation in insert:
```json
{"file": "f.py", "kbd": ["3Go"], "insert": "    new line here"}
```

**Insert before line N** — use `NGO` (Go to line N, open above). Include full indentation:
```json
{"file": "f.py", "kbd": ["3GO"], "insert": "    new line here"}
```

**Replace line N** — `cc` clears the line and enters INSERT:
```json
{"file": "f.py", "kbd": ["5Gcc"], "insert": "    replacement content"}
```

**Replace entire file** — `ggdGi` = go to top, delete all, enter INSERT. Use that exact sequence when rewriting the whole file:
```json
{"file": "f.py", "kbd": ["ggdGi"], "insert": "entire new file content"}
```

**Find and replace**:
```json
{"file": "f.py", "kbd": [":%s/old/new/g<CR>"]}
```

**Delete line range**:
```json
{"file": "f.py", "kbd": [":3,5d<CR>"]}
```
## Undo mistakes
- `{"file": "f.py", "kbd": ["u"]}` — undo last change
- `{"file": "f.py", "kbd": ["3u"]}` — undo last 3 changes

`:e!` reloads from disk. **WARNING**: Since auto-save commits after each call, `:e!` reloads your *last saved state* (including any mistakes), not the original file. Use `u` to undo instead. If stuck, use `ggdGi` with the full desired file content.

## Session persistence

The vim buffer persists across tool calls. Your cursor position, undo history, and file state are maintained until you close the tool. Auto-save commits changes to disk after every call.
## Supported

Keys: `<Esc>` `<CR>` `<BS>` `<Tab>` `<C-d>` `<C-u>` `<C-r>` `<C-w>` `<C-o>`
Motions: `h j k l <Space> w b e 0 $ gg G { } f t` with counts
Operators: `d c y p` with motions and text objects (`iw aw i" a" i( a(`)
Insert: `i a o O I A cc C s S` — these all enter INSERT mode; do NOT add another `i` after them
Visual: `v V`
Other: `.` repeat, `u`/`<C-r>` undo/redo, `/pattern<CR>` search, `n N`
Ex: `:w` `:q` `:wq` `:e` `:e!` `:N` `:s///` `:%s///` `:N,Md` `:%d`
