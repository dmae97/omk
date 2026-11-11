# Subagent Example

Delegate tasks to specialized subagents with isolated context windows.

## Features

- **Isolated context**: Each subagent runs in a separate `omk` process
- **Session model inheritance**: Agents without `model` use the parent session's currently selected model; an explicit `model` pins the child
- **Streaming output**: See tool calls and progress as they happen
- **Parallel streaming**: All parallel tasks stream updates simultaneously
- **Validated task graphs**: Dependency DAGs fail closed on duplicate/unknown/cyclic nodes and execute in deterministic parallel waves
- **Explicit handoffs**: Graph nodes receive only declared dependency output and only when their task includes `{dependencies}`
- **Markdown rendering**: Final output rendered with proper formatting (expanded view)
- **Usage tracking**: Shows turns, tokens, cost, and context usage per agent
- **Abort support**: Ctrl+C propagates to the entire detached subagent process tree
- **Dual-budget planning**: Predictive sharding uses both estimated tokens and learned wall-clock demand
- **Checkpoint resume**: A cutoff resumes only the unfinished shard with bounded prior evidence
- **Cutoff learning**: Completion/cutoff history is persisted per provider and model under the agent state directory
- **Bounded cost**: At most 3 semantic shards and 1 resume across the whole logical task by default
- **Attempt receipts**: Bounded execution preserves the final attempt identity, process termination receipt, and stream digest/limits (tool-result details stay plain data; the live settlement Promise is kept internally); usage and output remain cumulative across attempts
- **Effort budgets**: Every effort, including Ultra, has finite task, concurrency, and deadline limits. Workers inherit the parent effort through `--thinking`; their resolved model applies the existing capability clamp
- **Parent completion reserve**: When the host supplies a remaining run budget, child work leaves 30 seconds for integration and required verification; the budget is checked again immediately before spawn
- **Shared ownership**: Single, chain, parallel, and graph modes all use the session lane authority when available. A timeout cannot release ownership of a process whose termination is unconfirmed

## Structure

```
subagent/
├── README.md            # This file
├── index.ts                    # The extension entry point
├── adaptive-agent-runtime.ts   # Shard/checkpoint/resume coordinator
├── adaptive-result.ts          # Attempt merge: cumulative usage/output, latest-attempt receipts
├── checkpoint-runtime.ts       # Bounded checkpoint protocol
├── deadline-budget.ts          # Token + wall-clock planning and cutoff learning
├── deadline-profile-store.ts   # Persistent provider/model profiles
├── owned-agent.ts              # Single/chain admission and process-settlement ownership
├── managed-process.ts          # Process-tree termination and cleanup
├── managed-process-tree.ts     # Process-group observation and signalling
├── subagent-stream.ts          # Bounded JSONL output parser and stream receipt
├── subagent-runtime-types.ts   # Typed result/deadline metadata
├── graph-result.ts             # Graph-mode result helpers and display projection
├── workflow-graph.ts           # Task-graph planning and validation
├── agents.ts                   # Agent discovery logic
├── agent-capability-router.ts  # Deterministic agent → capability routing
├── capabilities.ts             # Agent skill/MCP/hook declaration validation
├── domain-profiles.ts          # Domain profiles for the capability router
├── agents/              # Sample agent definitions
│   ├── scout.md         # Fast recon, returns compressed context
│   ├── planner.md       # Creates implementation plans
│   ├── reviewer.md      # Code review
│   └── worker.md        # General-purpose (full capabilities)
└── prompts/             # Workflow presets (prompt templates)
    ├── implement.md     # scout -> planner -> worker
    ├── scout-and-plan.md    # scout -> planner (no implementation)
    └── implement-and-review.md  # worker -> reviewer -> worker
```

## Installation

From the repository root, symlink the files:

```bash
# Symlink the extension (must be in a subdirectory with index.ts)
mkdir -p ~/.omk/agent/extensions/subagent
src="$(pwd)/packages/coding-agent/examples/extensions/subagent"
for f in index.ts agents.ts agent-capability-router.ts capabilities.ts domain-profiles.ts \
  adaptive-agent-runtime.ts adaptive-result.ts checkpoint-runtime.ts deadline-budget.ts \
  deadline-profile-store.ts managed-process.ts managed-process-tree.ts subagent-runtime-types.ts \
  subagent-stream.ts graph-result.ts workflow-graph.ts owned-agent.ts \
  worker-env.ts worker-extensions.ts nesting.ts; do
  ln -sf "$src/$f" ~/.omk/agent/extensions/subagent/$f
done

# Symlink agents
mkdir -p ~/.omk/agent/agents
for f in packages/coding-agent/examples/extensions/subagent/agents/*.md; do
  ln -sf "$(pwd)/$f" ~/.omk/agent/agents/$(basename "$f")
done

# Symlink workflow prompts
mkdir -p ~/.omk/agent/prompts
for f in packages/coding-agent/examples/extensions/subagent/prompts/*.md; do
  ln -sf "$(pwd)/$f" ~/.omk/agent/prompts/$(basename "$f")
done
```

