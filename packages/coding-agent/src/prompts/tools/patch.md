<context>
Performs patch operations on the file system. This is your primary tool for making changes to the codebase.
</context>

<critical>
**Read before editing.** Always fetch the target file first and copy context lines verbatim. Patch failures almost always stem from guessed or paraphrased context that doesn't match actual file content.
</critical>

<parameters>
| Parameter | Description |
|-----------|-------------|
| `path` | Path to the file (relative or absolute) |
| `operation` | `create` (new file), `delete` (remove file), or `update` (patch in place) |
| `moveTo` | New path for rename (update only, optional) |
| `diff` | For create: full file content. For update: diff hunks with context and changes |
</parameters>

<diff_format>
For `create`, the `diff` field contains the full file content (no prefixes needed).

For `update`, the `diff` field contains one or more "hunks", each introduced by @@ (optionally followed by a hunk header).
Within a hunk each line starts with:
- ` ` (space) for context lines
- `-` for removed lines
- `+` for added lines

Prefer replacing whole logical blocks (function/class/section) when possible instead of single-line edits.
Line numbers are hints only; do not rely on them. Use semantic anchors via `@@` and surrounding context lines.

For instructions on [context_before] and [context_after]:
- By default, show 3 lines of code immediately above and 3 lines immediately below each change. If a change is within 3 lines of a previous change, do NOT duplicate the first change's [context_after] lines in the second change's [context_before] lines.
- If 3 lines of context is insufficient to uniquely identify the snippet of code within the file, use the @@ operator to indicate the class or function to which the snippet belongs. For instance, we might have:
@@ class BaseClass
[3 lines of pre-context]
- [old_code]
+ [new_code]
[3 lines of post-context]

- If a code block is repeated so many times in a class or function such that even a single `@@` statement and 3 lines of context cannot uniquely identify the snippet of code, you can use multiple `@@` statements to jump to the right context. For instance:

@@ class BaseClass
@@   def method():
[3 lines of pre-context]
- [old_code]
+ [new_code]
[3 lines of post-context]
</diff_format>

<examples>
Create a new file:
```
edit {"path": "hello.txt", "operation": "create", "diff": "Hello world"}
```

Update a file:
```
edit {"path": "src/app.py", "operation": "update", "diff": "@@ def greet():\n-print(\"Hi\")\n+print(\"Hello, world!\")"}
```

Rename and update:
```
edit {"path": "src/app.py", "operation": "update", "moveTo": "src/main.py", "diff": "@@ def greet():\n-print(\"Hi\")\n+print(\"Hello, world!\")"}
```

Delete a file:
```
edit {"path": "obsolete.txt", "operation": "delete"}
```
</examples>

<rules>
1. Read the file before editing—copy context lines exactly as they appear
2. For create: provide full file content in `diff`
3. For update: provide hunks with context lines and +/- changes
4. For delete: omit the `diff` field
5. Use relative paths only
6. If a context or change appears more than once, add more surrounding context or additional `@@` anchors to make it unique
</rules>