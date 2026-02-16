# Compaction and Branch Summaries

Compaction and branch summaries are the two mechanisms that keep long sessions usable without losing prior work context.

- **Compaction** rewrites old history into a summary on the current branch.
- **Branch summary** captures abandoned branch context during `/tree` navigation.

Both are persisted as session entries and converted back into user-context messages when rebuilding LLM input.

## Key implementation files

- `src/session/compaction/compaction.ts`
- `src/session/compaction/branch-summarization.ts`
- `src/session/compaction/pruning.ts`
- `src/session/compaction/utils.ts`
- `src/session/session-manager.ts`
- `src/session/agent-session.ts`
- `src/session/messages.ts`
- `src/extensibility/hooks/types.ts`
- `src/config/settings-schema.ts`

## Session entry model

Compaction and branch summaries are first-class session entries, not plain assistant/user messages.

- `CompactionEntry`
  - `type: "compaction"`
  - `summary`, optional `shortSummary`
  - `firstKeptEntryId` (compaction boundary)
  - `tokensBefore`
  - optional `details`, `preserveData`, `fromExtension`
- `BranchSummaryEntry`
  - `type: "branch_summary"`
  - `fromId`, `summary`
  - optional `details`, `fromExtension`

When context is rebuilt (`buildSessionContext`):

1. Latest compaction on the active path is converted to one `compactionSummary` message.
2. Kept entries from `firstKeptEntryId` to the compaction point are re-included.
3. Later entries on the path are appended.
4. `branch_summary` entries are converted to `branchSummary` messages.
5. `custom_message` entries are converted to `custom` messages.

Those custom roles are then transformed into LLM-facing user messages in `convertToLlm()` using the static templates:

- `prompts/compaction/compaction-summary-context.md`
- `prompts/compaction/branch-summary-context.md`

## Compaction pipeline

### Triggers

Compaction can run in three ways:

1. **Manual**: `/compact [instructions]` calls `AgentSession.compact(...)`.
2. **Automatic overflow recovery**: after an assistant error that matches context overflow.
3. **Automatic threshold compaction**: after a successful turn when context exceeds threshold.

### Compaction shape (visual)

```text
Before compaction:

  entry:  0     1     2     3      4     5     6      7      8     9
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┘
                └────────┬───────┘ └──────────────┬──────────────┘
               messagesToSummarize            kept messages
                                   ↑
                          firstKeptEntryId (entry 4)

After compaction (new entry appended):

  entry:  0     1     2     3      4     5     6      7      8     9      10
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │ cmp │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┴─────┘
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


### Overflow-retry vs threshold compaction

The two automatic paths are intentionally different:

- **Overflow-retry compaction**
  - Trigger: current-model assistant error is detected as context overflow.
  - The failing assistant error message is removed from active agent state before retry.
  - Auto compaction runs with `reason: "overflow"` and `willRetry: true`.
  - On success, agent auto-continues (`agent.continue()`) after compaction.

- **Threshold compaction**
  - Trigger: `contextTokens > contextWindow - compaction.reserveTokens`.
  - Runs with `reason: "threshold"` and `willRetry: false`.
  - On success, if `compaction.autoContinue !== false`, injects a synthetic prompt:
    - `"Continue if you have next steps."`

### Pre-compaction pruning

Before compaction checks, tool-result pruning may run (`pruneToolOutputs`).

Default prune policy:

- Protect newest `40_000` tool-output tokens.
- Require at least `20_000` total estimated savings.
- Never prune tool results from `skill` or `read`.

Pruned tool results are replaced with:

- `[Output truncated - N tokens]`

If pruning changes entries, session storage is rewritten and agent message state is refreshed before compaction decisions.

### Boundary and cut-point logic

`prepareCompaction()` only considers entries since the last compaction entry (if any).

1. Find previous compaction index.
2. Compute `boundaryStart = prevCompactionIndex + 1`.
3. Adapt `keepRecentTokens` using measured usage ratio when available.
4. Run `findCutPoint()` over the boundary window.

Valid cut points include:

- message entries with roles: `user`, `assistant`, `bashExecution`, `hookMessage`, `branchSummary`, `compactionSummary`
- `custom_message` entries
- `branch_summary` entries

Hard rule: never cut at `toolResult`.

If there are non-message metadata entries immediately before the cut point (`model_change`, `thinking_level_change`, labels, etc.), they are pulled into the kept region by moving cut index backward until a message or compaction boundary is hit.

### Split-turn handling

If cut point is not at a user-turn start, compaction treats it as a split turn.

Turn start detection treats these as user-turn boundaries:

- `message.role === "user"`
- `message.role === "bashExecution"`
- `custom_message` entry
- `branch_summary` entry

Split-turn compaction generates two summaries:

1. History summary (`messagesToSummarize`)
2. Turn-prefix summary (`turnPrefixMessages`)

Final stored summary is merged as:

```markdown
<history summary>

---

**Turn Context (split turn):**