## Security Model

This tool executes a separate `omk` subprocess with a delegated system prompt and tool/model configuration.

**Project-local agents** (`.omk/agents/*.md`) are repo-controlled prompts that can instruct the model to read files, run bash commands, etc.

**Default behavior:** Only loads **user-level agents** from `~/.omk/agent/agents`.

To enable project-local agents, pass `agentScope: "both"` (or `"project"`). Only do this for repositories you trust.

When running interactively, the tool prompts for confirmation before running project-local agents. Set `confirmProjectAgents: false` to disable.

### Extensions in workers

Workers start with `--no-extensions`: your global and project extensions (`extensions/` directories, `extensions` and `packages` entries) do not load in them. Skills, prompt templates, context files, the command-safety gate and the todo checklist are unchanged. The parent's own `-e` paths are not passed down either.

- **Provider auto-forward:** if the worker's model (pinned in the agent file or inherited from the session) comes from a provider an extension registered, that one extension is loaded in the worker as `-e <absolute path>`. An extension that only overrides a built-in provider's `baseUrl`/`headers` counts too.
- **Opt back in:** set `OMK_WORKER_EXTENSIONS=all` to keep full discovery in workers, or a comma-separated list such as `OMK_WORKER_EXTENSIONS=my-mcp-adapter,memory` to load those extensions. Entries are matched against the extensions this session loaded, by absolute path or by name (package name for `npm:`/`git:` packages, otherwise the file name without extension, or the directory name for `index.ts`). A name shared by two extensions loads neither; use the absolute path. Package sources (`npm:…`, `git:…`, `https://…`) are never forwarded.
- **Warnings:** problems are printed once to stderr as `omk subagent: OMK_WORKER_EXTENSIONS: …` and never stop a spawn. On the first spawn, an extension that changes provider requests (`before_provider_request`) and stays out of workers is named with the setting that keeps it.
- `OMK_WORKER_EXTENSIONS` is passed to workers unchanged, so a worker that spawns workers applies the same rule.

## Usage

### Single agent

```
Use scout to find all authentication code
```

### Parallel execution

```
Run 2 scouts in parallel: one to find models, one to find providers
```

### Chained workflow

```
Use a chain: first have scout find the read tool, then have planner suggest improvements
```

### Workflow prompts

```
/implement add Redis caching to the session store
/scout-and-plan refactor auth to support OAuth
/implement-and-review add input validation to API endpoints
```

## Tool Modes

| Mode | Parameter | Description |
|------|-----------|-------------|
| Single | `{ agent, task }` | One logical task; the runtime may split it into bounded semantic shards |
| Parallel | `{ tasks: [...] }` | Independent logical tasks, bounded by the effort policy and the parent admission limit |
| Chain | `{ chain: [...] }` | Sequential with `{previous}` placeholder and a fair deadline share per remaining step |
| Graph | `{ graph: [{ id, agent, task, dependsOn? }] }` | Validated dependency DAG; ready nodes run in parallel waves, and any failed wave blocks downstream nodes |

Graph nodes opt in to dependency output by placing `{dependencies}` in `task`. The runtime injects only outputs named in that node's `dependsOn`; without the placeholder, no prior output is appended. Each dependency handoff is capped at 16 KiB. This keeps large or unrelated context from leaking across nodes.

Optional execution controls:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `executionBudgetMs` | Effort dependent | Finite internal budget; explicit values from 60000 to 840000 ms override the effort default, but cannot extend the parent budget |
| `maxResumeAttempts` | `1` | Retries only the active unfinished shard; accepted range is 0-2 and all retries consume the same budget |

See [Subagent execution budgets](../../../docs/subagents.md) for the effort table, settlement contract, and verification scope.

## Output Display

