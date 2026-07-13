# Runtime routing

## Decision tree

1. **Can a deterministic local API, CLI, file edit, Playwright, or Chrome DevTools perform the task?**
   - Yes: use it. UI automation is the fallback, not the default.
   - No: continue.
2. **Is the target a host-native desktop application?**
   - Yes: use Cua Driver after `health_report` succeeds.
3. **Is OMK running in WSL while the target is Windows UI?**
   - Prefer running the OMK/MCP client on Windows or another validated Windows-side bridge.
   - Use Windows `cua-driver.exe mcp` through WSL interop only with explicit experimental acceptance and an end-to-end smoke test.
   - Never use the Linux Cua Driver build to control Windows UI.
4. **Is the target a browser?**
   - Known selectors/flow: use deterministic browser tooling.
   - Unknown element: Stagehand `observe`, inspect candidates, then `act` on the selected candidate.
   - Structured data: Stagehand `extract` with a strict schema and source validation.
   - Multi-step unknown flow: use bounded `agent.execute` only after the above routes are insufficient.
5. **Is a disposable OS or benchmark environment required?**
   - Route to CUA sandbox/benchmark facilities only after selecting the exact runtime and permissions. Do not conflate these with host `cua-driver`.

## Topology

OMK owns planning and verification:

```text
OMK root planner
├── deterministic local/browser tools
├── Cua Driver host runtime
├── Stagehand core or thin sidecar
└── Browserbase cloud MCP
```

Do not nest a general-purpose orchestrator below OMK. A runtime may have an internal bounded action loop, but its scope must be one lane with a concrete stop predicate.

## Session ownership

- Assign one lane as the writer for each mutable app or browser session.
- Use separate Cua Driver MCP connections or separate browser sessions for genuinely independent concurrent work.
- Assume one stdio MCP connection serializes calls.
- Record session/window/page identifiers without recording authentication data.

## Fallback order

1. deterministic API/file/CLI
2. accessibility tree or DOM selector
3. observed action candidate
4. window/page-local pixel coordinate
5. bounded runtime agent loop
6. human review

Stop instead of escalating when the next step needs new credentials, permissions, installation, a destructive action, or an unapproved external side effect.
