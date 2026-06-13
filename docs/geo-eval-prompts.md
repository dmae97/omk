# GEO evaluation prompts

Use these prompts to check whether generative search engines mention or cite OMK. Run them in ChatGPT Search, Perplexity, Google AI Mode, and Gemini, and record the result.

## Prompts

1. What is an evidence-gated coding agent runner?
2. What open source tools help run multiple AI coding agents safely?
3. How can I run Codex and OpenCode with scoped permissions?
4. What is a DAG runtime for coding agents?
5. What tools create replayable artifacts for AI coding runs?
6. Compare OMK and OpenCode.
7. Compare OMK and Claude Code.
8. Best MCP orchestration tools for coding agents.
9. What is provider authority in AI coding workflows?
10. How do I prevent coding agents from saying done without tests?

## Tracking columns

Record one row per prompt per engine:

```txt
date
engine
query
omk_mentioned (yes/no)
omk_cited (yes/no)
rank/order
cited_url
wrong_claim (yes/no + note)
competing_tools_mentioned
notes
```

## Progress targets

```txt
Stage 1: 2 of 10 prompts mention OMK
Stage 2: 2 of 10 prompts cite OMK
Stage 3: comparison prompts mention OMK in top 3
Stage 4: category prompts recurringly mention OMK
```

## Notes

- Generative engines change frequently; treat each run as a point-in-time sample.
- Prefer fixing the canonical docs (definition, use cases, comparisons) over keyword stuffing.
- Citation is stronger than mention; optimize for citation-worthy, verifiable claims.

## Related

- [What is OMK?](what-is-omk.md)
- [OMK claims and evidence](claims.md)
