The messages above are a conversation to summarize. Create a structured context checkpoint handoff summary that another LLM will use to resume the task.

IMPORTANT: If the conversation ends with:
- An unanswered question to the user, preserve that exact question
- An imperative statement or request waiting for user response (e.g., "Please run the command and paste the output"), preserve that exact request

These must appear in the Critical Context section.

Use this format (sections can be omitted if not applicable):

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints or requirements mentioned]

## Progress

### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Important data, pending questions, references]

## Additional Notes
[Anything else important that doesn't fit above categories]

Output only the structured summary. No extra text.

Keep each section concise. Preserve exact file paths, function names, error messages, and relevant tool outputs or command results. Include repository state changes (branch, uncommitted changes) if mentioned.