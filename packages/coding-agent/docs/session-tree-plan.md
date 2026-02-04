# Session Tree Architecture (Current)

Reference: [session.md](./session.md), [tree.md](./tree.md)

This document summarizes the current session tree implementation and extension touchpoints. It replaces the historical rollout checklist.

## Session file format (v3)

- JSONL file with a SessionHeader (version 3). Header is metadata only and does not participate in the tree.
- Every SessionEntry derives from SessionEntryBase: `id`, `parentId`, `timestamp`.
- Entries are append-only; branching only moves the leaf pointer.
- Entry types: `message`, `compaction`, `branch_summary`, `custom`, `custom_message`, `label`, `model_change`, `thinking_level_change`, `ttsr_injection`, `session_init`.

## SessionManager core

- Tracks `byId`, `labelsById`, `leafId`, and usage statistics.
- Tree APIs:
  - `getLeafId()`, `getLeafEntry()`, `getEntry(id)`, `getChildren(id)`
  - `getBranch(fromId?)` → root-to-leaf path
  - `getTree()` → `SessionTreeNode { entry, children, label }`
  - `getLabel(id)`
- `buildSessionContext()` walks from the current leaf and resolves compaction. `custom_message` and `branch_summary` entries are converted to AgentMessage roles and later to user-role LLM messages via `convertToLlm()`.
- Appenders (all return entry id and advance the leaf): `appendMessage`, `appendCompaction`, `appendCustomEntry`, `appendCustomMessageEntry`, `appendLabelChange`, `appendModelChange`, `appendThinkingLevelChange`, `appendSessionInit`, `appendTtsrInjection`.
- `getSessionFile()` returns `string | undefined` for in-memory sessions. `flush()` persists pending writes.

## Migration

- `CURRENT_SESSION_VERSION = 3`.
- v1 → v2: assigns `id`/`parentId` and converts compaction `firstKeptEntryIndex` to `firstKeptEntryId`.
- v2 → v3: renames message role `hookMessage` → `custom`.
- `SessionManager.open()` / `setSessionFile()` rewrite the file after migration.

## Branching

- `branch(entryId)` moves the leaf pointer to a prior entry.
- `resetLeaf()` sets the leaf to `null` so the next append creates a new root entry.
- `branchWithSummary(branchFromId, summary, details?, fromExtension?)` appends `branch_summary` and switches the leaf.
- `createBranchedSession(leafId)` writes a new session file containing the selected path; `LabelEntry` values are rebuilt from resolved labels. In-memory sessions replace their entries and return `undefined`.

## Compaction integration

- `CompactionEntry` / `CompactionResult` are generic with optional `details` and `preserveData`; `firstKeptEntryId` is the compaction anchor.
- `session_before_compact` provides `CompactionPreparation`, `branchEntries`, `customInstructions`, and `signal`.
- `session.compacting` allows overriding the compaction prompt/context.
- `session_compact` emits the final `CompactionEntry` and `fromExtension` flag.

## Labels

- `LabelEntry` stores `targetId` + `label`; `labelsById` maps targetId → label.
- `appendLabelChange(targetId, label?)` sets or clears labels.
- Tree selector shows labels and supports the "labeled-only" filter. Press Shift+L in `/tree` to edit the selected label.

## Custom messages

- `CustomMessageEntry` stores `customType`, `content`, `display`, `details`; converted to AgentMessage role `custom`.
- `buildSessionContext()` includes `custom_message` entries; `convertToLlm()` maps them to user-role LLM messages.
- TUI rendering: `display=false` hides the entry; `display=true` uses `customMessageBg`/`customMessageText`/`customMessageLabel` theme tokens.
- Extensions can override rendering via `registerMessageRenderer(customType, renderer)`.

## Extension API touchpoints

- `sendMessage(...)` appends a `CustomMessageEntry`. options: `triggerTurn`, `deliverAs` ("steer" | "followUp" | "nextTurn").
- `sendUserMessage(...)` always triggers a turn with a real user message.
- `appendEntry(customType, data)` persists extension state (`CustomEntry`, not sent to the LLM).
- `registerCommand(name, { description?, handler })` registers `/commands`. Handlers return `void`; trigger turns explicitly with `sendMessage`/`sendUserMessage`.
- `ExtensionContext` exposes `sessionManager` (read-only), `modelRegistry`, `model`, `getContextUsage()`, `compact()`, and abort/idle helpers.
- `ExtensionCommandContext` adds `waitForIdle()`, `newSession()`, `branch()`, `navigateTree()`.

## Agent context events

- `context`: called before each LLM call with `AgentMessage[]`; returning `{ messages }` replaces the prompt messages for this call (not persisted).
- `before_agent_start`: fired after the user prompt but before the agent loop; event includes `prompt`, `images`, and `systemPrompt`.
  - Result can add a `CustomMessage` and/or replace the `systemPrompt` for the turn. Multiple extensions can contribute messages; `systemPrompt` updates chain in order.

## Tree UI + commands

- `/tree`: in-place navigation with search, filter modes (default/no-tools/user-only/labeled-only/all), labels, and active-path highlighting.
- `/branch`: creates a new session file from the current path.
- Tree navigation emits `session_before_tree` with `TreePreparation` (`targetId`, `oldLeafId`, `commonAncestorId`, `entriesToSummarize`, `userWantsSummary`) and `session_tree` with `SessionTreeEvent` (`newLeafId`, `oldLeafId`, `summaryEntry?`, `fromExtension?`).

## HTML export

- Session HTML export includes a sidebar tree with search, the same filter modes as `/tree`, and a responsive hamburger toggle.
- URL parameters `leafId`/`targetId` allow deep-linking to a branch and specific entry.
