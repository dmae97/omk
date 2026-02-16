# MCP Protocol and Transport Internals

This document describes how coding-agent implements MCP JSON-RPC messaging and how protocol concerns are split from transport concerns.

## Scope

Covers:

- JSON-RPC request/response and notification flow
- Request correlation and lifecycle for stdio and HTTP/SSE transports
- Timeout and cancellation behavior
- Error propagation and malformed payload handling
- Transport selection boundaries (`stdio` vs `http`/`sse`)
- Which reconnect/retry responsibilities are transport-level vs manager-level

Does not cover extension authoring UX or command UI.

## Implementation files

- [`src/mcp/types.ts`](../src/mcp/types.ts)
- [`src/mcp/transports/stdio.ts`](../src/mcp/transports/stdio.ts)
- [`src/mcp/transports/http.ts`](../src/mcp/transports/http.ts)
- [`src/mcp/transports/index.ts`](../src/mcp/transports/index.ts)
- [`src/mcp/json-rpc.ts`](../src/mcp/json-rpc.ts)
- [`src/mcp/client.ts`](../src/mcp/client.ts)
- [`src/mcp/manager.ts`](../src/mcp/manager.ts)

## Layer boundaries

### Protocol layer (JSON-RPC + MCP methods)

- Message shapes are defined in `types.ts` (`JsonRpcRequest`, `JsonRpcNotification`, `JsonRpcResponse`, `JsonRpcMessage`).
- MCP client logic (`client.ts`) decides method order and session handshake:
  1. `initialize` request
  2. `notifications/initialized` notification
  3. method calls like `tools/list`, `tools/call`

### Transport layer (`MCPTransport`)

`MCPTransport` abstracts delivery and lifecycle:

- `request(method, params, options?) -> Promise<T>`
- `notify(method, params?) -> Promise<void>`
- `close()`
- `connected`
- optional callbacks: `onClose`, `onError`, `onNotification`

Transport implementations own framing and I/O details:

- `StdioTransport`: newline-delimited JSON over subprocess stdio
- `HttpTransport`: JSON-RPC over HTTP POST, with optional SSE responses/listening

### Important current caveat

Transport callbacks (`onClose`, `onError`, `onNotification`) are implemented, but current `MCPClient`/`MCPManager` flows do not wire reconnection logic to these callbacks. Notifications are only consumed if caller registers handlers.

## Transport selection

`client.ts:createTransport()` chooses transport from config:

- `type` omitted or `"stdio"` -> `createStdioTransport`
- `"http"` or `"sse"` -> `createHttpTransport`

`"sse"` is treated as an HTTP transport variant (same class), not a separate transport implementation.

## JSON-RPC message flow and correlation

## Request IDs

Each transport generates per-request IDs (`Math.random` + timestamp string). IDs are transport-local correlation tokens.

## Stdio correlation path

- Outbound request is serialized as one JSON object + `\n`.
- `#pendingRequests: Map<id, {resolve,reject}>` stores in-flight requests.
- Read loop parses JSONL from stdout and calls `#handleMessage`.
- If inbound message has matching `id`, request resolves/rejects.
- If inbound message has `method` and no `id`, treated as notification and sent to `onNotification`.

Unknown IDs are ignored (no rejection, no error callback).

## HTTP correlation path

- Outbound request is HTTP `POST` with JSON body and generated `id`.
- Non-SSE response path: parse one JSON-RPC response and return `result`/throw on `error`.
- SSE response path (`Content-Type: text/event-stream`): stream events, return first message whose `id` matches expected request ID and has `result` or `error`.
- SSE messages with `method` and no `id` are treated as notifications.

If SSE stream ends before matching response, request fails with `No response received for request ID ...`.

## Notifications

Client emits JSON-RPC notifications via `transport.notify(...)`.

- Stdio: writes notification frame to stdin (`jsonrpc`, `method`, optional `params`) plus newline.
- HTTP: sends POST body without `id`; success accepts `2xx` or `202 Accepted`.

Server-initiated notifications are only surfaced through transport `onNotification`; there is no default global subscriber in manager/client.

## Stdio transport internals

## Lifecycle and state transitions

- Initial: `connected=false`, `process=null`, pending map empty
- `connect()`:
  - spawn subprocess with configured command/args/env/cwd
  - mark connected
  - start stdout read loop (`readJsonl`)
  - start stderr loop (read/discard; currently silent)
- `close()`:
  - mark disconnected
  - reject all pending requests (`Transport closed`)
  - kill subprocess
  - await read loop shutdown
  - emit `onClose`

If read loop exits unexpectedly, `finally` triggers `#handleClose()` which performs the same pending-request rejection and close callback.

## Timeout and cancellation

Per request:

- timeout defaults to `config.timeout ?? 30000`
- optional `AbortSignal` from caller
- abort and timeout both reject the pending promise and clean map entry

Cancellation is local only: transport does not send protocol-level cancellation notification to the server.

