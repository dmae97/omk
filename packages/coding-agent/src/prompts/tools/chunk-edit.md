Edits files by addressing syntax-aware chunks from `read` output.

Read the file first with `read(path="file.ts")`. Use chunk paths exactly as shown by the latest `read` result. For `replace` and `delete`, supply the chunk checksum separately as `crc`.

Successful edit responses include the updated chunk tree with checksums. Do not re-read just to refresh checksums unless the file changed externally.

**Checksum scope:** Each chunk has its own CRC over its source span. Editing non-overlapping lines elsewhere does not change unrelated chunks' checksums.

<operations>
**Choosing the right operation:**
- To fix a single line → `replace` with just `line`=that line number
- To fix a contiguous range → `replace` with `line`=first line, `end_line`=last line
- To rewrite an entire function/method → `replace` without `line`/`end_line`
- To insert new code → `replace` with `line`=insertion line, `end_line`=`line`-1 (zero-width: inserts without removing)

|operation|format|effect|
|---|---|---|
|`replace`|`{ "replace": { "sel": "…", "crc": "…", "content": "…" } }`|without `line`/`end_line`: rewrite entire chunk. With `line`: replace that line. With `line`+`end_line`: replace that range|
|`delete`|`{ "delete": { "sel": "…", "crc": "…" } }`|remove entire chunk|
|`append_child`|`{ "append_child": { "sel": "…", "content": "…" } }`|insert as last child|
|`prepend_child`|`{ "prepend_child": { "sel": "…", "content": "…" } }`|insert as first child|
|`append_sibling`|`{ "append_sibling": { "sel": "…", "content": "…" } }`|insert after chunk|
|`prepend_sibling`|`{ "prepend_sibling": { "sel": "…", "content": "…" } }`|insert before chunk|
- `line`/`end_line` are **absolute file line numbers** from `read` gutter. `line` alone = single line. `line` + `end_line` = inclusive range. `line` with `end_line` = `line`-1 = zero-width insert.
- `path="file.ts:chunk_path"` sets default `sel`; top-level `crc` sets default checksum
- **Auto-indent:** Tool adds base indent to non-empty lines. Put deeper indentation in `content` yourself.
- Chunk paths are fully qualified: `class_Server.fn_start`, not bare `fn_start`
- Batch ops observe earlier edits. If op 1 changes checksum/span/path, op 2 must use post-op-1 values.
- `replace`/`delete` include leading comments/attributes attached to the chunk.
</operations>

<examples>
All examples reference this `read` output:
```
   │ server.ts  ·  40L  ·  ts  ·  #VSKB
   │

 5 │ class Server {
   │ <:class_Server#XKQZ>

12 │   start(): void {
   │   <.fn_start#HTST>
13 │     log("booting on " + this.port);
14 │     for (let i = 0; i < MAX_RETRIES; i++) {
15 │       this.tryBind();
16 │     }
17 │   }

19 │   private tryBind(): boolean {
   │   <.fn_tryBind#VNWR>
20 │     // TODO: add backoff
21 │     return bind(this.port);
22 │   }
```

<example name="replace a method">
```
"path": "server.ts",
"operations": [
  {
    "replace": {
      "sel": "class_Server.fn_start",
      "crc": "HTST",
      "content": "start(): void {\n  log(\"starting\");\n  this.tryBind();\n}"
    }
  }
]
```
</example>

<example name="replace a single line">
```
"path": "server.ts",
"operations": [
  {
    "replace": {
      "sel": "class_Server.fn_start",
      "crc": "HTST",
      "line": 13,
      "content": " warn(\"booting on \" + this.port);"
    }
  }
]
```
</example>

<example name="delete a chunk">
```
"path": "server.ts",
"operations": [
  {
    "delete": {
      "sel": "class_Server.fn_tryBind",
      "crc": "VNWR"
    }
  }
]
```
</example>
</examples>

<critical>
- **MUST** include `path` in every edit call.
- **MUST** read latest chunk output before editing.
- **MUST** provide `crc` for `replace` and `delete`.
- **MUST** use updated chunk output from edit response for follow-up edits.
- **MUST** use smallest correct chunk; do not rewrite siblings unnecessarily.
- **MUST NOT** invent chunk paths. Copy from `read` output including `fn_*` prefixes. Nesting uses `.`.
- For line-scoped `replace`, use file line numbers from `read` gutter.
- Do NOT batch multiple line-scoped `replace` operations on the same chunk. Combine into a wider `line`/`end_line` range or use separate calls.
</critical>
</output>
