# Write

Creates or overwrites file at specified path.

<conditions>
- Creating new files explicitly required by task
- Replacing entire file contents when editing would be more complex
</conditions>

<output>
Confirmation of file creation/write with path. When LSP available, content may be auto-formatted before writing and diagnostics returned. Returns error if write fails (permissions, invalid path, disk full).
</output>

<critical>
- Prefer Edit tool for modifying existing files (more precise, preserves formatting)
- Create documentation files (*.md, README) only when explicitly requested
- No emojis unless requested
</critical>