Graph mode forwards progress in both the session-governed and legacy paths,
including all adaptive attempts. The first text delta is shown immediately;
later deltas are coalesced on arrival at a 100 ms interval, without a timer queue.
The latest node preview retains at most 4,096 UTF-16 code units. Completed
messages still update immediately. Previews are not receipts, checkpoint text,
dependency outputs, or completed nodes. Abort suppresses later display callbacks;
final results still require the existing stream and process-settlement checks.
Partial rendering preserves supplied sibling rows and tool-call summaries,
with separate running/completed/failed icons. It shows up to five recent blocks
per row and caps each text block at 4,096 code units; full receipts are unchanged.
See [Lifecycle and progress hardening](../../../docs/runtime-algorithms.md#cd-lifecycle-and-progress-hardening-2026-09-30).

**Collapsed view** (default):
- Status icon (✓/✗/⏳) and agent name
- Last 5-10 items (tool calls and text)
- Usage stats: `3 turns ↑input ↓output RcacheRead WcacheWrite $cost ctx:contextTokens model`

**Expanded view** (Ctrl+O):
- Full task text
- All tool calls with formatted arguments
- Final output rendered as Markdown
- Per-task usage (for chain/parallel)

**Parallel mode streaming**:
- Shows all tasks with live status (⏳ running, ✓ done, ✗ failed)
- Updates as each task makes progress
- Shows "2/3 done, 1 running" status
- Returns each completed task's final output to the parent model, capped at 50 KB per task
- Returns failure diagnostics from stderr/error messages when a child exits before producing output

**Tool call formatting** (mimics built-in tools):
- `$ command` for bash
- `read ~/path:1-10` for read
- `grep /pattern/ in ~/path` for grep
- etc.

## Agent Definitions

Agents are markdown files with YAML frontmatter:

```markdown
---
name: my-agent
description: What this agent does
tools: read, grep, find, ls
---

System prompt for the agent goes here.
```

`model` is optional. Omit it to inherit the model currently selected in the parent session; set it only when the agent must be pinned to a specific model.

**Locations:**
- `~/.omk/agent/agents/*.md` - User-level (always loaded)
- `.omk/agents/*.md` - Project-level (only with `agentScope: "project"` or `"both"`)

Project agents override user agents with the same name when `agentScope: "both"`.

## Sample Agents

| Agent | Purpose | Model | Tools |
|-------|---------|-------|-------|
| `scout` | Fast codebase recon | Parent session | read, grep, find, ls, bash |
| `planner` | Implementation plans | Parent session | read, grep, find, ls |
| `reviewer` | Code review | Parent session | read, grep, find, ls, bash |
| `worker` | General-purpose | Parent session | (all default) |

## Workflow Prompts

| Prompt | Flow |
|--------|------|
| `/implement <query>` | scout → planner → worker |
| `/scout-and-plan <query>` | scout → planner |
| `/implement-and-review <query>` | worker → reviewer → worker |

## Error Handling

- **Exit code != 0**: Tool returns error with stderr/output
- **stopReason "error"**: LLM error propagated with error message
- **stopReason "aborted"**: User abort (Ctrl+C) terminates and reaps the subprocess tree
- **stopReason "deadline"**: An internal cutoff returns elapsed/deadline/checkpoint/resume metadata. Insufficient parent integration reserve prevents a new worker from starting
- **Ultra**: Up to 4 concurrent workers and 16 logical tasks, with a finite default budget of 14 minutes; parent admission can narrow these limits
- **Chain mode**: Stops at first failing step, reports which step failed, and preserves completed earlier steps
- **Graph mode**: Rejects malformed graphs before spawn; a failed wave prevents all downstream starts and preserves completed node evidence
- **Duplicate prevention**: A cutoff with no new checkpoint or streamed evidence is not retried
- **Loop guard (always on, spec 071)**: A worker is stopped on the 3rd identical tool call in a row with the same result (a repeated call whose output changes, such as polling, is not stopped), the same error in 3 turns in a row (parallel failures in one turn count once), an A·B ping-pong over 6 calls, 5 turns without a file change or new tool output, or any `subagent` call from a worker. Depth = min(`OMK_SUBAGENT_MAX_DEPTH`, 1): unset or invalid → 1, `0` disables spawning, values > 1 clamp to 1. A bash `grep`/`rg` that exits 1 with no output is "no match" and does not count as an error. The stop is returned as an error (`subagent.loop_guard.<rule>`, typed `loopGuard` in details) with the partial output, and is never retried

## Limitations

- Output truncated to last 10 items in collapsed view (expand to see all)
- Parallel model-visible output is capped at 50 KB per task; full results remain in tool details
- Agents discovered fresh on each invocation (allows editing mid-session)
- Workers load no user extensions by default, so extension tools (for example from an MCP adapter) are missing there unless `OMK_WORKER_EXTENSIONS` names the extension; see [Extensions in workers](#extensions-in-workers)
- Effort caps apply per tool call. The session admission and shared permit pool can reduce parallelism further; the effort table is not an aggregate process RSS limit
- Cancellation and process cleanup can fail. An unconfirmed child remains owned and is reported as unsettled, never successful; the runtime cannot guarantee that every delegated task succeeds before the lead completes
- Automatic semantic pre-sharding requires an explicit numbered/checklist action list; indivisible prose is checkpointed and resumed as one shard
- Checkpoints are best-effort child artifacts plus runtime-captured stream evidence; workspace side effects remain the source of truth after a cutoff
