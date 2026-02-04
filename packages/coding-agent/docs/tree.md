# Session Tree Navigation

The `/tree` command provides tree-based navigation of the session history.

## Overview

Sessions are stored as trees where each entry has an `id` and `parentId`. The "leaf" pointer tracks the current position. `/tree` lets you navigate to any point and optionally summarize the branch you're leaving.

### Comparison with `/branch`

| Feature | `/branch` | `/tree` |
|---------|-----------|---------|
| View | Flat list of user messages | Full tree structure |
| Action | Extracts path to **new session file** | Changes leaf in **same session** |
| Summary | Never | Optional (user prompted) |
| Events | `session_before_branch` / `session_branch` | `session_before_tree` / `session_tree` |

## Tree UI

```
├─ user: "Hello, can you help..."
│  └─ assistant: "Of course! I can..."
│     ├─ • user: "Let's try approach A..."
│     │  └─ • assistant: "For approach A..."
│     │     └─ • [label-name] user: "That worked..."
│     └─ user: "Actually, approach B..."
│        └─ assistant: "For approach B..."
```

### Controls

| Key | Action |
|-----|--------|
| ↑/↓ | Move selection |
| ←/→ | Page up/down |
| Enter | Select node |
| Escape | Clear search (if active) or cancel |
| Ctrl+C | Cancel |
| Ctrl+O / Shift+Ctrl+O | Cycle filter forward/back |
| Alt+D/T/U/L/A | Set filter: default / no-tools / user-only / labeled-only / all |
| Shift+L | Edit label for selected entry |
| Type | Search (space-separated tokens) |
| Backspace | Remove last search character |

### Display

- Tree list height: `max(5, floor(terminalHeight / 2))` lines
- Active path marked with a bullet (`•`) before each entry (current leaf is last node on the path)
- Labels shown inline: `[label-name]` before the entry text
- Default filter hides `label`, `custom`, `model_change`, and `thinking_level_change` entries
- Assistant messages with only tool calls are hidden unless they contain errors/aborts (current leaf is always shown)
- `no-tools` filter hides tool result messages
- Children sorted by timestamp (oldest first)

## Selection Behavior

### User Message or Custom Message
1. Leaf set to **parent** of selected node (or `null` if root)
2. Message text placed in **editor** for re-submission
3. User edits and submits, creating a new branch

### Non-User Message (assistant, compaction, etc.)
1. Leaf set to **selected node**
2. Editor stays empty
3. User continues from that point

### Selecting Root User Message
If user selects the very first message (has no parent):
1. Leaf reset to `null` (empty conversation)
2. Message text placed in editor
3. User effectively restarts from scratch

## Branch Summarization

If branch summaries are enabled (`branchSummary.enabled`), the user is prompted:

- No summary
- Summarize
- Summarize with custom prompt (passed as `customInstructions`)

### What Gets Summarized

Path from old leaf back to common ancestor with target:

```
A → B → C → D → E → F  ← old leaf
        ↘ G → H        ← target
```

Abandoned path: D → E → F (summarized)

Summarization stops at the common ancestor only.
Compaction and branch summary entries are included; tool results are ignored.

### Summary Storage

Stored as `BranchSummaryEntry`:

```typescript
interface BranchSummaryEntry {
  type: "branch_summary";
  id: string;
  parentId: string | null; // New leaf position (null when navigating to root)
  timestamp: string;
  fromId: string;        // Entry the summary is attached to ("root" if null)
  summary: string;       // LLM-generated summary
  details?: unknown;     // Optional hook data
  fromExtension?: boolean;
}
```

## Implementation

### AgentSession.navigateTree()

```typescript
async navigateTree(
  targetId: string,
  options?: { summarize?: boolean; customInstructions?: string }
): Promise<{ editorText?: string; cancelled: boolean; aborted?: boolean; summaryEntry?: BranchSummaryEntry }>
```

Flow:
1. Validate target, check no-op (target === current leaf)
2. Find common ancestor between old leaf and target
3. Collect entries to summarize (if requested, includes compaction entries)
4. Fire `session_before_tree` event (hook can cancel or provide summary)
5. Run default summarizer if needed (respects `customInstructions`)
6. Switch leaf via `branch()` or `branchWithSummary()`
7. Update agent: `agent.replaceMessages(sessionManager.buildSessionContext().messages)`
8. Fire `session_tree` event (includes `summaryEntry`/`fromExtension` when applicable)
9. Return result with `editorText` if user message was selected

### SessionManager

- `getLeafId(): string | null` - Current leaf (null if empty)
- `resetLeaf(): void` - Set leaf to null (for root user message navigation)
- `getTree(): SessionTreeNode[]` - Full tree with children sorted by timestamp
- `branch(id)` - Change leaf pointer
- `branchWithSummary(id: string | null, summary, details?, fromExtension?)` - Change leaf and create summary entry

### InteractiveMode

`/tree` command shows `TreeSelectorComponent`, then:
1. If `branchSummary.enabled`, prompt for summary type (including custom prompt)
2. Call `session.navigateTree()` with `summarize`/`customInstructions`
3. Clear and re-render chat
4. Set editor text if applicable

## Hook Events

### `session_before_tree`

```typescript
interface TreePreparation {
  targetId: string;
  oldLeafId: string | null;
  commonAncestorId: string | null;
  entriesToSummarize: SessionEntry[];
  userWantsSummary: boolean;
}

interface SessionBeforeTreeEvent {
  type: "session_before_tree";
  preparation: TreePreparation;
  signal: AbortSignal;
}

interface SessionBeforeTreeResult {
  cancel?: boolean;
  summary?: { summary: string; details?: unknown };
}
```

### `session_tree`

```typescript
interface SessionTreeEvent {
  type: "session_tree";
  newLeafId: string | null;
  oldLeafId: string | null;
  summaryEntry?: BranchSummaryEntry;
  fromExtension?: boolean;
}
```

### Example: Custom Summarizer

```typescript
export default function(pi: HookAPI) {
  pi.on("session_before_tree", async (event, ctx) => {
    if (!event.preparation.userWantsSummary) return;
    if (event.preparation.entriesToSummarize.length === 0) return;
    
    const summary = await myCustomSummarizer(event.preparation.entriesToSummarize);
    return { summary: { summary, details: { custom: true } } };
  });
}
```

## Error Handling

- Summarization failure: navigation is cancelled and the caller shows the error
- Escape during summarization: returns `{ cancelled: true, aborted: true }` and the selector reopens
- Hook returns `cancel: true`: navigation is cancelled (caller decides UI)
- Escape in the tree selector clears search first, then cancels if empty
