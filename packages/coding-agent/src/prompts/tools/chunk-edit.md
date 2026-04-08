Edits files via syntax-aware chunks. Run `read(path="file.ts")` first. The edit target is a chunk selector, optionally qualified with a region.

<rules>
- **MUST** `read` first. Never invent chunk paths or CRCs. Copy them from the latest `read` output or edit response.
- `target` format:
  - insertions: `chunk` or `chunk@region`
  - replacements: `chunk#CRC` or `chunk#CRC@region`
- `@region` defaults to `@container`. Valid regions: `container`, `prologue`, `body`, `epilogue`.
- If the exact chunk path is unclear, or your anchor style omits full paths, run `read(path="file", sel="?")` and copy a selector from that listing. The listing also shows which regions each chunk supports.
- Use `\t` for indentation in `content`. Do **NOT** include the chunk's base indentation. Only indent relative to the chunk's opening level.
- `replace` requires the current CRC. Insertions do not.
- Successful edits return refreshed chunk anchors. Use the latest selectors/CRCs for follow-up edits.
</rules>

<regions>
- `@container` — the full owned extent of the chunk. Default when `@region` is omitted.
- `@prologue` — attached trivia, header/signature, and opening delimiter.
- `@body` — the editable interior only.
- `@epilogue` — the closing delimiter or trailing owned trailer.

Leaf chunks only support `@container`.
</regions>

<ops>
|op|target form|effect|
|---|---|---|
|`replace`|`chunk#CRC` or `chunk#CRC@region`|rewrite the addressed region (default: `@container`)|
|`before`|`chunk` or `chunk@region`|insert before the region span (default: `@container`)|
|`after`|`chunk` or `chunk@region`|insert after the region span (default: `@container`)|
|`prepend`|`chunk` or `chunk@region`|insert at the start inside the region (default: `@container`)|
|`append`|`chunk` or `chunk@region`|insert at the end inside the region (default: `@container`)|
</ops>

<examples>
- Replace only a function body without touching the closing brace:
  - `target: "fn_main#ABCD@body"`
  - `op: "replace"`
  - `content: "\treturn compute();\n"`
- Insert a new top-level function after another top-level function:
  - `target: "fn_prev"`
  - `op: "after"`
  - `content: "function next(): void {\n\twork();\n}\n"`
- Add a struct field:
  - `target: "type_Server@body"`
  - `op: "append"`
  - `content: "\tport int\n"`
- Add a Go receiver method owned by the type, not a struct field:
  - `target: "type_Server@container"`
  - `op: "append"`
  - `content: "func (s *Server) Stop() error {\n\treturn nil\n}\n"`
- Edit a doc comment or header block:
  - `target: "fn_foo#WXYZ@prologue"`
  - `op: "replace"`
  - `content: "/**\n * Updated docs.\n */\nfunction foo() {"`
- Canonical indentation example:
  - if a method body in a 4-space file should contain `return x;`, write `content: "\treturn x;\n"` for `@body.replace`
  - do not write four leading spaces
  - do not include the method's existing base indentation
</examples>
