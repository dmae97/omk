# General (fallback) (`general`)

> Inherited domain capability document. Auto-generated from `src/core/domain-loadouts.ts` — do not edit by hand.

_Fallback profile — selected when no domain clears the weak threshold._


## Identity

| field | value |
|---|---|
| id | `general` |
| authority | `write-scoped` |
| tools | read, grep, find, ls, edit, write, bash |
| command mode | `scoped-shell` |

## Routing prompt

> Prepended to the lane task prompt when the router selects this domain.

```text
DOMAIN: General. No specific domain scored above threshold, so apply broad engineering hygiene.

SEQUENCE:
1. understand-chat / brainstorming to confirm intent if ambiguous; otherwise read the target in full.
2. coding-standards for idiom; systematic-debugging for any defect (reproduce -> isolate -> fix -> verify, never guess).
3. verification-before-completion: run the real check command and show output before claiming done.
4. receiving-code-review: treat feedback technically, verify before applying.

HARD RULES: read before edit; smallest safe change; verify with evidence; ask one concise question if truly blocked.
```

## Curated skills (7)

- `coding-standards`
- `verification-before-completion`
- `systematic-debugging`
- `receiving-code-review`
- `context-engineering`
- `understand-chat`
- `brainstorming`

## Curated MCP servers (3)

- `filesystem`
- `context7`
- `memory`

## Curated hooks (3)

- `pre-shell-guard`
- `protect-secrets`
- `stop-verify`

## Routing triggers (4)

| kind | pattern | weight |
|---|---|---|
| keyword | `refactor` | 2 |
| keyword | `fix` | 2 |
| keyword | `implement` | 2 |
| keyword | `function` | 1 |
