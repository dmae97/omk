# Compaction & Branch Summarization

LLMs have limited context windows. OMP uses compaction to summarize older context while keeping recent work intact, and branch summarization to capture work when moving between branches in the session tree.

**Source files:**

- [`src/session/compaction/compaction.ts`](../src/session/compaction/compaction.ts) - Auto-compaction logic
- [`src/session/compaction/branch-summarization.ts`](../src/session/compaction/branch-summarization.ts) - Branch summarization
- [`src/session/compaction/utils.ts`](../src/session/compaction/utils.ts) - Shared utilities (file tracking, serialization)
- [`src/session/compaction/pruning.ts`](../src/session/compaction/pruning.ts) - Tool output pruning
- [`src/session/session-manager.ts`](../src/session/session-manager.ts) - Entry types (`CompactionEntry`, `BranchSummaryEntry`)
- [`src/extensibility/hooks/types.ts`](../src/extensibility/hooks/types.ts) - Hook event types
- [`src/prompts/compaction/*`](../src/prompts/compaction) - Summarization prompts
- [`src/prompts/system/*`](../src/prompts/system) - Summarization system prompt + file op tags

## Overview

OMP has two summarization mechanisms:

| Mechanism            | Trigger                                                | Purpose                                   |
| -------------------- | ------------------------------------------------------ | ----------------------------------------- |
| Compaction           | Context overflow/threshold, or `/compact`              | Summarize old messages to free up context |
| Branch summarization | `/tree` navigation (when branch summaries are enabled) | Preserve context when switching branches  |

Compaction and branch summaries are stored as session entries and injected into LLM context as user messages via `compaction-summary-context.md` and `branch-summary-context.md`.

## Compaction

### When It Triggers

Auto-compaction runs after a turn completes:

- **Overflow recovery**: If the current model returns a context overflow error, OMP compacts and retries automatically.
- **Threshold**: If `contextTokens > contextWindow - reserveTokens`, OMP compacts without retry.
  - Tool output pruning runs first and can reduce `contextTokens`.

Manual compaction is available via `/compact [instructions]`.

Auto-compaction is controlled by `compaction.enabled`. After threshold compaction, OMP sends a synthetic "Continue if you have next steps." prompt unless `compaction.autoContinue` is set to `false`.

### How It Works

1. **Prepare**: `prepareCompaction()` finds the latest compaction boundary and chooses a cut point that keeps approximately `keepRecentTokens` (adjusted using usage data).
2. **Extract**: Collect messages to summarize, plus a turn prefix if the cut point splits a turn.
3. **Track files**: Gather file ops from `read`/`write`/`edit` tool calls and previous compaction details.
4. **Summarize**:
   - Main summary uses `compaction-summary.md` or `compaction-update-summary.md` if there is a previous summary.
   - Split turns add a turn-prefix summary from `compaction-turn-prefix.md` and merge with:

     ```
     <history summary>

     ---

     **Turn Context (split turn):**

     <turn prefix summary>
     ```

   - Optional custom instructions are appended to the prompt.
   - If `compaction.remoteEndpoint` is set, OMP POSTs `{ systemPrompt, prompt }` to the endpoint and expects `{ summary, shortSummary? }`.
5. **Finalize**: Generate a short PR-style summary from recent messages, append file-operation tags, persist `CompactionEntry`, and reload session context.

Compaction rewrites the session like this:

```
Before compaction:

  entry:  0     1     2     3      4     5     6      7      8     9
        ┌─────┬─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool│
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴─────┘
                └────────┬───────┘ └──────────────┬──────────────┘
               messagesToSummarize            kept messages
                                   ↑
                          firstKeptEntryId (entry 4)

After compaction (new entry appended):

  entry:  0     1     2     3      4     5     6      7      8     9     10
        ┌─────┬─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool│ cmp │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴─────┴─────┘
               └──────────┬──────┘ └──────────────────────┬───────────────────┘
                 not sent to LLM                    sent to LLM
                                                         ↑
                                              starts from firstKeptEntryId

What the LLM sees:

  ┌────────┬─────────┬─────┬─────┬──────┬──────┬─────┬──────┐
  │ system │ summary │ usr │ ass │ tool │ tool │ ass │ tool │
  └────────┴─────────┴─────┴─────┴──────┴──────┴─────┴──────┘
       ↑         ↑      └─────────────────┬────────────────┘
    prompt   from cmp          messages from firstKeptEntryId
```

Compaction summaries are injected into the LLM context using `compaction-summary-context.md`.

### Split Turns

A "turn" starts with a user message and includes all assistant responses and tool calls until the next user message. `bashExecution` messages and `custom_message`/`branch_summary` entries are treated like user messages for turn boundaries.

