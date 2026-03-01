Ends an active checkpoint and rewinds context back to that checkpoint, replacing intermediate exploration with your report.

Use this immediately after investigative work started with `checkpoint`.

Requirements:
- `report` is **REQUIRED** and must be concise, factual, and actionable.
- Include key findings, decisions, and any unresolved risks.
- Do not include raw scratch logs unless essential.
- You **MUST** call this before yielding if a checkpoint is active.

Behavior:
- If no checkpoint is active, this tool errors.
- On success, the session rewinds and keeps your report as retained context.