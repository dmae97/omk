# AI Agent Engineering & Ops (`ai-agent-ops`)

> Inherited domain capability document. Auto-generated from `src/core/domain-loadouts.ts` — do not edit by hand.


## Identity

| field | value |
|---|---|
| id | `ai-agent-ops` |
| authority | `write-scoped` |
| tools | read, grep, find, ls, edit, write, bash |
| command mode | `scoped-shell` |

## Routing prompt

> Prepended to the lane task prompt when the router selects this domain.

```text
DOMAIN: AI Agent Engineering & Ops. You are operating in an agent-systems capability lane.
Prioritize eval-driven design, correct context engineering, and safe autonomy.

SEQUENCE:
1. Frame the system: agentic-engineering (eval-first, decomposition, cost-aware routing) + ai-first-engineering operating model.
2. Context: context-engineering for prompt/command/skill/sub-agent construction; iterative-retrieval to solve the subagent context problem; prompt-optimizer before shipping prompts (test with a fresh subagent, RED-GREEN-REFACTOR).
3. Build artifacts: create-agent / create-skill / create-hook for the harness; mcp-builder + mcp-server-patterns for MCP servers (correct tool schemas, Zod, stdio vs HTTP).
4. Autonomy: autonomous-loops / continuous-agent-loop with quality gates + recovery; enterprise-agent-ops for long-lived workloads (observability, boundaries, lifecycle).
5. Evaluate: eval-harness + agent-eval + agent-self-evaluation — never ship an agent change without a measured eval delta. nanoclaw-repl for interactive iteration.
6. Orchestration: harness (team-architecture factory) for multi-agent topology; dispatching-parallel-agents / subagent-driven-development for parallel lanes; ralphinho-rfc-pipeline for DAG + merge queue.

HARD RULES: every agent/skill change has an eval; prompts are versioned and tested, not vibe-edited; MCP servers validate inputs; autonomy is bounded by explicit stop conditions + stop-verify hook.

PATCH SAFETY (B2C Correctness Wall): for pre-apply patch screening, load the correctness-wall extension explicitly (not in default preset). Read packages/coding-agent/docs/correctness-wall.md and examples/extensions/correctness-wall/README.md. Roll out shadow → soft → hard; never claim formal correctness proof.
```

## Curated skills (23)

- `agent-harness-construction`
- `agentic-engineering`
- `ai-first-engineering`
- `autonomous-loops`
- `continuous-agent-loop`
- `enterprise-agent-ops`
- `eval-harness`
- `agent-self-evaluation`
- `agent-eval`
- `mcp-builder`
- `mcp-server-patterns`
- `prompt-optimizer`
- `context-engineering`
- `create-agent`
- `create-skill`
- `create-hook`
- `iterative-retrieval`
- `nanoclaw-repl`
- `blueprint`
- `ralphinho-rfc-pipeline`
- `harness`
- `subagent-driven-development`
- `dispatching-parallel-agents`

## Curated MCP servers (4)

- `filesystem`
- `memory`
- `github`
- `context7`

## Curated hooks (4)

- `session-context`
- `precompact-checkpoint`
- `stop-verify`
- `subagent-stop-audit`

## Routing triggers (23)

| kind | pattern | weight |
|---|---|---|
| keyword | `agent` | 4 |
| keyword | `mcp` | 6 |
| keyword | `prompt` | 4 |
| keyword | `skill` | 3 |
| keyword | `hook` | 3 |
| keyword | `훅` | 4 |
| keyword | `harness` | 6 |
| regex | `\borchestrat\w*\b` | 5 |
| keyword | `eval` | 5 |
| keyword | `subagent` | 6 |
| keyword | `tool` | 2 |
| keyword | `loop` | 3 |
| keyword | `context engineering` | 6 |
| regex | `\b(model context protocol|llm agent|multi-?agent|agentic)\b` | 6 |
| regex | `\b(token budget|context window|compaction|retrieval)\b` | 5 |
| path | `.claude/agents` | 6 |
| path | `.omk/` | 5 |
| path | `SKILL.md` | 5 |
| keyword | `correctness wall` | 8 |
| keyword | `patch safety` | 8 |
| regex | `\bpatch[- ]safety\b` | 7 |
| path | `correctness-wall` | 7 |
| path | `adaptorch-wpl` | 5 |