If a single turn exceeds `keepRecentTokens`, compaction cuts mid-turn at a non-user message (usually an assistant message). OMP produces two summaries (history + turn prefix) and merges them as shown above.

### Cut Point Rules

Valid cut points are:

- User, assistant, bashExecution, hookMessage, branchSummary, or compactionSummary messages
- `custom_message` and `branch_summary` entries (treated as user-role messages)

Never cut at tool results; they must stay with their tool call. Non-message entries (model changes, labels, etc.) are pulled into the kept region before the cut point until a message or compaction boundary is reached.

### CompactionEntry Structure

Defined in [`src/session/session-manager.ts`](../src/session/session-manager.ts):

```typescript
interface CompactionEntry<T = unknown> {
	type: "compaction";
	id: string;
	parentId: string | null;
	timestamp: string;
	summary: string;
	shortSummary?: string;
	firstKeptEntryId: string;
	tokensBefore: number;
	details?: T;
	preserveData?: Record<string, unknown>;
	fromExtension?: boolean;
}

// Default compaction details:
interface CompactionDetails {
	readFiles: string[];
	modifiedFiles: string[];
}
```

`shortSummary` is used in the UI tree. `preserveData` stores hook-provided state across compactions. Entries created by hooks set `fromExtension` and are excluded from default file tracking.

## Branch Summarization

### When It Triggers

When you use `/tree` to navigate to a different branch, the UI prompts to summarize the branch you're leaving if `branchSummary.enabled` is true. You can optionally supply custom instructions.

Hooks fire regardless of user choice; a summary is only generated when `preparation.userWantsSummary` is true.

### How It Works

1. **Find common ancestor**: Deepest node shared by old and new positions.
2. **Collect entries**: Walk from old leaf back to the common ancestor (including compactions and prior branch summaries).
3. **Budget**: Keep newest messages first under the token budget (`contextWindow - branchSummary.reserveTokens`).
4. **Summarize**: Generate summary with `branch-summary.md`, prepend `branch-summary-preamble.md`, append file-op tags, and store `BranchSummaryEntry`.

```
Tree before navigation:

         ┌─ B ─ C ─ D (old leaf, being abandoned)
    A ───┤
         └─ E ─ F (target)

Common ancestor: A
Entries to summarize: B, C, D

After navigation with summary:

         ┌─ B ─ C ─ D ─ [summary of B,C,D]
    A ───┤
         └─ E ─ F (new leaf)
```

Branch summaries are injected into context using `branch-summary-context.md`.

### BranchSummaryEntry Structure

Defined in [`src/session/session-manager.ts`](../src/session/session-manager.ts):

```typescript
interface BranchSummaryEntry<T = unknown> {
	type: "branch_summary";
	id: string;
	parentId: string | null;
	timestamp: string;
	fromId: string;
	summary: string;
	details?: T;
	fromExtension?: boolean;
}

// Default branch summary details:
interface BranchSummaryDetails {
	readFiles: string[];
	modifiedFiles: string[];
}
```

## Cumulative File Tracking

Both compaction and branch summarization track files cumulatively.

- File ops are extracted from `read`, `write`, and `edit` tool calls in assistant messages.
- Writes and edits are treated as modified files; read-only files exclude those modified.
- Compaction includes file ops from previous compaction details (only when `fromExtension` is false).
- Branch summaries include file ops from previous branch summary details even if those entries aren't within the token budget.

File lists are appended to the summary with XML tags:

```
<read-files>
path/to/file.ts
</read-files>

<modified-files>
path/to/changed.ts
</modified-files>
```

## Summary Format

### Compaction Summary Format

Prompt: [`compaction-summary.md`](../src/prompts/compaction/compaction-summary.md)

```markdown
## Goal
[User goals]

## Constraints & Preferences
- [Constraints]

## Progress

### Done
- [x] [Completed tasks]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues, if any]

## Key Decisions
- **[Decision]**: [Rationale]

## Next Steps
1. [What should happen next]

## Critical Context
- [Data needed to continue]

## Additional Notes
[Anything else important not covered above]
```

File-operation tags are appended after the summary.

### Branch Summary Format

Prompt: [`branch-summary.md`](../src/prompts/compaction/branch-summary.md)

```markdown
## Goal

[What user trying to accomplish in this branch?]

## Constraints & Preferences
- [Constraints, preferences, requirements mentioned]
- [(none) if none mentioned]

## Progress

### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Work started but not finished]

### Blocked
- [Issues preventing progress]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [What should happen next to continue]
```

### Short Summary

