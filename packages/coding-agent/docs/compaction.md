# Compaction & Branch Summarization

LLMs have limited context windows. When conversations grow too long, omk uses compaction to summarize older content while preserving recent work. This page covers both auto-compaction and branch summarization.

**Source files** ([omk-mono](https://github.com/earendil-works/omk-mono)):
- [`packages/coding-agent/src/core/compaction/compaction.ts`](https://github.com/earendil-works/omk-mono/blob/main/packages/coding-agent/src/core/compaction/compaction.ts) - Auto-compaction logic
- [`packages/coding-agent/src/core/compaction/branch-summarization.ts`](https://github.com/earendil-works/omk-mono/blob/main/packages/coding-agent/src/core/compaction/branch-summarization.ts) - Branch summarization
- [`packages/coding-agent/src/core/compaction/utils.ts`](https://github.com/earendil-works/omk-mono/blob/main/packages/coding-agent/src/core/compaction/utils.ts) - Shared utilities (file tracking, serialization)
- [`packages/coding-agent/src/core/session-manager.ts`](https://github.com/earendil-works/omk-mono/blob/main/packages/coding-agent/src/core/session-manager.ts) - Entry types (`CompactionEntry`, `BranchSummaryEntry`)
- [`packages/coding-agent/src/core/extensions/types.ts`](https://github.com/earendil-works/omk-mono/blob/main/packages/coding-agent/src/core/extensions/types.ts) - Extension event types

For TypeScript definitions in your project, inspect `node_modules/open-multi-agent-kit/dist/`.

## Overview

OMK has two summarization mechanisms:

| Mechanism | Trigger | Purpose |
|-----------|---------|---------|
| Compaction | Context exceeds threshold, or `/compact` | Summarize old messages to free up context |
| Branch summarization | `/tree` navigation | Preserve context when switching branches |

Both use the same structured summary format and track file operations cumulatively.

## Compaction

### When It Triggers

Auto-compaction triggers at the earlier of:

```text
contextTokens >= contextWindow * maxUsageRatio
contextTokens >= contextWindow - reserveTokens
```

By default, `maxUsageRatio` is `0.9` and `reserveTokens` is `16384` tokens (configurable in `~/.omk/agent/settings.json` or `<project-dir>/.omk/settings.json`). This leaves room for the LLM's response.

You can also trigger manually with `/compact [instructions]`, where optional instructions focus the summary.

### How It Works

1. **Find cut point**: Walk backwards from newest message, accumulating token estimates until `keepRecentTokens` (default 20k, configurable in `~/.omk/agent/settings.json` or `<project-dir>/.omk/settings.json`) is reached
2. **Extract messages**: Collect messages from the previous kept boundary (or session start) up to the cut point
3. **Pack summary input**: If the serialized history is larger than `summaryInputTokens` (default 80k), apply deterministic extractive packing before the summarizer call. OMK keeps the opening context, recent tail, and high-signal middle lines such as file paths, commands, failures, and decisions, then marks omitted low-signal text.
4. **Generate summary**: Call LLM to summarize with structured format, passing the previous summary as iterative context when present
5. **Append entry**: Save `CompactionEntry` with summary and `firstKeptEntryId`
6. **Reload**: Session reloads, using summary + messages from `firstKeptEntryId` onwards

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

On repeated compactions, the summarized span starts at the previous compaction's kept boundary (`firstKeptEntryId`), not at the compaction entry itself, falling back to the entry after the previous compaction if that kept entry cannot be found in the path. This preserves messages that survived the earlier compaction by including them in the next summarization pass as well. OMK also recalculates `tokensBefore` from the rebuilt session context before writing the new `CompactionEntry`, so the token count reflects the actual pre-compaction context being replaced.

### Split Turns

A "turn" starts with a user message and includes all assistant responses and tool calls until the next user message. Normally, compaction cuts at turn boundaries.

When a single turn exceeds `keepRecentTokens`, the cut point lands mid-turn at an assistant message. This is a "split turn":

```
Split turn (one huge turn exceeds budget):

  entry:  0     1     2      3     4      5      6     7      8
        ┌─────┬─────┬─────┬──────┬─────┬──────┬──────┬─────┬──────┐
        │ hdr │ usr │ ass │ tool │ ass │ tool │ tool │ ass │ tool │
        └─────┴─────┴─────┴──────┴─────┴──────┴──────┴─────┴──────┘
                ↑                                     ↑
         turnStartIndex = 1                  firstKeptEntryId = 7
                │                                     │
                └──── turnPrefixMessages (1-6) ───────┘
                                                      └── kept (7-8)

  isSplitTurn = true
  messagesToSummarize = []  (no complete turns before)
  turnPrefixMessages = [usr, ass, tool, ass, tool, tool]
```

For split turns, omk generates two summaries and merges them:
1. **History summary**: Previous context (if any)
2. **Turn prefix summary**: The early part of the split turn

### Cut Point Rules

Valid cut points are:
- User messages
- Assistant messages
- BashExecution messages
- Custom messages (custom_message, branch_summary)

Never cut at tool results (they must stay with their tool call).

### CompactionEntry Structure

Defined in [`session-manager.ts`](https://github.com/earendil-works/omk-mono/blob/main/packages/coding-agent/src/core/session-manager.ts):

```typescript
interface CompactionEntry<T = unknown> {
  type: "compaction";
  id: string;
  parentId: string;
  timestamp: number;
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  fromHook?: boolean;  // true if provided by extension (legacy field name)
  details?: T;         // implementation-specific data
}

// Default compaction uses this for details (from compaction.ts):
interface CompactionDetails {
  readFiles: string[];
  modifiedFiles: string[];
}
```

Extensions can store any JSON-serializable data in `details`. The default compaction tracks file operations, but custom extension implementations can use their own structure.

See [`prepareCompaction()`](https://github.com/earendil-works/omk-mono/blob/main/packages/coding-agent/src/core/compaction/compaction.ts) and [`compact()`](https://github.com/earendil-works/omk-mono/blob/main/packages/coding-agent/src/core/compaction/compaction.ts) for the implementation.

## Branch Summarization

### When It Triggers

When you use `/tree` to navigate to a different branch, omk offers to summarize the work you're leaving. This injects context from the left branch into the new branch.

### How It Works

1. **Find common ancestor**: Deepest node shared by old and new positions
2. **Collect entries**: Walk from old leaf back to common ancestor
3. **Prepare with budget**: Include messages up to token budget (newest first)
4. **Generate summary**: Call LLM with structured format
5. **Append entry**: Save `BranchSummaryEntry` at navigation point

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

### Cumulative File Tracking

Both compaction and branch summarization track files cumulatively. When generating a summary, omk extracts file operations from:
- Tool calls in the messages being summarized
- Previous compaction or branch summary `details` (if any)

This means file tracking accumulates across multiple compactions or nested branch summaries, preserving the full history of read and modified files.

### BranchSummaryEntry Structure

Defined in [`session-manager.ts`](https://github.com/earendil-works/omk-mono/blob/main/packages/coding-agent/src/core/session-manager.ts):

```typescript
interface BranchSummaryEntry<T = unknown> {
  type: "branch_summary";
  id: string;
  parentId: string;
  timestamp: number;
  summary: string;
  fromId: string;      // Entry we navigated from
  fromHook?: boolean;  // true if provided by extension (legacy field name)
  details?: T;         // implementation-specific data
}

// Default branch summarization uses this for details (from branch-summarization.ts):
interface BranchSummaryDetails {
  readFiles: string[];
  modifiedFiles: string[];
}
```

Same as compaction, extensions can store custom data in `details`.

See [`collectEntriesForBranchSummary()`](https://github.com/earendil-works/omk-mono/blob/main/packages/coding-agent/src/core/compaction/branch-summarization.ts), [`prepareBranchEntries()`](https://github.com/earendil-works/omk-mono/blob/main/packages/coding-agent/src/core/compaction/branch-summarization.ts), and [`generateBranchSummary()`](https://github.com/earendil-works/omk-mono/blob/main/packages/coding-agent/src/core/compaction/branch-summarization.ts) for the implementation.

## Summary Format

Both compaction and branch summarization use the same structured format:

```markdown
## Goal
[What the user is trying to accomplish]

## Constraints & Preferences
- [Requirements mentioned by user]

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

## Resume Handoff
- **First action**: [Single concrete next action]
- **Re-check before editing**: [Workspace state, files, or commands to verify first; use "(none)" if not needed]
- **Evidence status**: [Checks/tests already run and results, or "(not run)"]

<read-files>
path/to/file1.ts
path/to/file2.ts
</read-files>

<modified-files>
path/to/changed.ts
</modified-files>
```

### Message Serialization

Before summarization, messages are serialized to text via [`serializeConversation()`](https://github.com/earendil-works/omk-mono/blob/main/packages/coding-agent/src/core/compaction/utils.ts):

```
[User]: What they said
[Assistant thinking]: Internal reasoning
[Assistant]: Response text
[Assistant tool calls]: read(path="foo.ts"); edit(path="bar.ts", ...)
[Tool result]: Output from tool
```

This prevents the model from treating it as a conversation to continue.

Tool results are truncated to 2000 characters during serialization. Content beyond that limit is replaced with a marker indicating how many characters were truncated. This keeps summarization requests within reasonable token budgets, since tool results (especially from `read` and `bash`) are typically the largest contributors to context size.

After serialization, compaction also applies summary-input packing when the serialized history exceeds `summaryInputTokens`. The packer is deterministic and dependency-free: it preserves the start of the summarized range, the recent tail, and high-signal middle lines containing paths, commands, errors, warnings, decisions, goals, and verification status. This reduces the token cost of auto-compaction itself while keeping handoff-critical evidence recoverable.

## Custom Summarization via Extensions

Extensions can intercept and customize both compaction and branch summarization. See [`extensions/types.ts`](https://github.com/earendil-works/omk-mono/blob/main/packages/coding-agent/src/core/extensions/types.ts) for event type definitions.

### session_before_compact

Fired before auto-compaction or `/compact`. Can cancel or provide custom summary. See `SessionBeforeCompactEvent` and `CompactionPreparation` in the types file.

```typescript
omk.on("session_before_compact", async (event, ctx) => {
  const { preparation, branchEntries, customInstructions, signal } = event;

  // preparation.messagesToSummarize - messages to summarize
  // preparation.turnPrefixMessages - split turn prefix (if isSplitTurn)
  // preparation.previousSummary - previous compaction summary
  // preparation.fileOps - extracted file operations
  // preparation.tokensBefore - context tokens before compaction
  // preparation.firstKeptEntryId - where kept messages start
  // preparation.settings - compaction settings

  // branchEntries - all entries on current branch (for custom state)
  // signal - AbortSignal (pass to LLM calls)

  // Cancel:
  return { cancel: true };

  // Custom summary:
  return {
    compaction: {
      summary: "Your summary...",
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
      details: { /* custom data */ },
    }
  };
});
```

#### Converting Messages to Text

To generate a summary with your own model, convert messages to text using `serializeConversation`:

```typescript
import { convertToLlm, serializeConversation } from "open-multi-agent-kit";

omk.on("session_before_compact", async (event, ctx) => {
  const { preparation } = event;
  
  // Convert AgentMessage[] to Message[], then serialize to text
  const conversationText = serializeConversation(
    convertToLlm(preparation.messagesToSummarize)
  );
  // Returns:
  // [User]: message text
  // [Assistant thinking]: thinking content
  // [Assistant]: response text
  // [Assistant tool calls]: read(path="..."); bash(command="...")
  // [Tool result]: output text

  // Now send to your model for summarization
  const summary = await myModel.summarize(conversationText);
  
  return {
    compaction: {
      summary,
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
    }
  };
});
```

See [custom-compaction.ts](../examples/extensions/custom-compaction.ts) for a complete example using a different model.

### session_before_tree

Fired before `/tree` navigation. Always fires regardless of whether user chose to summarize. Can cancel navigation or provide custom summary.

```typescript
omk.on("session_before_tree", async (event, ctx) => {
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
        details: { /* custom data */ },
      }
    };
  }
});
```

See `SessionBeforeTreeEvent` and `TreePreparation` in the types file.

## Settings

Configure compaction in `~/.omk/agent/settings.json` or `<project-dir>/.omk/settings.json`:

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000,
    "maxUsageRatio": 0.9,
    "summaryInputTokens": 80000
  }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `true` | Enable auto-compaction |
| `reserveTokens` | `16384` | Tokens to reserve for LLM response |
| `keepRecentTokens` | `20000` | Recent tokens to keep (not summarized) |
| `maxUsageRatio` | `0.9` | Ratio trigger for auto-compaction before the reserve boundary |
| `summaryInputTokens` | `80000` | Maximum serialized-history tokens sent to the summarizer before extractive packing; set `0` to disable packing |

Disable auto-compaction with `"enabled": false`. You can still compact manually with `/compact`.
