The messages above are a conversation to summarize. Create a structured context checkpoint handoff summary that another LLM will use to resume the task.

Use this EXACT format:

## Goal

[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress

### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Output only the structured summary. No extra text.

Keep each section concise. Preserve exact file paths, function names, error messages, and relevant tool outputs or command results. Include repository state changes (branch, uncommitted changes) if mentioned.