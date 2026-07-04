# DevOps & Infrastructure (`devops-infra`)

> Inherited domain capability document. Auto-generated from `src/core/domain-loadouts.ts` — do not edit by hand.


## Identity

| field | value |
|---|---|
| id | `devops-infra` |
| authority | `write-scoped` |
| tools | read, grep, find, ls, edit, write, bash |
| command mode | `scoped-shell` |

## Routing prompt

> Prepended to the lane task prompt when the router selects this domain.

```text
DOMAIN: DevOps & Infrastructure. You are operating in a delivery/infra capability lane.
Prioritize reproducible, reversible, observable changes.

SEQUENCE:
1. Read the Dockerfile / compose / workflow / IaC in full before editing.
2. Containers: docker-patterns — pin base images, non-root user, multi-stage build, .dockerignore, healthchecks, least network egress.
3. CI/CD: deployment-patterns for staging->prod, rollback strategy, secret handling. GitHub Actions touching LLM/agent steps must pass agentic-actions-auditor (you are in security-adjacent territory).
4. Deploys: deploy-to-vercel / vercel-cli-with-tokens for Vercel; verification-loop after every deploy (health, smoke, rollback trigger).
5. Database ops: database-migrations (expand/contract, zero-downtime) — coordinate with backend-api lane if schema semantics are unclear.
6. Supply chain: npm-audit-summary hook surfaces dep risk; do not add lifecycle-script deps silently.

HARD RULES: every deploy is reversible within one command; never bake secrets into images; lockfile/manifest changes are reviewed code; prefer idempotent steps. Read-only infra inspection uses read-only-shell; mutations stay scoped-shell.
```

## Curated skills (12)

- `deployment-patterns`
- `docker-patterns`
- `database-migrations`
- `continuous-agent-loop`
- `enterprise-agent-ops`
- `plankton-code-quality`
- `verification-loop`
- `deploy-to-vercel`
- `vercel-cli-with-tokens`
- `e2e-testing`
- `clickhouse-io`
- `security-review`

## Curated MCP servers (3)

- `github`
- `filesystem`
- `powershell-admin`

## Curated hooks (4)

- `npm-audit-summary`
- `pre-shell-guard`
- `protect-secrets`
- `stop-verify`

## Routing triggers (21)

| kind | pattern | weight |
|---|---|---|
| keyword | `deploy` | 6 |
| keyword | `배포` | 6 |
| keyword | `deployment` | 6 |
| keyword | `docker` | 6 |
| keyword | `container` | 5 |
| keyword | `kubernetes` | 6 |
| keyword | `k8s` | 6 |
| keyword | `ci` | 3 |
| keyword | `pipeline` | 3 |
| keyword | `infrastructure` | 5 |
| keyword | `terraform` | 6 |
| keyword | `vercel` | 6 |
| keyword | `build` | 2 |
| keyword | `release` | 4 |
| keyword | `observability` | 5 |
| regex | `\b(github actions|workflow|runner|helm|istio|nginx)\b` | 5 |
| regex | `docker-?compose|\.ya?ml` | 3 |
| path | `Dockerfile` | 7 |
| path | `.github/workflows/` | 7 |
| path | `docker-compose` | 7 |
| extension | `.tf` | 7 |
