# Research & Investigation (`research`)

> Inherited domain capability document. Auto-generated from `src/core/domain-loadouts.ts` — do not edit by hand.


## Identity

| field | value |
|---|---|
| id | `research` |
| authority | `read-only` |
| tools | read, grep, find, ls |
| command mode | `read-only-shell` |

## Routing prompt

> Prepended to the lane task prompt when the router selects this domain.

```text
DOMAIN: Research & Investigation. You are operating in a read-only research lane.
Prioritize sourced, cited, reproducible findings over speculation.

SEQUENCE:
1. Decompose the question into sub-queries. Gather with the right source: arxiv-database / pubmed-database for academic, exa-search + firecrawl + fetch for web/github, market-research for commercial intel.
2. literature-review for systematic synthesis (PRISMA where applicable, verified citations, dedupe).
3. Evaluate evidence quality with scientific-critical-thinking (GRADE / risk of bias) before trusting a source.
4. Hypothesis generation when the goal is ideation; competitive-analysis when positioning a product.
5. Persist durable findings to memory + obsidian with source URLs and access dates; never store secrets or private PII.

HARD RULES: every claim has a citation; distinguish evidence vs inference explicitly; prefer primary/official sources; flag when evidence is thin rather than confabulating. Read-only: do not modify the codebase.
```

## Curated skills (13)

- `deep-research`
- `literature-review`
- `market-research`
- `exa-search`
- `best-practice-research`
- `arxiv-database`
- `pubmed-database`
- `scientific-brainstorming`
- `hypothesis-generation`
- `scientific-critical-thinking`
- `competitive-analysis`
- `content-strategy`
- `analyze`

## Curated MCP servers (5)

- `firecrawl`
- `fetch`
- `github`
- `memory`
- `obsidian`

## Curated hooks (2)

- `session-context`
- `precompact-checkpoint`

## Routing triggers (15)

| kind | pattern | weight |
|---|---|---|
| keyword | `research` | 6 |
| keyword | `investigate` | 5 |
| keyword | `literature` | 6 |
| keyword | `survey` | 4 |
| keyword | `compare` | 3 |
| keyword | `market` | 4 |
| keyword | `competitor` | 5 |
| keyword | `paper` | 5 |
| keyword | `arxiv` | 7 |
| keyword | `pubmed` | 7 |
| keyword | `summarize` | 3 |
| keyword | `sources` | 4 |
| keyword | `cite` | 4 |
| regex | `\b(state of the art|sota|benchmark|related work)\b` | 5 |
| regex | `\b(find out|look up|what does|why does)\b` | 2 |
