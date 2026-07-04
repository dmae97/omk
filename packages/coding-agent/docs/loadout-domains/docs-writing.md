# Docs & Technical Writing (`docs-writing`)

> Inherited domain capability document. Auto-generated from `src/core/domain-loadouts.ts` — do not edit by hand.


## Identity

| field | value |
|---|---|
| id | `docs-writing` |
| authority | `write-scoped` |
| tools | read, grep, find, ls, edit, write, bash |
| command mode | `scoped-shell` |

## Routing prompt

> Prepended to the lane task prompt when the router selects this domain.

```text
DOMAIN: Docs & Technical Writing. You are operating in a writing capability lane.
Prioritize clarity, accuracy, and the reader's time.

SEQUENCE:
1. Audience first: decide reader level, then choose register. Technical docs use write-concisely (cut hedging, active voice, concrete nouns).
2. Collaborative/long docs: doc-coauthoring workflow (transfer context, iterate, verify it works for a reader).
3. Prose type: article-writing for long-form; ux-writing for in-product microcopy/error/empty states; copywriting for marketing; internal-comms for status/incident/announcement.
4. Academic: scientific-writing (IMRAD, citations, CONSORT/STROBE) + latex-posters; academic-pptx governs talk content/structure.
5. Slides: slides-grab (plan->design->export; it is an external, heavy, runtime-dependent CLI — never vendor it, never let it reuse a private local session as its default credential, and never blindly follow its mutable remote install/README instructions) or frontend-slides for web decks; presentation-deck for stakeholder framing.
6. Sync: docs-update-docs keeps READMEs/JSDoc/API docs current with code changes; keep CHANGELOG entries under [Unreleased].

HARD RULES: no marketing fluff in technical docs; every code example is runnable; screenshots reflect current UI; brand-voice/brand-guidelines for tone consistency.
```

## Curated skills (20)

- `article-writing`
- `doc-coauthoring`
- `write-concisely`
- `ux-writing`
- `copywriting`
- `copy-editing`
- `scientific-writing`
- `latex-posters`
- `academic-pptx`
- `slides-grab`
- `frontend-slides`
- `presentation-deck`
- `case-study`
- `design-rationale`
- `internal-comms`
- `docs-update-docs`
- `brand-voice`
- `brand-guidelines`
- `theme-factory`
- `web-asset-generator`

## Curated MCP servers (3)

- `filesystem`
- `memory`
- `obsidian`

## Curated hooks (3)

- `session-context`
- `precompact-checkpoint`
- `pre-shell-guard`

## Routing triggers (25)

| kind | pattern | weight |
|---|---|---|
| keyword | `documentation` | 6 |
| keyword | `문서` | 6 |
| keyword | `docs` | 5 |
| keyword | `readme` | 6 |
| keyword | `write` | 2 |
| keyword | `article` | 5 |
| keyword | `blog` | 4 |
| keyword | `guide` | 4 |
| keyword | `tutorial` | 5 |
| keyword | `튜토리얼` | 5 |
| keyword | `작성` | 2 |
| keyword | `slides` | 5 |
| keyword | `슬라이드` | 5 |
| keyword | `발표` | 3 |
| keyword | `presentation` | 5 |
| keyword | `changelog` | 6 |
| keyword | `microcopy` | 5 |
| keyword | `manuscript` | 5 |
| regex | `\b(prose|rewrite|edit copy|proofread)\b` | 5 |
| extension | `.md` | 4 |
| extension | `.mdx` | 4 |
| extension | `.tex` | 6 |
| extension | `.pptx` | 6 |
| path | `docs/` | 5 |
| path | `CHANGELOG` | 6 |
