# QA & Testing (`qa-testing`)

> Inherited domain capability document. Auto-generated from `src/core/domain-loadouts.ts` — do not edit by hand.


## Identity

| field | value |
|---|---|
| id | `qa-testing` |
| authority | `execute-tests` |
| tools | read, grep, find, ls, bash |
| command mode | `tests-only` |

## Routing prompt

> Prepended to the lane task prompt when the router selects this domain.

```text
DOMAIN: QA & Testing. You are operating in an execute-tests lane.
Prioritize real evidence (green runs, captured output) over claims.

SEQUENCE:
1. Reproduce first: never fix a test you have not seen fail. Capture the exact failure output.
2. New behavior: test-driven-development / tdd-workflow (red->green->refactor). tdd-write-tests for coverage of uncommitted changes; tdd-fix-tests to make the suite green after a change.
3. Web QA: browser-qa / webapp-testing with playwright + chrome-devtools MCP (navigate, interact, screenshot, assert). e2e-testing for Page Object Model + CI wiring + flake strategy.
4. React: react-doctor (lint/a11y/bundle/arch + regression check) before declaring healthy.
5. Regression safety: ai-regression-testing for sandbox-mode API tests without DB deps; verification-before-completion requires a passing command before any "done" claim.
6. Flakiness: quarantine or fix, never disable silently; record the root cause.

HARD RULES: tests-only command mode (no arbitrary shell); every fix is re-verified by a green run; coverage gaps are reported, not hidden; flaky tests are rooted, not retried blindly.
```

## Curated skills (16)

- `ai-regression-testing`
- `e2e-testing`
- `tdd-workflow`
- `test-driven-development`
- `tdd-fix-tests`
- `tdd-write-tests`
- `react-doctor`
- `web-quality-audit`
- `audit-and-fix`
- `browser-qa`
- `webapp-testing`
- `verification-before-completion`
- `verification-loop`
- `playwright-cli`
- `gstack-qa`
- `gstack-qa-only`

## Curated MCP servers (3)

- `playwright`
- `chrome-devtools`
- `filesystem`

## Curated hooks (3)

- `stop-verify`
- `pre-shell-guard`
- `protect-secrets`

## Routing triggers (19)

| kind | pattern | weight |
|---|---|---|
| keyword | `test` | 4 |
| keyword | `testing` | 5 |
| keyword | `qa` | 6 |
| keyword | `bug` | 4 |
| keyword | `regression` | 6 |
| keyword | `e2e` | 7 |
| keyword | `playwright` | 7 |
| keyword | `vitest` | 6 |
| keyword | `jest` | 5 |
| keyword | `pytest` | 6 |
| keyword | `coverage` | 5 |
| keyword | `fix test` | 5 |
| keyword | `failing` | 4 |
| keyword | `flaky` | 6 |
| regex | `\b(unit test|integration test|snapshot|mock|fixture)\b` | 5 |
| path | `test/` | 5 |
| path | `tests/` | 5 |
| path | `.test.` | 5 |
| path | `.spec.` | 5 |
