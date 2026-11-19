# TencentDB Agent Memory

OMK includes a native `tencent_memory` tool and the `omk-tencent-memory` setup skill. No plugin installation or proxy is required. The tool speaks [MemoryCore v3](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/badbd2179d06f4e0e1f2133bd3482880beab8a02/MemoryCore/v3-api-memorycore-doc.md); it does not replace OMK's local memory.

## Configure a server

Deploy MemoryCore separately using the [upstream installation guide](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/badbd2179d06f4e0e1f2133bd3482880beab8a02/INSTALL.md). Server storage, identity provisioning and LLM extraction configuration remain server responsibilities. OMK does not start containers, create accounts, change model endpoints, or upload existing sessions.

Create `tencent-memory.json` in your **agent directory** (normally `~/.omk/agent/`):

```json
{
  "endpoint": "http://127.0.0.1:8420",
  "serviceId": "your-instance",
  "teamId": "your-team",
  "agentId": "your-agent",
  "userId": "your-user",
  "apiKeyEnv": "TENCENTDB_MEMORY_API_KEY",
  "allowWrites": false
}
```

Set the named environment variable with your own MemoryCore gateway token before starting OMK. Do not put the token in prompts, project files, or the JSON configuration. Project-local configuration cannot override this connection or identity. Each request uses the configured team/agent/user scope; there is no model-selected scope or endpoint override.

Use HTTPS for remote servers. HTTP is allowed only for `localhost`, `127.0.0.1`, or `[::1]`. URL credentials, query strings and fragments are rejected. TLS certificate validation stays enabled; redirects are rejected. `timeoutMs` may be set from 100 to 30000 (default 10000).

## Use

Tool arguments:

```json
{"action":"status"}
{"action":"search","query":"release checklist","layer":"atomic","limit":5}
{"action":"search","query":"decision","layer":"conversation"}
{"action":"read","layer":"core"}
{"action":"read","layer":"scenario","path":"project/context.md"}
{"action":"remember","text":"This project uses pnpm, not npm."}
```

- `status` only checks local configuration and credential availability. It does **not** certify connectivity or authentication.
- `search` searches L1 atoms by default, or L0 conversations. Query length is 1–2048 characters; limit is 1–20.
- `read` reads L3 core memory by default, or one L2 scenario file. A null content value means the server has no such content, not a fabricated empty memory.
- `remember` requires `allowWrites: true` and explicit user authorization for the supplied text. Only that text (1–8192 characters) is sent as one L0 user message under the current OMK session ID. The server's acceptance does not prove its asynchronous L1 extraction has finished. Extraction can consume the server's configured LLM budget.

There are no automatic capture/recall hooks, transcript reads, deletion tools, admin APIs, or retry-on-write behavior. Remote memories are untrusted data, not instructions or authorization. Do not store credentials or private content outside its approved scope.

Requests honor cancellation and `OMK_OFFLINE=1`. Responses larger than 64 KiB are rejected rather than stored or silently truncated. Tool display uses OMK's usual bounded output. HTTP/business failures are reported without echoing server error bodies or credentials. A failed/aborted write has an unknown remote outcome; inspect the server before resubmitting.

The built-in is available on fresh startup. Set `OMK_TENCENT_MEMORY=0` to disable it. `--no-extensions` also suppresses this optional integration. Configuration is read at tool invocation; adding configuration does not send a request. Updating OMK source requires rebuilding/restarting before a running process can see the new built-in.

## Scope

This integration covers MemoryCore L0–L3 operations above, not the full Memory Hub, Wiki, CodeGraph, proxy or server deployment stack. No real backend is bundled and no connection is assumed. See the bundled skill's source notice for the pinned upstream contract and license.