## Malformed payload handling

In read loop:

- each parsed JSONL line is passed to `#handleMessage` in `try/catch`
- malformed/invalid message handling exceptions are dropped (`Skip malformed lines` comment)
- loop continues, so one bad message does not kill the connection

If the underlying stream parser throws, `onError` is invoked (when still connected), then connection closes.

## Disconnect/failure behavior

When process exits or stream closes:

- all in-flight requests are rejected with `Transport closed`
- no automatic restart or reconnect
- higher layers must reconnect by creating a new transport

## Backpressure/streaming notes

- Outbound writes use `stdin.write()` + `flush()` without awaiting drain semantics.
- There is no explicit queue or high-watermark management in transport.
- Inbound processing is stream-driven (`for await` over `readJsonl`), one parsed message at a time.

## HTTP/SSE transport internals

## Lifecycle and connection semantics

HTTP transport has logical connection state, but request path is stateless per HTTP call:

- `connect()` sets `connected=true` (no socket/session handshake)
- optional server session tracking via `Mcp-Session-Id` header
- `close()` optionally sends `DELETE` with `Mcp-Session-Id`, aborts SSE listener, emits `onClose`

So `connected` means "transport usable", not "persistent stream established".

## Session header behavior

- On POST response, if `Mcp-Session-Id` header is present, transport stores it.
- Subsequent requests/notifications include `Mcp-Session-Id`.
- `close()` tries to terminate server session with HTTP DELETE; termination failures are ignored.

## Timeout and cancellation

For both `request()` and `notify()`:

- timeout uses `AbortController` (`config.timeout ?? 30000`)
- external signal, if provided, is merged via `AbortSignal.any([...])`
- AbortError handling distinguishes caller abort vs timeout

Errors thrown:

- timeout: `Request timeout after ...ms` (or `SSE response timeout ...`, `Notify timeout ...`)
- caller abort: original AbortError is rethrown when external signal is already aborted

## HTTP error propagation

On non-OK response:

- response text is included in thrown error (`HTTP <status>: <text>`)
- if present, auth hints from `WWW-Authenticate` and `Mcp-Auth-Server` are appended

On JSON-RPC error object:

- throws `MCP error <code>: <message>`

Malformed JSON body (`response.json()` failure) propagates as parse exception.

## SSE behavior and modes

Two SSE paths exist:

1. **Per-request SSE response** (`#parseSSEResponse`)
   - used when POST response content type is `text/event-stream`
   - consumes stream until matching response id found
   - can process interleaved notifications during same stream

2. **Background SSE listener** (`startSSEListener()`)
   - optional GET listener for server-initiated notifications
   - currently not automatically started by MCP manager/client
   - if GET returns `405`, listener silently disables itself (server does not support this mode)

## Malformed payload and disconnect handling

SSE JSON parsing errors bubble out of `readSseJson` and reject request/listener.

- Request SSE parse errors reject the active request.
- Background listener errors trigger `onError` (except AbortError).
- No auto-reconnect for background listener.

## `json-rpc.ts` utility vs transport abstraction

`src/mcp/json-rpc.ts` provides `callMCP()` and `parseSSE()` helpers for direct HTTP MCP calls (used by Exa integration), not the `MCPTransport` abstraction used by `MCPClient`/`MCPManager`.

Notable differences from `HttpTransport`:

- parses entire response text first, then extracts first `data: ` line (`parseSSE`), with JSON fallback
- no request timeout management, no abort API, no session-id handling, no transport lifecycle
- returns raw JSON-RPC envelope object

This path is lightweight but less robust than full transport implementation.

## Retry/reconnect responsibilities

## Transport-level

Current transport implementations do **not**:

- retry failed requests
- reconnect after stdio process exit
- reconnect SSE listeners
- resend in-flight requests after disconnect

They fail fast and propagate errors.

## Manager/client-level

`MCPManager` handles discovery/initial connection orchestration and can reconnect only by running connect flows again (`connectToServer`/`discoverAndConnect` paths). It does not auto-heal an already connected transport on runtime failure callbacks.

`MCPManager` does have startup fallback behavior for slow servers (deferred tools from cache), but that is tool availability fallback, not transport retry.

## Failure scenarios summary

- **Malformed stdio message line**: dropped; stream continues.
- **Stdio stream/process ends**: transport closes; pending requests rejected as `Transport closed`.
- **HTTP non-2xx**: request/notify throws HTTP error.
- **Invalid JSON response**: parse exception propagated.
- **SSE ends without matching id**: request fails with `No response received for request ID ...`.
- **Timeout**: transport-specific timeout error.
- **Caller abort**: AbortError/reason propagated from caller signal.

## Practical boundary rule

If the concern is message shape, id correlation, or MCP method ordering, it belongs to protocol/client logic.

If the concern is framing (JSONL vs HTTP/SSE), stream parsing, fetch/spawn lifecycle, timeout clocks, or connection teardown, it belongs to transport implementation.