<turn prefix summary>
```

### Summary generation

`compact(...)` builds summaries from serialized conversation text:

1. Convert messages via `convertToLlm()`.
2. Serialize with `serializeConversation()`.
3. Wrap in `<conversation>...</conversation>`.
4. Optionally include `<previous-summary>...</previous-summary>`.
5. Optionally inject hook context as `<additional-context>` list.
6. Execute summarization prompt with `SUMMARIZATION_SYSTEM_PROMPT`.

Prompt selection:

- first compaction: `compaction-summary.md`
- iterative compaction with prior summary: `compaction-update-summary.md`
- split-turn second pass: `compaction-turn-prefix.md`
- short UI summary: `compaction-short-summary.md`

Remote summarization mode:

- If `compaction.remoteEndpoint` is set, compaction POSTs:
  - `{ systemPrompt, prompt }`
- Expects JSON containing at least `{ summary }`.

### File-operation context in summaries

Compaction tracks cumulative file activity using assistant tool calls:

- `read(path)` → read set
- `write(path)` → modified set
- `edit(path)` → modified set

Cumulative behavior:

- Includes prior compaction details only when prior entry is pi-generated (`fromExtension !== true`).
- In split turns, includes turn-prefix file ops too.
- `readFiles` excludes files also modified.

Summary text gets file tags appended via prompt template:

```xml
<read-files>
...
</read-files>
<modified-files>
...
</modified-files>
```

### Persist and reload

After summary generation (or hook-provided summary), agent session:

1. Appends `CompactionEntry` with `appendCompaction(...)`.
2. Rebuilds context via `buildSessionContext()`.
3. Replaces live agent messages with rebuilt context.
4. Emits `session_compact` hook event.

## Branch summarization pipeline

Branch summarization is tied to tree navigation, not token overflow.

### Trigger

During `navigateTree(...)`:

1. Compute abandoned entries from old leaf to common ancestor using `collectEntriesForBranchSummary(...)`.
2. If caller requested summary (`options.summarize`), generate summary before switching leaf.
3. If summary exists, attach it at the navigation target using `branchWithSummary(...)`.

Operationally this is commonly driven by `/tree` flow when `branchSummary.enabled` is enabled.

### Branch switch shape (visual)

```text
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


### Preparation and token budget

`generateBranchSummary(...)` computes budget as:

- `tokenBudget = model.contextWindow - branchSummary.reserveTokens`

`prepareBranchEntries(...)` then:

1. First pass: collect cumulative file ops from all summarized entries, including prior pi-generated `branch_summary` details.
2. Second pass: walk newest → oldest, adding messages until token budget is reached.
3. Prefer preserving recent context.
4. May still include large summary entries near budget edge for continuity.

Compaction entries are included as messages (`compactionSummary`) during branch summarization input.

### Summary generation and persistence

Branch summarization:

1. Converts and serializes selected messages.
2. Wraps in `<conversation>`.
3. Uses custom instructions if supplied, otherwise `branch-summary.md`.
4. Calls summarization model with `SUMMARIZATION_SYSTEM_PROMPT`.
5. Prepends `branch-summary-preamble.md`.
6. Appends file-operation tags.

Result is stored as `BranchSummaryEntry` with optional details (`readFiles`, `modifiedFiles`).

## Extension and hook touchpoints

### `session_before_compact`

Pre-compaction hook.

Can:

- cancel compaction (`{ cancel: true }`)
- provide full custom compaction payload (`{ compaction: CompactionResult }`)

### `session.compacting`

Prompt/context customization hook for default compaction.

Can return:

- `prompt` (override base summary prompt)
- `context` (extra context lines injected into `<additional-context>`)
- `preserveData` (stored on compaction entry)

### `session_compact`

Post-compaction notification with saved `compactionEntry` and `fromExtension` flag.

### `session_before_tree`

Runs on tree navigation before default branch summary generation.

Can:

- cancel navigation
- provide custom `{ summary: { summary, details } }` used when user requested summarization

### `session_tree`

Post-navigation event exposing new/old leaf and optional summary entry.

## Runtime behavior and failure semantics

- Manual compaction aborts current agent operation first.
- `abortCompaction()` cancels both manual and auto-compaction controllers.
- Auto compaction emits start/end session events for UI/state updates.
- Auto compaction can try multiple model candidates and retry transient failures.
- Overflow errors are excluded from generic retry path because they are handled by compaction.
- If auto-compaction fails:
  - overflow path emits `Context overflow recovery failed: ...`
  - threshold path emits `Auto-compaction failed: ...`
- Branch summarization can be cancelled via abort signal (e.g., Escape), returning canceled/aborted navigation result.

## Settings and defaults

From `settings-schema.ts`:

- `compaction.enabled` = `true`
- `compaction.reserveTokens` = `16384`
- `compaction.keepRecentTokens` = `20000`
- `compaction.autoContinue` = `true`
- `compaction.remoteEndpoint` = `undefined`
- `branchSummary.enabled` = `false`
- `branchSummary.reserveTokens` = `16384`

These values are consumed at runtime by `AgentSession` and compaction/branch summarization modules.