<critical>
Write a comprehensive handoff document for another instance of yourself.
The handoff **MUST** be sufficient for seamless continuation without access to this conversation.
Output ONLY the handoff document. No preamble, no commentary, no wrapper text.
</critical>

<instruction>
Capture exact technical state, not abstractions.
Include concrete file paths, symbol names, commands run, test results, observed failures, decisions made, and any partial work that materially affects the next step.
</instruction>

<output>
Use exactly this structure:

## Goal
[What the user is trying to accomplish]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned]

## Progress
### Done
- [x] [Completed tasks with specifics]

### In Progress
- [ ] [Current work if any]

### Pending
- [ ] [Tasks mentioned but not started]

## Key Decisions
- **[Decision]**: [Rationale]

## Critical Context
- [Code snippets, file paths, function/type names, error messages, or data essential to continue]
- [Repository state if relevant]

## Next Steps
1. [What should happen next]
</output>

{{#if additionalFocus}}
<instruction>
Additional focus: {{additionalFocus}}
</instruction>
{{/if}}
