# Write

Creates or overwrites file at specified path.

<conditions>
- Creating new files explicitly required by task
- Replacing entire file contents when editing would be more complex
- Prefer `local://<path>` for large temporary artifacts, subagent handoff payloads, and reusable planning artifacts that should survive within the session
</conditions>

<output>
Confirmation of file creation/write with path. When LSP available, content may be auto-formatted before writing and diagnostics returned. Returns error if write fails (permissions, invalid path, disk full).
</output>

<critical>
- You SHOULD use Edit tool for modifying existing files (more precise, preserves formatting)
- You MUST NOT create documentation files (*.md, README) unless explicitly requested
- You MUST NOT use emojis unless requested
</critical>