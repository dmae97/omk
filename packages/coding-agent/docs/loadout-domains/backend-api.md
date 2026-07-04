# Backend & API (`backend-api`)

> Inherited domain capability document. Auto-generated from `src/core/domain-loadouts.ts` — do not edit by hand.


## Identity

| field | value |
|---|---|
| id | `backend-api` |
| authority | `write-scoped` |
| tools | read, grep, find, ls, edit, write, bash |
| command mode | `scoped-shell` |

## Routing prompt

> Prepended to the lane task prompt when the router selects this domain.

```text
DOMAIN: Backend & API. You are operating in a backend/API capability lane.
Prioritize correct data modeling, transactional integrity, and idiomatic framework patterns.

SEQUENCE:
1. Read the affected route/controller/service/repo and the schema in full first.
2. For data changes: prefer the database-migrations skill (additive + backfill + expand/contract); never destructive in a single step. Validate with the framework verification skill (django-verification / laravel-verification / springboot-verification).
3. Query work: apply postgres-patterns / supabase-postgres-best-practices (indexes, EXPLAIN, RLS). ClickHouse analytics use clickhouse-io.
4. API shape: api-design skill for resource naming, status codes, pagination, error envelopes, versioning.
5. Integrating LLMs: claude-api / codex-api skills for correct model ids, streaming, tool use, caching. Building an MCP server: mcp-server-patterns + mcp-build-mcp.
6. Language idiom: use the matching *-patterns skill (python/golang/rust/kotlin/perl/cpp). Type-strict, no `any`.
7. Security baseline: run security-review before claiming done; secrets never logged (protect-secrets hook enforces).

HARD RULES: parameterized queries only; migrations are reversible; no silent catch-and-swallow; new endpoints get the matching framework test (django-tdd / laravel-tdd / springboot-tdd).
```

## Curated skills (33)

- `backend-patterns`
- `api-design`
- `postgres-patterns`
- `supabase`
- `supabase-postgres-best-practices`
- `database-migrations`
- `clickhouse-io`
- `redis`
- `django-patterns`
- `django-tdd`
- `django-verification`
- `laravel-patterns`
- `laravel-tdd`
- `laravel-verification`
- `springboot-patterns`
- `springboot-tdd`
- `springboot-verification`
- `jpa-patterns`
- `python-patterns`
- `python-testing`
- `golang-patterns`
- `golang-testing`
- `kotlin-patterns`
- `rust-patterns`
- `java-coding-standards`
- `cpp-coding-standards`
- `perl-patterns`
- `mcp-server-patterns`
- `mcp-build-mcp`
- `claude-api`
- `codex-api`
- `security-review`
- `verification-loop`

## Curated MCP servers (5)

- `filesystem`
- `supabase`
- `github`
- `context7`
- `memory`

## Curated hooks (4)

- `pre-shell-guard`
- `protect-secrets`
- `typecheck-after-edit`
- `npm-audit-summary`

## Routing triggers (28)

| kind | pattern | weight |
|---|---|---|
| keyword | `backend` | 5 |
| keyword | `api` | 4 |
| keyword | `endpoint` | 4 |
| keyword | `database` | 5 |
| keyword | `query performance` | 5 |
| keyword | `query` | 3 |
| keyword | `migration` | 5 |
| keyword | `schema` | 4 |
| keyword | `server` | 3 |
| keyword | `auth` | 4 |
| keyword | `postgres` | 6 |
| keyword | `supabase` | 6 |
| keyword | `sql` | 5 |
| keyword | `rest` | 3 |
| keyword | `graphql` | 4 |
| keyword | `orm` | 4 |
| keyword | `django` | 6 |
| keyword | `spring` | 6 |
| keyword | `laravel` | 6 |
| regex | `\b(route|controller|service|repository|model|dto)\b` | 3 |
| extension | `.py` | 3 |
| extension | `.go` | 5 |
| extension | `.rs` | 5 |
| extension | `.java` | 5 |
| extension | `.kt` | 5 |
| path | `api/` | 4 |
| path | `server/` | 4 |
| path | `migrations/` | 6 |
