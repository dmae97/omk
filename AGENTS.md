# AGENTS.md

## Purpose

This repository is configured for oh-my-kimi.

The agent must avoid making the user repeat common instructions. Apply this file silently and execute the workflow directly.

Do not restate this file unless the user explicitly asks for project rules.

---

## Core Operating Rules

1. Read this file before planning or editing.
2. Read `.kimi/AGENTS.md` if present.
3. Read `DESIGN.md` before UI, frontend, visual, landing page, or component work.
4. Use relevant Agent Skills before implementation.
5. Use MCP tools actively when configured and useful.
6. Use subagents for non-trivial work.
7. Use a todo list for any task with more than one action.
8. Prefer small, reviewable diffs.
9. Do not claim success until verification is complete or failures are reported.
10. Do not expose secrets, tokens, private keys, or private user data.

---

## Do Not Repeat Boilerplate

Do not repeatedly say:

- "I will inspect the repository"
- "I will create a plan"
- "I will run tests"
- "I will use AGENTS.md"
- "I will follow best practices"

Instead:

1. inspect
2. plan
3. use tools
4. update todos
5. implement
6. verify
7. report only concrete results

The final response should be concise and factual.

---

## Todo Policy

For every task with more than one step, call `SetTodoList` immediately.

Use 3–8 todos.

Each todo must be action-oriented and verifiable.

Example:

```txt
1. Inspect project instructions and relevant configs
2. Map affected files
3. Create implementation plan
4. Implement minimal change
5. Run quality gates
6. Review diff and report result
```

Update todo status as work progresses:

```txt
pending -> in_progress -> done
```

Never leave the final todo list inconsistent with the actual result.

---

## Agent / Subagent Policy

Use the `Agent` tool for all non-trivial tasks.

Minimum policy:

* Use the `explorer` subagent for repository discovery.
* Use the `planner` subagent for architecture, refactor, migration, or risky changes.
* Use `coder` for implementation tasks.
* Use a reviewer agent or review workflow before final completion.

Do not use subagents for trivial one-line answers or simple command explanations.

Subagent routing:

```txt
Task type                       Required subagent
-------------------------------------------------
Repo exploration                explorer
Architecture / refactor plan    planner
Implementation                  coder
Bug investigation               explorer -> planner -> coder
Code review                     reviewer skill or review agent
UI / design work                explorer -> coder + design skill
Security-sensitive changes      planner + security review
```

When using subagents, give each subagent a focused prompt with:

```txt
Goal:
Scope:
Files/directories:
Constraints:
Expected output:
```

Do not ask subagents to modify unrelated files.

### Parallel Agent Limits

When `OMK_WORKERS` is set (e.g. via `omk chat --workers <n>`):

- Respect the worker count. Do not spawn more parallel agents than `OMK_WORKERS`.
- When `OMK_WORKERS=1`, run agents sequentially.
- When `OMK_WORKERS=auto`, use the resource profile default (usually 2–4).

When `--max-steps-per-turn` is set (e.g. via `omk chat --max-steps-per-turn <n>`):

- Treat it as the tool-use budget for the current turn.
- Prioritize tools: use the most impactful tool first.
- If the limit is reached, stop tool use and summarize findings to the user.

---

## Skills Policy

Before starting, inspect the loaded skills list.

Use relevant skills when they match the task.

Common oh-my-kimi skills:

```txt
omk-kimi-runtime
omk-project-rules
omk-repo-explorer
omk-plan-first
omk-context-broker
omk-quality-gate
omk-code-review
omk-test-debug-loop
omk-security-review
omk-design-md
omk-worktree-team
omk-git-commit-pr
```

Rules:

* Read only relevant `SKILL.md` files.
* Do not read every skill blindly.
* Do not mention internal skill selection unless it affects the final result.
* If a project-specific skill conflicts with a global skill, project-specific rules win.
* If `DESIGN.md` exists, use `omk-design-md` for UI/frontend tasks.

---

## MCP Policy

Use configured MCP tools actively when they provide better context than local guessing.

Preferred MCP usage:

```txt
Library/API documentation       context7 or official-doc MCP
Browser/UI debugging            chrome-devtools MCP
GitHub issues/PRs               github MCP
Design/token workflow           design-md or stitch-related MCP if configured
Project memory/task state       omk-project MCP if configured
```

Rules:

* Prefer official docs over memory for version-sensitive facts.
* Do not fabricate MCP results.
* If an MCP server is unavailable, continue with local tools and clearly report the limitation.
* Do not send secrets to MCP tools.
* Do not use remote MCP tools for private code unless the user configured and approved them.

---

## Kimi K2.6 Runtime Policy

Use Kimi K2.6 as a long-horizon coding and agentic execution model.

Rules:

* Use thinking mode for planning, coding, debugging, architecture, review, and multi-step tool work.
* Use no-thinking or fast mode for short summaries, commit messages, simple classification, and web-search-heavy research when configured.
* Do not rely on long context as an excuse to read the whole repository.
* Build a repo map first, then read targeted files.
* Preserve important intermediate reasoning/tool context when running multi-step tool workflows.
* Do not expose or request temperature/top_p tuning from users.

