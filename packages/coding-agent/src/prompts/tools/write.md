# Write

Creates or overwrites a file at the specified path.

<conditions>
- Creating new files explicitly required by the task
- Replacing entire file contents when editing would be more complex
</conditions>

<output>
Confirmation of file creation/write with path. When LSP is available, content may be auto-formatted before writing and diagnostics are returned. Returns error if write fails (permissions, invalid path, disk full).
</output>

<critical>
- Prefer Edit tool for modifying existing files (more precise, preserves formatting)
- Create documentation files (*.md, README) only when explicitly requested
</critical>

<important>
- Include emojis only when explicitly requested
</important>