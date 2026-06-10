# Recon: OMK Slash-Command System (READ-ONLY)
Date: 2026-06-10
Scope: src/runtime/slash-commands.ts, src/runtime/command-bus.ts, src/cli/v2/chat-repl.ts, src/runtime/ui-components.ts, src/commands/mcp/*, src/runtime/reasoning-trace.ts, src/memory/local-graph-memory-store.ts, src/runtime/headroom-policy.ts, src/runtime/tool-plane.ts

---

## 1. Handler / Registration Contract

### SlashCommandResult (src/runtime/slash-commands.ts:12-19)
```ts
export interface SlashCommandResult {
  readonly kind: "status" | "mutation" | "error";
  readonly command: string;
  readonly payload: unknown;
  readonly renderMode: "theme" | "nlp" | "json";
  readonly sideEffects: readonly RuntimeSideEffect[];
}
```

### RuntimeSideEffect (src/runtime/slash-commands.ts:21-28)
```ts
export type RuntimeSideEffect =
  | { readonly type: "provider_changed"; readonly provider: string; readonly model: string }
  | { readonly type: "thinking_changed"; readonly thinking: string; readonly modelVariant: string }
  | { readonly type: "session_updated"; readonly sessionId: string }
  | { readonly type: "memory_written"; readonly memoryId: string }
  | { readonly type: "theme_changed"; readonly theme: string };
```

### SlashCommandInput (src/runtime/slash-commands.ts:30-41)
```ts
export interface SlashCommandInput {
  readonly command: string;
  readonly args: readonly string[];
  readonly rawText: string;
  readonly state: {
    readonly provider?: string;
    readonly model?: string;
    readonly sessionId?: string;
    readonly theme?: string;
    readonly thinking?: string;
    readonly activeProviderTab?: string;
  };
}
```

### SlashCommandHandler (src/runtime/slash-commands.ts:43-45)
```ts
export interface SlashCommandHandler {
  execute(input: SlashCommandInput): Promise<SlashCommandResult>;
}
```

### Registration & Dispatch (src/runtime/slash-commands.ts:262-287)
- A single `createSlashCommandHandler(state)` builds ONE `CommandHandler` that:
  1. Parses raw text via `parseSlashInput` → `{ command, args }`.
  2. Looks up `defaultHandlers[command]` (a `Record<string, SlashCommandHandler>`).
  3. If missing → returns `{ handled: false, events: [], output: "Unknown command..." }`.
  4. If found → calls `handler.execute(input)`, then wraps in `resultToCommandBusResult()` which JSON-stringifies `payload` and emits an `OmkEvent` of type `"result"`.
- `registerSlashCommands(bus, state)` registers the SAME handler instance under each command name:
  ```ts
  bus.registerHandler("model", handler);
  bus.registerHandler("think", handler);
  ...
  ```

### CommandBus dispatch (src/runtime/command-bus.ts:45-82)
```ts
if (isSlashCommand(text)) {
  const command = extractSlashCommand(text);
  const handler = handlers.get(command);
  if (handler) {
    const result = await handler(envelope);
    return { ...result, events: [...events, ...result.events] };
  }
  return { handled: false, events, output: "Unknown command..." };
}
```
- `registerHandler(command, handler)` does `handlers.set(command.toLowerCase(), handler)`.
- `listCommands()` returns `[...handlers.keys()]`.

---

## 2. How `/help` Enumerates Commands

`HelpCommandHandler` (src/runtime/slash-commands.ts:236-253) **hard-codes** the command list:
```ts
payload: {
  commands: [
    "/model [provider/model] - Show or set provider/model by provider group",
    "/think [next|medium|high|xhigh|max|variant <name>] - Cycle or set thinking variant",
    "/status - Show current runtime status",
    "/theme [name] - Show or set theme",
    "/help - Show this help",
  ],
}
```

It does **NOT** read from `bus.listCommands()`. To make a new command show up in `/help`, you must **manually add the description string to this array**.

---

## 3. Current Commands & Arg Parsing

| Command | Handler Class | Arg parsing |
|---------|---------------|-------------|
| `/model` | `ModelCommandHandler` | `input.args.join(" ").trim()` → parseProviderModelArg(raw). Uses string splitting on `/` and `:`. No sub-command dispatch. |
| `/think` / `/thinking` | `ThinkCommandHandler` | `input.args[0]?.toLowerCase()` for sub-command (`next`, `variant`, etc.). |
| `/status` | `StatusCommandHandler` | Ignores args. |
| `/theme` | `ThemeCommandHandler` | `input.args[0]` if present sets theme; absent shows current + hard-coded available list. |
| `/help` | `HelpCommandHandler` | Ignores args. |

### stringValue helper (src/runtime/slash-commands.ts:70-73)
```ts
function stringValue(payload: Record<string, unknown>, key: string, fallback = "unknown"): string {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}
```
Used inside `renderSlashResultContent` to safely extract string fields from payload for theme rendering.

---

## 4. Data Sources for New Commands

### `/mcp` — MCP Server List + Health
- **MCP list command** → `src/commands/mcp/list.ts:18` (`mcpListCommand()`) returns void (prints to console). The *logic* is reusable: `resolveAllConfigs()`, `collectServers()`, `selectEffectiveServer()` from `src/commands/mcp/shared.js`.
- **MCP doctor** → `src/commands/mcp/doctor.ts:71-320` (`buildMcpDoctorReport()`) returns `McpDoctorReport` with `servers: McpDoctorServerReport[]` containing `status`, `active`, `checks`, `toolCount`.
- **mcpHealthCard UI** → `src/runtime/ui-components.ts:168-193` renders `McpHealthCardData { servers: McpServerHealth[], totalTools? }`.
- **Tool plane manifest** → `src/runtime/tool-plane.ts:17-45` (`buildOmkToolPlaneManifest`) returns `mcpServers: readonly string[]` + diagnostics.

**Feasibility: HIGH.** `buildMcpDoctorReport()` is async and returns structured data; can be called inside a slash handler and the `servers[]` array fed directly into `mcpHealthCard()`.

---

### `/memory` — Graph Memory Read
- **Local graph memory store** → `src/memory/local-graph-memory-store.ts:318-497`
  - `async read(path: string): Promise<string>` (line ~358)
  - `async search(query: string, limit = 10): Promise<MemorySearchResult[]>` (line ~497)
  - `async query(graphQL: string): Promise<GraphQueryResult>` (line ~813)
  - `async mindmap(query: string, limit = 80): Promise<MemoryMindmap>` (line ~852 area)
- **memoryCard UI** → `src/runtime/ui-components.ts:136-155` renders `MemoryCardData { projectId?, decisions?, todos?, facts?, lastUpdated? }`.
- **MCP project server** exposes `omk_read_memory`, `omk_write_memory`, `omk_graph_query`, `omk_memory_mindmap` (src/mcp/omk-project-server.ts:1618).

**Feasibility: HIGH.** The store is a plain class; instantiate or import `loadMemorySettings` + `LocalGraphMemoryStore` and call `.search()` or `.query()`.

---

### `/trace` — Reasoning Trace Summary
- **Trace store** → `src/runtime/reasoning-trace.ts:261-315` (`createReasoningTraceStore`)
  - `.list(limit = 100)` → `readonly ReasoningTrace[]`
  - `.load(traceId)` → single trace
- **summarizeTrace** → `src/runtime/reasoning-trace.ts:173-197` converts `ReasoningTrace → TraceSummary`
- **UI components** → `src/runtime/ui-components.ts:199-221`
  - `traceSummaryCard(p, trace)` — full card
  - `traceSummaryCompact(p, summary)` — one-liner

**Feasibility: HIGH.** The store is file-based under `.omk/traces`. Call `store.list(1)` for latest, then `summarizeTrace()` + `traceSummaryCard()`.

---

### `/lanes` / `/workers` — Parallel Orchestration Status
- **Orchestrator trace** → `src/evidence/run-trace.ts:24-35` (`NodeTraceSummary`)
- **Native root loop** → `src/commands/chat/native-root-loop.ts` carries `mcpAllowlist`, `mcpServers`, worker routing.
- **No centralized “lane status” API** exists. Worker state is ephemeral inside `native-root-loop.ts` and `orchestrate-prompt.ts`.

**Feasibility: LOW.** No single data source; would require plumbing orchestrator state into a shared store first.

---

### `/headroom` — Headroom Status
- **Headroom policy** → `src/runtime/headroom-policy.ts`
  - `evaluateHeadroom({ usedTokens, contextWindow })` → `HeadroomDecision` (line 89-111)
  - `isHeadroomEnabled(env)` / `resolveHeadroomThreshold(env)` read `OMK_HEADROOM` and `OMK_HEADROOM_THRESHOLD`.
- **ContextBroker** → `src/runtime/context-broker.ts:380-391` builds `headroomDecision` into the context capsule.
- **No dedicated UI card** yet, but `statusCard` (ui-components.ts:44-68) can display generic `mcpCount`, `skillCount`, `durationMs`.

**Feasibility: MEDIUM-HIGH.** Need to surface token usage (from ContextCapsule or runtime sidecar) and call `evaluateHeadroom()`. No pre-built card, but easy to construct text payload.

---

### `/tools` — Tool Registry
- **Tool registry contract** → `src/runtime/tool-registry-contract.ts` (types only; no runtime registry singleton found in read scope)
- **Tool plane manifest** → `src/runtime/tool-plane.ts:17-45` returns `tools: readonly string[]` and `toolContracts: readonly OmkToolPrefixSpec[]`.
- **No “list all tools” API** exposed beyond the tool-plane manifest strings.

**Feasibility: MEDIUM.** Need to resolve the actual `OmkToolDefinition[]` registry at runtime. If the registry map is available in the runtime sidecar, it's easy; otherwise requires plumbing.

---

### `/provider` — Provider Status
- **Model registry** → `src/providers/model-registry.ts` (`readProviderRegistry`, `normalizeProviderId`)
- **Provider card UI** → `src/runtime/ui-components.ts:97-116` (`providerCard`) renders `ProviderCardData { provider, model, runtimeMode?, apiBase?, connected? }`.
- **Current state** already in `SlashCommandInput.state.provider / .model`.

**Feasibility: HIGH.** Re-use `readProviderRegistry()` + `providerCard()`; state already present.

---

## 5. Minimal Step-by-Step to ADD a New Slash Command

1. **Implement handler class** in `src/runtime/slash-commands.ts` (or a new file):
   ```ts
   class McpCommandHandler implements SlashCommandHandler {
     async execute(input: SlashCommandInput): Promise<SlashCommandResult> {
       // fetch data
       return {
         kind: "status",
         command: "mcp.show",
         payload: { /* your data */ },
         renderMode: "theme",
         sideEffects: [],
       };
     }
   }
   ```

2. **Add to `defaultHandlers` map** (slash-commands.ts ~255):
   ```ts
   const defaultHandlers: Record<string, SlashCommandHandler> = {
     ...,
     mcp: new McpCommandHandler(),
   };
   ```

3. **Register with CommandBus** in `registerSlashCommands()` (slash-commands.ts ~278):
   ```ts
   bus.registerHandler("mcp", handler);
   ```

4. **Add help text** in `HelpCommandHandler.execute()` (slash-commands.ts ~248):
   ```ts
   "/mcp - Show MCP server health",
   ```

5. **Add render branch** in `renderSlashResultContent()` (slash-commands.ts ~130) if using `"theme"` renderMode and custom payload shape:
   ```ts
   case "mcp.show": {
     const servers = payload.servers as McpServerHealth[];
     return mcpHealthCard(undefined, { servers });
   }
   ```

6. **(Optional) Handle side effects** in `applyChatReplSlashResultToState()` (chat-repl.ts ~65) if the command mutates REPL state.

7. **Run quality gate**:
   ```bash
   npm run check
   npm run build:clean
   ```

---

## 6. Ranked High-Value New Commands

| Rank | Command | Data Source | Feasibility | Notes |
|------|---------|-------------|-------------|-------|
| 1 | `/mcp` | `src/commands/mcp/doctor.ts:71` (`buildMcpDoctorReport`) | **HIGH** | Structured report already exists; `mcpHealthCard` UI ready. Just wire async call. |
| 2 | `/provider` | `src/providers/model-registry.ts` + `src/runtime/ui-components.ts:97` | **HIGH** | State already in `SlashCommandInput.state`; `providerCard` ready. Trivial. |
| 3 | `/memory` | `src/memory/local-graph-memory-store.ts:358` (`.read/.search/.query`) | **HIGH** | Store is a plain class; instantiate and query. `memoryCard` UI ready. |
| 4 | `/trace` | `src/runtime/reasoning-trace.ts:261` (`createReasoningTraceStore`) | **HIGH** | File-based store under `.omk/traces`; call `.list(1)` for latest. Cards ready. |
| 5 | `/headroom` | `src/runtime/headroom-policy.ts:89` (`evaluateHeadroom`) | **MEDIUM-HIGH** | Needs `usedTokens` + `contextWindow` from runtime sidecar/ContextCapsule. No dedicated card yet, but easy text payload. |
| 6 | `/tools` | `src/runtime/tool-plane.ts:17` (`buildOmkToolPlaneManifest`) | **MEDIUM** | Manifest has `tools: string[]` but no full `OmkToolDefinition[]` runtime registry surfaced in read scope. May need plumbing. |
| 7 | `/lanes` | `src/commands/chat/native-root-loop.ts` (worker state) | **LOW** | No centralized lane-status store; ephemeral in orchestrator loops. Requires new instrumentation. |