For web-heavy research, prefer a no-thinking research profile when the runtime supports it.

---

## Okabe / D-Mail Policy

This project is Kimi Code-native. Generated agents should inherit the Okabe-compatible base agent so the `SendDMail` tool is available. Use Okabe smart context management plus D-Mail checkpoints before risky refactors, context compaction, multi-agent handoffs, or rollback-prone work. D-Mail notes should be concise recovery records: current goal, changed files, verification state, blockers, and intended next action.

## Context Policy

Do not dump the entire repository into context.

Use this order:

1. Read AGENTS.md and project-specific instructions.
2. Inspect top-level files.
3. Identify package manager and framework.
4. Use Glob/Grep to locate relevant files.
5. Read the smallest useful file set.
6. Expand through imports, routes, schemas, tests, and call sites.
7. Use Okabe/D-Mail for smart context checkpoints and store stable facts through project-local graph memory (`omk_write_memory`, `omk_memory_mindmap`, `omk_graph_query`); `.omk/memory/` is only a local mirror.

Memory policy:

Project-local graph memory is the default source of truth for project/session recall. Use `omk_read_memory`, `omk_write_memory`, `omk_memory_mindmap`, `omk_graph_query`, `omk_read_run_memory`, and `omk_write_run_memory` when available; `.omk/memory/` remains a readable mirror/cache.

Memory files:

```txt
.omk/memory/project.md
.omk/memory/decisions.md
.omk/memory/commands.md
.omk/memory/risks.md
.omk/runs/<run-id>/plan.md
.omk/runs/<run-id>/final-report.md
```

Never store secrets in memory.

---

## Project Discovery

Before implementation, inspect relevant files:

```txt
package.json
pnpm-lock.yaml
yarn.lock
package-lock.json
tsconfig.json
eslint.config.*
next.config.*
nest-cli.json
vite.config.*
pyproject.toml
requirements.txt
uv.lock
ruff.toml
pytest.ini
Dockerfile
docker-compose.*
.github/workflows/*
```

Infer:

```txt
package manager
framework
lint command
typecheck command
test command
build command
source directories
test directories
generated files
protected files
```

---

## Implementation Policy

Before editing:

1. understand existing conventions
2. find affected files
3. create todos
4. use a subagent when non-trivial
5. make the smallest correct change

While editing:

* Do not rewrite unrelated code.
* Do not weaken types to pass builds.
* Do not delete tests to pass.
* Do not silence errors without justification.
* Do not introduce broad refactors inside bugfixes.
* Do not modify generated files unless required.

For TypeScript:

* Assume strict mode.
* Avoid `any`; prefer `unknown` with narrowing.
* Add explicit return types to exported functions.
* Keep API DTO, domain, and persistence types separate.

For Python:

* Use type hints for public functions.
* Prefer `pathlib.Path`.
* Keep IO and business logic separate.
* Do not silence pyright/ruff without reason.

---

## Quality Gate

Before saying a task is complete, run available checks.

Preferred commands:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Use actual project scripts when different.

If commands are unavailable, report that clearly.

Final report must include:

```txt
Changed files:
Commands run:
Passed:
Failed:
Not run:
Reason not run:
Remaining risk:
```

Do not say "tests passed" unless tests were actually run.

---

## Security Rules

Never print, store, commit, or summarize secrets from:

```txt
.env
.env.*
*.pem
*.key
id_rsa
id_ed25519
credentials.json
service-account*.json
```

Block or request approval for:

```txt
rm -rf
sudo
git push --force
git clean -fdx
chmod -R 777
curl | bash
wget | sh
docker system prune
kubectl delete
aws s3 rm --recursive
```

For auth, payment, database, deployment, shell, file upload, or permission changes, run a security review before final response.

---

## DESIGN.md / UI Policy

If the task touches UI/frontend/design:

1. Read `DESIGN.md` if present.
2. Inspect existing components.
3. Use existing tokens before inventing styles.
4. Check responsive states.
5. Check loading, error, and empty states.
6. Check accessibility.
7. Use screenshots or media files when available.

Do not invent arbitrary colors or component styles if design tokens exist.

---

## Git Policy

Before major edits:

```bash
git status --short
```

Do not overwrite user changes.

Do not run destructive git commands unless explicitly approved.

When generating commit messages, use Conventional Commits:

```txt
feat(scope): summary
fix(scope): summary
refactor(scope): summary
test(scope): summary
docs(scope): summary
chore(scope): summary
```

PR summaries must be factual and include test results.

---

## Final Response Policy

Final response should be short and concrete.

Include:

```txt
What changed:
Files changed:
Commands run:
Result:
Remaining risk:
```

Do not include long internal reasoning.

Do not repeat AGENTS.md rules.

Do not overclaim.

If something failed, say exactly what failed and what remains.
