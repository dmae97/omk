Incorporate new messages above into existing handoff summary in <previous-summary> tags, used by another LLM to resume task.
RULES:
- PRESERVE all information from previous summary
- ADD new progress, decisions, and context from new messages
- UPDATE Progress: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE exact file paths, function names, and error messages
- You may remove anything no longer relevant

IMPORTANT: If new messages end with unanswered question or request to user, add it to Critical Context (replacing any previous pending question if answered).

Use this format (omit sections if not applicable):

## Goal
[Preserve existing goals; add new ones if task expanded]

## Constraints & Preferences
- [Preserve existing; add new ones discovered]

## Progress

### Done
- [x] [Include previously done and newly completed items]

### In Progress
- [ ] [Current work—update based on progress]

### Blocked
- [Current blockers—remove if resolved]

## Key Decisions
- **[Decision]**: [Brief rationale] (preserve all previous, add new)

## Next Steps
1. [Update based on current state]

## Critical Context
- [Preserve important context; add new if needed]

## Additional Notes
[Other important info not fitting above]

Output only structured summary; no extra text.

Keep sections concise. Preserve relevant tool outputs/command results. Include repository state changes (branch, uncommitted changes) if mentioned.