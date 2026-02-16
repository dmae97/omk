# MCP runtime lifecycle

This document describes how MCP servers are discovered, connected, exposed as tools, refreshed, and torn down in the coding-agent runtime.

## Lifecycle at a glance

1. **SDK startup** calls `discoverAndLoadMCPTools()` (unless MCP is disabled).
2. **Discovery** (`loadAllMCPConfigs`) resolves MCP server configs from capability sources, filters disabled/project/Exa entries, and preserves source metadata.
3. **Manager connect phase** (`MCPManager.connectServers`) starts per-server connect + `tools/list` in parallel.
4. **Fast startup gate** waits up to 250ms, then may return:
   - fully loaded `MCPTool`s,
   - failures per server,
   - or cached `DeferredMCPTool`s for still-pending servers.
5. **SDK wiring** merges MCP tools into runtime tool registry for the session.
6. **Live session** can refresh MCP tools via `/mcp` flows (`disconnectAll` + rediscover + `session.refreshMCPTools`).
7. **Teardown** happens when callers invoke `disconnectServer`/`disconnectAll`; manager also clears MCP tool registrations for disconnected servers.

## Discovery and load phase

### Entry path from SDK

`createAgentSession()` in `src/sdk.ts` performs MCP startup when `enableMCP` is true (default):

- calls `discoverAndLoadMCPTools(cwd, { ... })`,
- passes `authStorage`, cache storage, and `mcp.enableProjectConfig` setting,
- always sets `filterExa: true`,
- logs per-server load/connect errors,
- stores returned manager in `toolSession.mcpManager` and session result.

If `enableMCP` is false, MCP discovery is skipped entirely.

### Config discovery and filtering

`loadAllMCPConfigs()` (`src/mcp/config.ts`) loads canonical MCP server items through capability discovery, then converts to legacy `MCPServerConfig`.

Filtering behavior:

- `enableProjectConfig: false` removes project-level entries (`_source.level === "project"`).
- `enabled: false` servers are skipped before connect attempts.
- Exa servers are filtered out by default and API keys are extracted for native Exa tool integration.

Result includes both `configs` and `sources` (metadata used later for provider labeling).

### Discovery-level failure behavior

`discoverAndLoadMCPTools()` distinguishes two failure classes:

- **Discovery hard failure** (exception from `manager.discoverAndConnect`, typically from config discovery): returns an empty tool set and one synthetic error `{ path: ".mcp.json", error }`.
- **Per-server runtime/connect failure**: manager returns partial success with `errors` map; other servers continue.

So startup does not fail the whole agent session when individual MCP servers fail.

## Manager state model

`MCPManager` tracks runtime lifecycle with separate registries:

- `#connections: Map<string, MCPServerConnection>` — fully connected servers.
- `#pendingConnections: Map<string, Promise<MCPServerConnection>>` — handshake in progress.
- `#pendingToolLoads: Map<string, Promise<{ connection, serverTools }>>` — connected but tools still loading.
- `#tools: CustomTool[]` — current MCP tool view exposed to callers.
- `#sources: Map<string, SourceMeta>` — provider/source metadata even before connect completes.

`getConnectionStatus(name)` derives status from these maps:

- `connected` if in `#connections`,
- `connecting` if pending connect or pending tool load,
- `disconnected` otherwise.

## Connection establishment and startup timing

## Per-server connect pipeline

For each discovered server in `connectServers()`:

1. store/update source metadata,
2. skip if already connected/pending,
3. validate transport fields (`validateServerConfig`),
4. resolve auth/shell substitutions (`#resolveAuthConfig`),
5. call `connectToServer(name, resolvedConfig)`,
6. call `listTools(connection)`,
7. cache tool definitions (`MCPToolCache.set`) best-effort.

`connectToServer()` behavior (`src/mcp/client.ts`):

- creates stdio or HTTP/SSE transport,
- performs MCP `initialize` + `notifications/initialized`,
- uses timeout (`config.timeout` or 30s default),
- closes transport on init failure.

### Fast startup gate + deferred fallback

`connectServers()` waits on a race between:

- all connect/tool-load tasks settled, and
- `STARTUP_TIMEOUT_MS = 250`.

After 250ms:

- fulfilled tasks become live `MCPTool`s,
- rejected tasks produce per-server errors,
- still-pending tasks:
  - use cached tool definitions if available (`MCPToolCache.get`) to create `DeferredMCPTool`s,
  - otherwise block until those pending tasks settle.

This is a hybrid startup model: fast return when cache is available, correctness wait when cache is not.

### Background completion behavior

Each pending `toolsPromise` also has a background continuation that eventually:

- replaces that server’s tool slice in manager state via `#replaceServerTools`,
- writes cache,
- logs late failures only after startup (`allowBackgroundLogging`).

## Tool exposure and live-session availability

### Startup registration