Compaction also generates a short PR-style summary (`compaction-short-summary.md`) for UI display. It is 2–3 sentences in first person, describing changes made.

## Message Serialization

Before summarization, messages are serialized to text via [`serializeConversation()`](../src/session/compaction/utils.ts). Messages are first converted with `convertToLlm()` so custom types (bash execution, hook messages, compaction summaries) are represented as user messages.

```
[User]: What they said
[Assistant thinking]: Internal reasoning
[Assistant]: Response text
[Assistant tool calls]: read(path="foo.ts"); edit(path="bar.ts", ...)
[Tool result]: Output from tool (or "[Output truncated - N tokens]")
```

This prevents the model from treating the input as a conversation to continue.

## Custom Summarization via Hooks

Hooks can customize both compaction and branch summarization. See [`src/extensibility/hooks/types.ts`](../src/extensibility/hooks/types.ts).

### session_before_compact

Fired before auto-compaction or `/compact`. Can cancel or supply a custom summary.

```typescript
pi.on("session_before_compact", async (event, ctx) => {
	const { preparation, customInstructions, signal } = event;

	// Cancel:
	return { cancel: true };

	// Custom summary:
	return {
		compaction: {
			summary: "Your summary...",
			shortSummary: "Short summary...",
			firstKeptEntryId: preparation.firstKeptEntryId,
			tokensBefore: preparation.tokensBefore,
			details: {
				/* custom data */
			},
		},
	};
});
```

#### Converting Messages to Text

To generate a summary with your own model, convert messages to text using `serializeConversation`:

```typescript
import { convertToLlm, serializeConversation } from "@oh-my-pi/pi-coding-agent";

pi.on("session_before_compact", async (event, ctx) => {
	const { preparation } = event;

	const conversationText = serializeConversation(convertToLlm(preparation.messagesToSummarize));
	const summary = await myModel.summarize(conversationText);

	return {
		compaction: {
			summary,
			firstKeptEntryId: preparation.firstKeptEntryId,
			tokensBefore: preparation.tokensBefore,
		},
	};
});
```

See [examples/hooks/custom-compaction.ts](../examples/hooks/custom-compaction.ts) for a complete example using a different model.

### session.compacting

Fired just before summarization to override the prompt or add extra context.

```typescript
pi.on("session.compacting", async (event, ctx) => {
	return {
		prompt: "Override the default compaction prompt...",
		context: ["Include ticket ABC-123", "Keep recent benchmark results"],
		preserveData: { artifactIndex: ["foo.ts"] },
	};
});
```

`context` lines are injected as `<additional-context>` in the prompt. `preserveData` is stored on the compaction entry.

### session_before_tree

Fired before `/tree` navigation. Always fires, even if the user opts out of summarization.

```typescript
pi.on("session_before_tree", async (event, ctx) => {
	const { preparation, signal } = event;

	// preparation.targetId - where we're navigating to
	// preparation.oldLeafId - current position (being abandoned)
	// preparation.commonAncestorId - shared ancestor
	// preparation.entriesToSummarize - entries that would be summarized
	// preparation.userWantsSummary - whether user chose to summarize

	// Cancel navigation entirely:
	return { cancel: true };

	// Provide custom summary (only used if userWantsSummary is true):
	if (preparation.userWantsSummary) {
		return {
			summary: {
				summary: "Your summary...",
				details: {
					/* custom data */
				},
			},
		};
	}
});
```

## Settings

Global settings are stored in `~/.omp/agent/config.yml`. Project-level overrides are loaded from `settings.json` in config directories (for example `.omp/settings.json` or `.claude/settings.json`).

```yaml
# ~/.omp/agent/config.yml
compaction:
  enabled: true
  reserveTokens: 16384
  keepRecentTokens: 20000
  autoContinue: true
  remoteEndpoint: "https://example.com/compaction"
branchSummary:
  enabled: false
  reserveTokens: 16384
```

| Setting                        | Default | Description                                            |
| ------------------------------ | ------- | ------------------------------------------------------ |
| `compaction.enabled`           | `true`  | Enable auto-compaction                                 |
| `compaction.reserveTokens`     | `16384` | Tokens reserved for prompts + response                 |
| `compaction.keepRecentTokens`  | `20000` | Recent tokens to keep                                  |
| `compaction.autoContinue`      | `true`  | Auto-send a continuation prompt after compaction       |
| `compaction.remoteEndpoint`    | unset   | Remote summarization endpoint                          |
| `branchSummary.enabled`        | `false` | Prompt to summarize when leaving a branch              |
| `branchSummary.reserveTokens`  | `16384` | Tokens reserved for branch summary prompts             |
