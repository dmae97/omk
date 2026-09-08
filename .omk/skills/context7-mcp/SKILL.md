---
name: context7-mcp
description: Fetch current library and framework documentation through the Context7 MCP server instead of answering from training data, with a hard cap of three Context7 calls per question, an explicit CONTEXT7_UNAVAILABLE block on quota or rate-limit failure, and a TTL + ETag-revalidated disk cache (scripts/lib/doc-fetch-cache.sh) checked before every fetch. Use when the user asks about setup, configuration, APIs, or code examples for a named library or framework such as React, Next.js, Vue, Svelte, Express, Tailwind, Prisma, or Supabase.
compatibility: Requires the `context7` MCP preset (npx -y @upstash/context7-mcp) registered in OMK and bash with sha256sum, shasum, or openssl for the cache helper.
license: LICENSE-THIRD-PARTY
---

<!-- OMK-PROVENANCE
source: https://github.com/danielvm-git/bigpowers
pinned-commit: 0e071af3e003fef676fa2e7de8e12c68c981a7e7 (tag v2.88.0, npm bigpowers@2.88.0)
upstream-path: .pi/skills/context7-mcp/SKILL.md (skill body) and scripts/lib/doc-fetch-cache.sh (cache helper)
license: MIT, Copyright (c) 2026 Daniel VM -- full text in LICENSE-THIRD-PARTY (this directory)
retrieved: 2026-09-04
sha256(upstream SKILL.md @ pinned commit): 71f6249f6615377af05c61716097a0844420d7a8ac058ff9a226a6565846a5f5
sha256(upstream doc-fetch-cache.sh @ pinned commit): 8b0677e4f2fa4aba532c62845985bf97c1f5adf2bb5555d688b973a0d89b45d3
sha256(upstream LICENSE @ pinned commit): ab5c332485a9ffad649f5a341d5ecfd35abff52249bf2a5c958f168a002ce376

OMK-specific deltas (the upstream body is otherwise kept as written):
  - frontmatter: dropped the non-standard `model: haiku` key; added `compatibility` and `license`.
  - fallback: upstream points at `bts docs <lib>`, a bigpowers CLI that OMK does not ship. The
    CONTEXT7_UNAVAILABLE block now asks for the official docs URL instead.
  - cache helper: rewritten for OMK at scripts/lib/doc-fetch-cache.sh. Same get/put/stale surface;
    keys are normalized in the script, the default directory is the git-ignored .omk/cache/docs
    resolved from the script location, and etag/touch/purge were added for conditional refresh.
  - the MCP server itself is the pinned `context7` preset in
    packages/coding-agent/src/core/mcp-presets.ts, not a bigpowers-managed server.
-->

# Context7 MCP

> **HARD GATE** — Max **3** Context7 tool calls per user question (`resolve-library-id` + `query-docs` count toward the cap). On quota/rate-limit errors, emit an explicit **CONTEXT7_UNAVAILABLE** block — do NOT silently answer from training data.
>
> **HARD GATE** — Before HTTP fetch, check `bash scripts/lib/doc-fetch-cache.sh get "<libraryId>:<query>"`. Cache hit within TTL → use cached body (no round-trip). On ETag mismatch after conditional refresh, replace cache entry.

## When to Use

- Setup/configuration questions ("How do I configure Next.js middleware?")
- Code involving libraries ("Write a Prisma query for…")
- API references ("What are the Supabase auth methods?")
- User mentions specific frameworks (React, Vue, Svelte, Express, Tailwind, etc.)

## Bounded Retry (max 3x)

| Attempt | Action |
|---------|--------|
| 1 | `resolve-library-id` → pick best match |
| 2 | `query-docs` with selected `libraryId` |
| 3 | Retry `query-docs` once with refined query (narrower scope) |

After 3 failures, stop and print:

```
CONTEXT7_UNAVAILABLE
Reason: <quota|rate-limit|no-match|timeout>
Action: Ask user to retry later or paste the official docs URL (fetch it with `fetch_content` and cite the URL, not Context7).
Do NOT substitute training-data answers without labeling them UNVERIFIED.
```

## Fetch Cache (ETag-revalidated)

1. **Cache key:** `"<libraryId>:<normalized-query>"` (lowercase, trimmed). The helper normalizes the key itself, so pass the raw `libraryId:query` pair.
2. **Read:** `bash scripts/lib/doc-fetch-cache.sh get "<key>"` — exit 0 → use cached body (stdout). A stored ETag is echoed as `ETAG:<value>` on stderr.
3. **Miss / stale (exit 1):** call `query-docs`; store via `printf '%s' "<body>" | bash scripts/lib/doc-fetch-cache.sh put "<key>" "<etag-or-empty>" -`.
4. **TTL:** 300s default (`DOC_CACHE_TTL`). Stale entries refresh on next fetch; honor `ETag` when MCP returns it.
5. **Conditional refresh:** when an entry is stale, `bash scripts/lib/doc-fetch-cache.sh etag "<key>"` prints the previous ETag. If the fresh response carries the same ETag, `bash scripts/lib/doc-fetch-cache.sh touch "<key>"` keeps the body and restarts the TTL; otherwise `put` replaces the entry. Without an ETag from the MCP, store an empty ETag and rely on the TTL alone.
6. **Housekeeping:** `bash scripts/lib/doc-fetch-cache.sh purge` drops expired entries. The cache lives in the git-ignored `.omk/cache/docs` (override with `DOC_CACHE_DIR`).

## Process

1. `resolve-library-id` with `libraryName` + full user `query`.
2. Select match: name similarity, reputation, benchmark score; prefer version-specific IDs when user names a version.
3. `query-docs` with `libraryId` + specific question (one concept per call).
4. Answer using fetched docs; cite library/version when relevant.

## Verify

→ verify: `test -f scripts/lib/doc-fetch-cache.sh`