`discoverAndLoadMCPTools()` converts manager tools into `LoadedCustomTool[]` and decorates paths (`mcp:<server> via <providerName>` when known).

`createAgentSession()` then pushes these tools into `customTools`, which are wrapped and added to the runtime tool registry with names like `mcp_<server>_<tool>`.

### Tool calls

- `MCPTool` calls tools through an already connected `MCPServerConnection`.
- `DeferredMCPTool` waits for `waitForConnection(server)` before calling; this allows cached tools to exist before connection is ready.

Both return structured tool output and convert transport/tool errors into `MCP error: ...` tool content (abort remains abort).

## Refresh/reload paths (startup vs live reload)

### Initial startup path

- one-time discovery/load in `sdk.ts`,
- tools are registered in initial session tool registry.

### Interactive reload path

`/mcp reload` path (`src/modes/controllers/mcp-command-controller.ts`) does:

1. `mcpManager.disconnectAll()`,
2. `mcpManager.discoverAndConnect()`,
3. `session.refreshMCPTools(mcpManager.getTools())`.

`session.refreshMCPTools()` (`src/session/agent-session.ts`) removes all `mcp_` tools, re-wraps latest MCP tools, and re-activates tool set so MCP changes apply without restarting session.

There is also a follow-up path for late connections: after waiting for a specific server, if status becomes `connected`, it re-runs `session.refreshMCPTools(...)` so newly available tools are rebound in-session.

## Health, reconnect, and partial failure behavior

Current runtime behavior is intentionally minimal:

- **No autonomous health monitor** in manager/client.
- **No automatic reconnect loop** when a transport drops.
- Manager does not subscribe to transport `onClose`/`onError`; status is registry-driven.
- Reconnect is explicit: reload flow or direct `connectServers()` invocation.

Operationally:

- one server failing does not remove tools from healthy servers,
- connect/list failures are isolated per server,
- tool cache and background updates are best-effort (warnings/errors logged, no hard stop).

## Teardown semantics

### Server-level teardown

`disconnectServer(name)`:

- removes pending entries/source metadata,
- closes transport if connected,
- removes that server’s `mcp_` tools from manager state.

### Global teardown

`disconnectAll()`:

- closes all active transports with `Promise.allSettled`,
- clears pending maps, sources, connections, and manager tool list.

In current wiring, explicit teardown is used in MCP command flows (for reload/remove/disable). There is no separate automatic manager disposal hook in the startup path itself; callers are responsible for invoking manager disconnect methods when they need deterministic MCP shutdown.

## Failure modes and guarantees

| Scenario | Behavior | Hard fail vs best-effort |
| --- | --- | --- |
| Discovery throws (capability/config load path) | Loader returns empty tools + synthetic `.mcp.json` error | Best-effort session startup |
| Invalid server config | Server skipped with validation error entry | Best-effort per server |
| Connect timeout/init failure | Server error recorded; others continue | Best-effort per server |
| `tools/list` still pending at startup with cache hit | Deferred tools returned immediately | Best-effort fast startup |
| `tools/list` still pending at startup without cache | Startup waits for pending to settle | Hard wait for correctness |
| Late background tool-load failure | Logged after startup gate | Best-effort logging |
| Runtime dropped transport | No automatic reconnect; future calls fail until reconnect/reload | Best-effort recovery via manual action |

## Public API surface

`src/mcp/index.ts` re-exports loader/manager/client APIs for external callers. `src/sdk.ts` exposes `discoverMCPServers()` as a convenience wrapper returning the same loader result shape.

## Implementation files

- [`src/mcp/loader.ts`](../src/mcp/loader.ts) — loader facade, discovery error normalization, `LoadedCustomTool` conversion.
- [`src/mcp/manager.ts`](../src/mcp/manager.ts) — lifecycle state registries, parallel connect/list flow, refresh/disconnect.
- [`src/mcp/client.ts`](../src/mcp/client.ts) — transport setup, initialize handshake, list/call/disconnect.
- [`src/mcp/index.ts`](../src/mcp/index.ts) — MCP module API exports.
- [`src/sdk.ts`](../src/sdk.ts) — startup wiring into session/tool registry.
- [`src/mcp/config.ts`](../src/mcp/config.ts) — config discovery/filtering/validation used by manager.
- [`src/mcp/tool-bridge.ts`](../src/mcp/tool-bridge.ts) — `MCPTool` and `DeferredMCPTool` runtime behavior.
- [`src/session/agent-session.ts`](../src/session/agent-session.ts) — `refreshMCPTools` live rebinding.
- [`src/modes/controllers/mcp-command-controller.ts`](../src/modes/controllers/mcp-command-controller.ts) — interactive reload/reconnect flows.
- [`src/task/executor.ts`](../src/task/executor.ts) — subagent MCP proxying via parent manager connections.
