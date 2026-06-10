# Slash Commands Implementation — 2026-06-10

## Commands Added

All commands are read-only (`kind: "status"`), registered in `src/runtime/slash-commands.ts`, and rendered in theme mode.

| Command | Handler Class | Data Source | Render Branch |
|---------|---------------|-------------|---------------|
| `/mcp` | `McpCommandHandler` | `src/commands/mcp/doctor.ts` (`buildMcpDoctorReport`) | `mcp.show` |
| `/provider` | `ProviderCommandHandler` | `src/providers/model-registry.ts` (`providerDoctorStatus`, `readProviderRegistry`) | `provider.show` |
| `/headroom` | `HeadroomCommandHandler` | `src/runtime/headroom-policy.ts` (`evaluateHeadroom`, `isHeadroomEnabled`) | `headroom.show` |
| `/tools` | `ToolsCommandHandler` | `src/runtime/tool-plane.ts` (`buildOmkToolPlaneManifest`) + `getOmkResourceSettings`/`getActiveRuntimePreset` | `tools.show` |
| `/memory [query]` | `MemoryCommandHandler` | `src/memory/local-graph-memory-store.ts` (`LocalGraphMemoryStore`) | `memory.show` |
| `/trace [limit]` | `TraceCommandHandler` | `src/runtime/reasoning-trace.ts` (`createReasoningTraceStore`, `summarizeTrace`, `redactTrace`) | `trace.show` |

## Registration

- Added to `defaultHandlers` map.
- Added `bus.registerHandler(...)` calls in `registerSlashCommands()`.
- Added one-line descriptions to `HelpCommandHandler` payload so `/help` lists them.

## Help Excerpt

```
OMK Slash Commands
  - /model [provider/model] - Show or set provider/model by provider group
  - /think [next|medium|high|xhigh|max|variant <name>] - Cycle or set thinking variant
  - /status - Show current runtime status
  - /theme [name] - Show or set theme
  - /mcp - Show MCP server health
  - /provider - Show current provider, model, and fallback status
  - /headroom - Show context headroom status
  - /tools - Show tool plane manifest
  - /memory [query] - Show memory summary or search top-N
  - /trace - Show latest reasoning trace summaries
  - /help - Show this help
```

## Sample Rendered Output

### `/mcp`

```
  MCP servers (14 configured, scope: project)
  ○ filesystem-readonly  ok
  ○ omk-web-bridge  ok
  ○ firebase-gamedev  ok
  ○ firebase-eggup  ok
  ○ lean-ctx  ok
  ○ filesystem  ok
  ○ memory  ok
  ○ context7  ok
  ○ playwright  ok
  ○ github  ok
  ○ firecrawl  ok
  ○ fetch  ok
  ○ obsidian  ok
  ● omk-project  ok
```

### `/provider`

```
  Provider: kimi/default
  Available: false  Auth: false
  Fallbacks:
    deepseek  available=true auth=true
    codex  available=true auth=false
    openrouter  available=true auth=true
    __providerDefaults  available=true auth=false
    local-qwen3-coder-main  available=true auth=true
    local-qwen3-coder-reviewer  available=true auth=true
    local-qwen3-coder-tool  available=true auth=true
    mimo  available=false auth=false
```

### `/headroom`

```
  Headroom: enabled  usage=0.0%  threshold=90.0%  compact=false
```

### `/tools`

```
  Tools: 9 total
  MCP servers: 1  [omk-project]
  Skills: 5  [omk-repo-explorer, omk-context-broker, omk-plan-first, omk-quality-gate, omk-secret-guard]
  Hooks: 3  [pre-shell-guard.sh, protect-secrets.sh, stop-verify.sh]
  Tools: 0
```

### `/memory`

```
  Memory: local_graph  nodes=37633  edges=73220  updated=2026-06-10T05:19:00.231Z
```

### `/memory project`

```
  Memory: local_graph  nodes=37633  edges=73220  updated=2026-06-10T05:19:00.231Z
  Query: "project"
    - project  2026-06-10T05:18:59.007Z
    - daily/2026-06-10/init-checklist.md  2026-06-10T04:34:18.096Z
    - daily/2026-06-10/critical-issues.md  2026-06-10T04:34:15.469Z
    - daily/2026-06-09/init-checklist.md  2026-06-09T09:59:06.583Z
    - daily/2026-06-09/critical-issues.md  2026-06-09T09:59:05.802Z
```

### `/trace`

```
  Reasoning traces (latest 1):
  ✖ status → Rendered [1s]
```

## Test Results

```
$ node --test test/slash-commands-status.test.mjs
# tests 9
# pass 9
# fail 0
```

Covered per command:
- dispatchable via the CommandBus
- returns a `"status"` result
- appears in `/help` output
- renders content without throwing

## Quality Gate

```
$ npx tsc --noEmit | grep 'error TS'
(no output)

$ npx eslint src/runtime/slash-commands.ts
(no output)

$ npm run secret:scan | tail -1
Secret scan passed: no high-confidence secrets or maintainer-private paths found.
```

## Files Changed

- `src/runtime/slash-commands.ts` — added six handlers, registered commands, updated `/help`, added render branches.
- `test/slash-commands-status.test.mjs` — new regression tests for the six commands.
