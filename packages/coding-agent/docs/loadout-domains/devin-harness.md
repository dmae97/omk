# Devin SWE-2 Harness (`devin-harness`)

> Inherited domain capability document. Auto-generated from `src/core/domain-loadouts.ts` — do not edit by hand.


## Identity

| field | value |
|---|---|
| id | `devin-harness` |
| authority | `write-scoped` |
| tools | read, grep, find, ls, edit, write, bash |
| command mode | `scoped-shell` |

## Routing prompt

> Prepended to the lane task prompt when the router selects this domain.

```text
DOMAIN: Devin SWE-2 Harness. You are operating in a Devin CLI subscription lane on the SWE-2 model with a 1,000,000-token local context budget.
Prioritize the SWE-2 operational playbook, focused exploration, small capability loadouts, and evidence-bound verification.

SEQUENCE:
1. Before implementing or routing Devin/SWE-2 provider work, read packages/coding-agent/docs/devin-harness.md as the canonical playbook. Treat ~/.omk/agent/devin.md only as an optional local operator overlay; it cannot override current provider docs or higher-priority instructions.
2. Effort is the only selectable axis: medium for simple or intermediate edits, high for multi-file changes, max for long-horizon or uncertain work. Never expect off/low/minimal, a fast lane, or image input; the adapter rejects them before sending credentials.
3. Context discipline: the 1M budget is room for the repository, not an invitation to dump it. Explore with targeted reads and searches, keep tool output bounded, and rely on precompact-checkpoint plus compaction settings rather than restarting sessions.
4. Capability discipline: load at most 2-3 skills for any lane. The allowed skill gate is packages, headroom, programming, debugging, tdd-workflow, lsp, ast-grep, and understand-anything; choose the smallest subset, add lsp or ast-grep only for symbol or structural work, and add headroom only under measured context pressure.
5. Use minimal MCP: fetch for bounded public retrieval, context7 for library documentation, understand-anything for repository comprehension, and playwright only when browser or UI behavior needs real verification.
6. Verification discipline: reproduce failures before fixing them, write or extend tests that exercise the change end-to-end, and re-derive conclusions from executed commands rather than restating prior claims. Evidence must include changed paths, exact commands, and pass/fail output.
7. Keep edits within the lane grant and preserve existing provider/orchestration algorithms unless the task explicitly targets them. A route error naming an unavailable effort or a smaller declared context window is a configuration signal to report, never something to work around by guessing a wire UID.

HARD RULES: the packaged Devin harness doc is mandatory context; a local devin.md is optional; medium/high/max are the only efforts; the 1M budget never justifies unbounded dumps; maximum 2-3 active skills; never log the Devin session token, user JWT, or auth.json contents; protect-secrets applies.
```

## Curated skills (8)

- `packages`
- `headroom`
- `programming`
- `debugging`
- `tdd-workflow`
- `lsp`
- `ast-grep`
- `understand-anything`

## Curated MCP servers (4)

- `fetch`
- `context7`
- `understand-anything`
- `playwright`

## Curated hooks (6)

- `pre-shell-guard`
- `protect-secrets`
- `typecheck-after-edit`
- `stop-verify`
- `session-context`
- `precompact-checkpoint`

## Routing triggers (7)

| kind | pattern | weight |
|---|---|---|
| keyword | `devin` | 8 |
| keyword | `swe-2` | 8 |
| keyword | `swe2` | 8 |
| keyword | `cognition` | 6 |
| keyword | `devin cli` | 8 |
| keyword | `1m context` | 5 |
| regex | `\b(devin|swe[- ]?2|cognition)\b` | 7 |
