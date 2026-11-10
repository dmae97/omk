# T-13 results: #387 client against the local mock gateway

Run at 2026-11-11 06:36:09 KST (Asia/Seoul).

## SHAs and setup

- **Client under test:** `674eded44a0d8099a4aa12e9ca99591aaf28c979` — Merge pull request #387 from dmae97/feat/omk-provider-registration
- **Contains #387 head `cd25e92907`:** yes (`git merge-base --is-ancestor`)
- **origin/feat/omk-provider after re-fetch:** `dfd8e1079f75eb5ab25a31b199e7549ae1685adf` (contains cd25e92907: yes). Re-checked origin/feat/omk-provider after the run: it moved to dfd8e1079f (Merge pull request #386, CI-only: run CI for PRs into feat/omk-provider). Client tree at 674eded44a is unchanged by that merge, so this run was not repeated on dfd8e1079f.
- **Gateway proto (at start of run):** `16eb42f431d1d8f99956107dd5a174ab2d56849c` — gateway: mock upstream stream and tool-call modes; pin thinking-phase abort estimate
- **Gateway stack:** same as `npm run dev:mock` (Hono + in-memory PGlite + `createDevMockUpstream`), listening on `http://127.0.0.1:8787/v1`.
- **Client env:** `OMK_PROVIDER_OMK=1`, `OMK_GATEWAY_BASE_URL=http://127.0.0.1:8787/v1`, `OMK_ACCOUNT_TOKEN` (dev token issued at startup, stored as SHA-256 only, never written into this report).
- **No real DeepSeek key, no paid infra, no push, no npm publish.** The client worktree is detached and was not committed to.
- **Client driver exit code:** 0
- **Node for client/CLI cases:** `/home/box/.nvm/versions/node/v22.23.4/bin/node` (client `engines.node` is `>=22.19.0`). An earlier attempt with the box default Node 20.19.2 could not run the CLI: undici's zstd decompressor throws `createZstdDecompress` undefined, which is outside the supported engine range.
- **Client build:** `packages/coding-agent` rebuilt from this SHA with `npm run build` (the copied dist from another worktree was stale and still used `OMK_GATEWAY_TOKEN`).

## Summary

Overall: **PASS** — client cases 9 passed / 0 failed / 9 total; usage_events check PASS (8 rows).

| Case | Title | Result |
| --- | --- | --- |
| 1a | OMK/coder non-stream (raw HTTP; client has no non-stream path) | PASS |
| 1b | OMK/coder streamed turn via streamSimple | PASS |
| 1c | OMK/coder streamed turn via CLI print/json mode | PASS |
| 2 | OMK/reasoner streamed turn with reasoning shown | PASS |
| 3 | Tool-call loop via streamSimple (get_weather -> final answer) | PASS |
| 4a | Internal call (no reasoning key) on reasoner goes to coder, no thinking_required | PASS |
| 4b | Deliberate thinking-off request to reasoner yields 400 thinking_required, surfaced by the client | PASS |
| 5a | Missing token gives a clear auth error | PASS |
| 5b | Bad token is rejected by the gateway and surfaced as a clear auth error | PASS |
| 6 | usage_events match requests (count, `OMK/*` names, estimated flags) | PASS |

## Case evidence

### 1a. OMK/coder non-stream (raw HTTP; client has no non-stream path) — PASS

- The official client streamSimple/completeSimple path always sets stream:true (packages/ai/src/providers/openai-completions.ts:517). This case hits the gateway non-stream JSON mode with the same token, base URL, and model id the client uses.

```
{
  "ms": 52,
  "httpStatus": 200,
  "content": "mock reply",
  "object": "chat.completion",
  "finish": "stop",
  "hasUsage": true
}
```

### 1b. OMK/coder streamed turn via streamSimple — PASS

```
{
  "ms": 112,
  "text": "mock reply",
  "thinking": null,
  "stopReason": "stop",
  "errorMessage": null,
  "events": [
    "start",
    "text_start",
    "text_delta",
    "text_end",
    "done"
  ]
}
```

### 1c. OMK/coder streamed turn via CLI print/json mode — PASS

```
{
  "ms": 700,
  "exitCode": 0,
  "node": "/home/box/.nvm/versions/node/v22.23.4/bin/node",
  "sawText": true,
  "termination": {
    "type": "session_termination",
    "termination": {
      "schemaVersion": 1,
      "sessionId": "01a1c763-bc80-7123-8788-e157dc12ae3d",
      "runId": "c481e2b2-2031-4900-a439-7c75d77face5",
      "kind": "completed",
      "phase": "completed",
      "source": "observed",
      "message": "Run completed.",
      "causeCode": "session.completed",
      "nextAction": "No recovery action is required; continue with the next prompt.",
      "retryable": false,
      "safeToAutoRetry": false,
      "sideEffects": "none",
      "timestamp": "2026-11-10T21:36:04.946Z",
      "provider": "OMK",
      "model": "coder"
    }
  },
  "eventTypes": [
    "session",
    "omk_session_info",
    "agent_start",
    "turn_start",
    "message_start",
    "message_end",
    "omk_session_info",
    "message_start",
    "message_update",
    "message_update",
    "message_update",
    "message_end",
    "turn_end",
    "session_termination",
    "agent_end",
    "prompt_settled"
  ],
  "stdoutClip": "{\"type\":\"session\",\"version\":3,\"id\":\"01a1c763-bc80-7123-8788-e157dc12ae3d\",\"timestamp\":\"2026-11-10T21:36:04.736Z\",\"cwd\":\"/tmp/omk-t13-home-1ucZPv\"}\n{\"type\":\"omk_session_info\",\"seq\":1,\"systemHash\":\"6be6330c3c4e35d9a070e7c96de1502b5245b4e43f2f587784fda138312879a5\",\"toolsHash\":\"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945\",\"systemPrompt\":\"You are an expert coding assistant operating inside OMK, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.\\n\\nAvailable tools:\\n(none)\\n\\nIn addition to the tools above, you may have access to other custom tools depending on the project.\\n\\nGuidelines:\\n- Be concise in your responses\\n- Show file paths clearly when working with files\\n\\nOMK documentation (read only when the user asks about OMK itself, its SDK, extensions, themes, skills, or TUI):\\n- Main documentation: /workspace/omk-t13-client/packages/coding-agent/README.md\\n- Additional docs: /workspace/omk-t13-client/packages/coding-agent/docs\\n- Examples: /workspace/omk-t13-client/packages/coding-agent/examples (extensions, custom tools, SDK)\\n- When reading OMK docs or examples, resolve docs/... under Additional …",
  "stderrClip": ""
}
```

### 2. OMK/reasoner streamed turn with reasoning shown — PASS

```
{
  "ms": 664,
  "streamSimple": {
    "text": "mock reply",
    "thinking": "Let me think step by step.",
    "stopReason": "stop",
    "events": [
      "start",
      "thinking_start",
      "thinking_delta",
      "text_start",
      "text_delta",
      "thinking_end",
      "text_end",
      "done"
    ],
    "errorMessage": null
  },
  "cli": {
    "exitCode": 0,
    "node": "/home/box/.nvm/versions/node/v22.23.4/bin/node",
    "sawReasoning": true,
    "sawText": true,
    "termination": {
      "type": "session_termination",
      "termination": {
        "schemaVersion": 1,
        "sessionId": "01a1c763-bf24-7587-a73e-59d517304a69",
        "runId": "2ee2903a-cecc-4219-bec8-4f02b781f444",
        "kind": "completed",
        "phase": "completed",
        "source": "observed",
        "message": "Run completed.",
        "causeCode": "session.completed",
        "nextAction": "No recovery action is required; continue with the next prompt.",
        "retryable": false,
        "safeToAutoRetry": false,
        "sideEffects": "none",
        "timestamp": "2026-11-10T21:36:05.583Z",
        "provider": "OMK",
        "model": "reasoner"
      }
    },
    "eventTypes": [
      "session",
      "omk_session_info",
      "agent_start",
      "turn_start",
      "message_start",
      "message_end",
      "omk_session_info",
      "message_start",
      "message_update",
      "message_update",
      "message_update",
      "message_update",
      "message_update",
      "message_update",
      "message_end",
      "turn_end",
      "session_termination",
      "agent_end",
      "prompt_settled"
    ],
    "stdoutClip": "{\"type\":\"session\",\"version\":3,\"id\":\"01a1c763-bf24-7587-a73e-59d517304a69\",\"timestamp\":\"2026-11-10T21:36:05.412Z\",\"cwd\":\"/tmp/omk-t13-home-7xafPv\"}\n{\"type\":\"omk_session_info\",\"seq\":1,\"systemHash\":\"bda21403d9fbcf133933300d51bb69ba5af1aa6f3b78e2fad1d56b4b90fde510\",\"toolsHash\":\"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945\",\"systemPrompt\":\"You are an expert coding assistant operating inside OMK, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.\\n\\nAvailable tools:\\n(none)\\n\\nIn addition to the tools above, you may have access to other custom tools depending on the project.\\n\\nGuidelines:\\n- Be concise in your responses\\n- Show file paths clearly when working with files\\n\\nOMK documentation (read only when the user asks about OMK itself, its SDK, extensions, themes, skills, or TUI):\\n- Main documentation: /workspace/omk-t13-client/packages/coding-agent/README.md\\n- Additional docs: /workspace/omk-t13-client/packages/coding-agent/docs\\n- Examples: /workspace/omk-t13-client/packages/coding-agent/examples (extensions, custom tools, SDK)\\n- When reading OMK docs or examples, resolve docs/... under Additional …",
    "stderrClip": ""
  }
}
```

### 3. Tool-call loop via streamSimple (get_weather -> final answer) — PASS

- CLI --tools only filters built-in tools; it cannot inject a custom get_weather tool. This loop drives the provider stream function directly, as allowed by T-13.

```
{
  "ms": 23,
  "first": {
    "stopReason": "toolUse",
    "toolCalls": [
      {
        "id": "call_1",
        "name": "get_weather",
        "arguments": {
          "city": "Seoul"
        }
      }
    ],
    "events": [
      "start",
      "toolcall_start",
      "toolcall_delta",
      "toolcall_delta",
      "toolcall_delta",
      "toolcall_end",
      "done"
    ]
  },
  "second": {
    "stopReason": "stop",
    "text": "It's 18C and clear in Seoul.",
    "thinking": null,
    "events": [
      "start",
      "text_start",
      "text_delta",
      "text_end",
      "done"
    ],
    "errorMessage": null
  }
}
```

### 4a. Internal call (no reasoning key) on reasoner goes to coder, no thinking_required — PASS

```
{
  "ms": 9,
  "wireModel": "coder",
  "thinking": null,
  "reasoning_effort": null,
  "stopReason": "stop",
  "text": "mock reply",
  "errorMessage": null
}
```

### 4b. Deliberate thinking-off request to reasoner yields 400 thinking_required, surfaced by the client — PASS

- The client route (route.ts) never sends thinking:disabled for OMK/reasoner (off is clamped to low). This case deliberately rewrites the payload via onPayload so the request still goes through the client's HTTP and error path.

```
{
  "ms": 5,
  "wireModel": "reasoner",
  "wireThinking": {
    "type": "disabled"
  },
  "stopReason": "error",
  "errorMessage": "400 OMK/reasoner always uses thinking. Use OMK/coder for non-thinking requests."
}
```

### 5a. Missing token gives a clear auth error — PASS

```
{
  "ms": 500,
  "streamSimple": {
    "stopReason": "error",
    "errorMessage": "No API key for provider: OMK"
  },
  "cli": {
    "exitCode": 1,
    "node": "/home/box/.nvm/versions/node/v22.23.4/bin/node",
    "termination": {
      "type": "session_termination",
      "termination": {
        "schemaVersion": 1,
        "sessionId": "01a1c763-c1fa-72e0-b868-25bf7ab5b7a2",
        "runId": "preflight-3feea683-46ef-4b76-9562-e3d3c8d542e8",
        "kind": "provider_auth",
        "phase": "provider",
        "source": "observed",
        "message": "No API key found for OMK.\n\nUse /login to log into a provider via OAuth or API key. See:\n  /workspace/omk-t13-client/packages/coding-agent/docs/providers.md\n  /workspace/omk-t13-client/packages/coding-agent/docs/models.md",
        "causeCode": "provider.auth",
        "nextAction": "Run /login OMK in an interactive session, or set the provider's API key environment variable, then retry.",
        "retryable": false,
        "safeToAutoRetry": false,
        "sideEffects": "none",
        "timestamp": "2026-11-10T21:36:06.181Z",
        "provider": "OMK",
        "model": "coder"
      }
    },
    "stdoutClip": "{\"type\":\"session\",\"version\":3,\"id\":\"01a1c763-c1fa-72e0-b868-25bf7ab5b7a2\",\"timestamp\":\"2026-11-10T21:36:06.138Z\",\"cwd\":\"/tmp/omk-t13-home-Vn6yR7\"}\n{\"type\":\"omk_session_info\",\"seq\":1,\"systemHash\":\"702596b23de8a37ad74fdfb0151e40ea968a3dc9b596afe611b0dbef8bedd754\",\"toolsHash\":\"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945\",\"systemPrompt\":\"You are an expert coding assistant operating inside OMK, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.\\n\\nAvailable tools:\\n(none)\\n\\nIn addition to the tools above, you may have access to other custom tools depending on the project.\\n\\nGuidelines:\\n- Be concise in your responses\\n- Show file paths clearly when working with files\\n\\nOMK documentation (read only when the us…",
    "stderrClip": ""
  }
}
```

### 5b. Bad token is rejected by the gateway and surfaced as a clear auth error — PASS

```
{
  "ms": 683,
  "streamSimple": {
    "stopReason": "error",
    "errorMessage": "401 The token is not valid. Check OMK_ACCOUNT_TOKEN or ask for a new one."
  },
  "cli": {
    "exitCode": 1,
    "node": "/home/box/.nvm/versions/node/v22.23.4/bin/node",
    "termination": {
      "type": "session_termination",
      "termination": {
        "schemaVersion": 1,
        "sessionId": "01a1c763-c3e6-7742-b36c-c8c06ff15dfa",
        "runId": "62407984-366b-4d72-9751-115f0f41d03c",
        "kind": "provider_protocol",
        "phase": "provider",
        "source": "observed",
        "message": "401 The token is not valid. Check OMK_ACCOUNT_TOKEN or ask for a new one.",
        "causeCode": "provider.protocol",
        "nextAction": "Check request parameters and tool/message consistency in /debug before retrying. A new session does not reload provider code; restart OMK after an adapter update.",
        "retryable": true,
        "safeToAutoRetry": false,
        "sideEffects": "none",
        "timestamp": "2026-11-10T21:36:06.796Z",
        "provider": "OMK",
        "model": "coder"
      }
    },
    "stdoutClip": "{\"type\":\"session\",\"version\":3,\"id\":\"01a1c763-c3e6-7742-b36c-c8c06ff15dfa\",\"timestamp\":\"2026-11-10T21:36:06.630Z\",\"cwd\":\"/tmp/omk-t13-home-UFLY03\"}\n{\"type\":\"omk_session_info\",\"seq\":1,\"systemHash\":\"3402f0fb118ff6a8924106904acc28263dd4b25552aecde4f56646112e19c34f\",\"toolsHash\":\"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945\",\"systemPrompt\":\"You are an expert coding assistant operating inside OMK, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.\\n\\nAvailable tools:\\n(none)\\n\\nIn addition to the tools above, you may have access to other custom tools depending on the project.\\n\\nGuidelines:\\n- Be concise in your responses\\n- Show file paths clearly when working with files\\n\\nOMK documentation (read only when the us…",
    "stderrClip": ""
  }
}
```

### 6. usage_events

- Row count: **8**
- All `model_public` values are `OMK/coder` or `OMK/reasoner`: **yes**
- All `estimated` flags are false (mock always sends usage): **yes**
- Auth failures and `thinking_required` (400) must not create usage rows (they never reach upstream). `denied_events` is only written for 429s, so those 400/401s also do not appear there.

| model_public | stream | prompt | hit | miss | completion | reasoning | total | finish | estimated | end_reason |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| OMK/coder | false | 10 | 0 | 10 | 5 | 0 | 15 | stop | false | complete |
| OMK/coder | true | 10 | 0 | 10 | 5 | 0 | 15 | stop | false | complete |
| OMK/coder | true | 10 | 0 | 10 | 5 | 0 | 15 | stop | false | complete |
| OMK/reasoner | true | 10 | 0 | 10 | 12 | 7 | 22 | stop | false | complete |
| OMK/reasoner | true | 10 | 0 | 10 | 12 | 7 | 22 | stop | false | complete |
| OMK/coder | true | 10 | 0 | 10 | 8 | 0 | 18 | tool_calls | false | complete |
| OMK/coder | true | 10 | 0 | 10 | 12 | 0 | 22 | stop | false | complete |
| OMK/coder | true | 10 | 0 | 10 | 5 | 0 | 15 | stop | false | complete |

denied_events:

```
[]
```

## Gateway request log (redacted)

Recorded by the harness wrapper around `app.fetch`. Authorization is always redacted. Bodies are summarized (model, stream, thinking, tool names, message roles) — no token values.

```json
[
  {
    "at": "2026-11-10T21:36:03.246Z",
    "method": "GET",
    "path": "/healthz",
    "caseId": null,
    "hasAuth": false,
    "authorization": null
  },
  {
    "at": "2026-11-10T21:36:03.259Z",
    "method": "GET",
    "path": "/healthz",
    "caseId": null,
    "hasAuth": false,
    "authorization": null
  },
  {
    "at": "2026-11-10T21:36:04.150Z",
    "method": "POST",
    "path": "/v1/chat/completions",
    "caseId": "1a",
    "hasAuth": true,
    "authorization": "[REDACTED]",
    "model": "OMK/coder",
    "stream": false,
    "thinking": null,
    "reasoning_effort": null,
    "tools": null,
    "messageRoles": [
      "user"
    ],
    "hasToolMessage": false
  },
  {
    "at": "2026-11-10T21:36:04.282Z",
    "method": "POST",
    "path": "/v1/chat/completions",
    "caseId": "1b",
    "hasAuth": true,
    "authorization": "[REDACTED]",
    "model": "coder",
    "stream": true,
    "thinking": null,
    "reasoning_effort": null,
    "tools": null,
    "messageRoles": [
      "user"
    ],
    "hasToolMessage": false
  },
  {
    "at": "2026-11-10T21:36:04.928Z",
    "method": "POST",
    "path": "/v1/chat/completions",
    "caseId": null,
    "hasAuth": true,
    "authorization": "[REDACTED]",
    "model": "coder",
    "stream": true,
    "thinking": null,
    "reasoning_effort": null,
    "tools": null,
    "messageRoles": [
      "system",
      "user"
    ],
    "hasToolMessage": false
  },
  {
    "at": "2026-11-10T21:36:04.997Z",
    "method": "POST",
    "path": "/v1/chat/completions",
    "caseId": "2",
    "hasAuth": true,
    "authorization": "[REDACTED]",
    "model": "reasoner",
    "stream": true,
    "thinking": {
      "type": "enabled"
    },
    "reasoning_effort": "low",
    "tools": null,
    "messageRoles": [
      "user"
    ],
    "hasToolMessage": false
  },
  {
    "at": "2026-11-10T21:36:05.564Z",
    "method": "POST",
    "path": "/v1/chat/completions",
    "caseId": null,
    "hasAuth": true,
    "authorization": "[REDACTED]",
    "model": "reasoner",
    "stream": true,
    "thinking": {
      "type": "enabled"
    },
    "reasoning_effort": "low",
    "tools": null,
    "messageRoles": [
      "system",
      "user"
    ],
    "hasToolMessage": false
  },
  {
    "at": "2026-11-10T21:36:05.661Z",
    "method": "POST",
    "path": "/v1/chat/completions",
    "caseId": "3a",
    "hasAuth": true,
    "authorization": "[REDACTED]",
    "model": "coder",
    "stream": true,
    "thinking": null,
    "reasoning_effort": null,
    "tools": [
      "get_weather"
    ],
    "messageRoles": [
      "user"
    ],
    "hasToolMessage": false
  },
  {
    "at": "2026-11-10T21:36:05.673Z",
    "method": "POST",
    "path": "/v1/chat/completions",
    "caseId": "3b",
    "hasAuth": true,
    "authorization": "[REDACTED]",
    "model": "coder",
    "stream": true,
    "thinking": null,
    "reasoning_effort": null,
    "tools": [
      "get_weather"
    ],
    "messageRoles": [
      "user",
      "assistant",
      "tool"
    ],
    "hasToolMessage": true
  },
  {
    "at": "2026-11-10T21:36:05.682Z",
    "method": "POST",
    "path": "/v1/chat/completions",
    "caseId": "4a",
    "hasAuth": true,
    "authorization": "[REDACTED]",
    "model": "coder",
    "stream": true,
    "thinking": null,
    "reasoning_effort": null,
    "tools": null,
    "messageRoles": [
      "user"
    ],
    "hasToolMessage": false
  },
  {
    "at": "2026-11-10T21:36:05.692Z",
    "method": "POST",
    "path": "/v1/chat/completions",
    "caseId": "4b",
    "hasAuth": true,
    "authorization": "[REDACTED]",
    "model": "reasoner",
    "stream": true,
    "thinking": {
      "type": "disabled"
    },
    "reasoning_effort": null,
    "tools": null,
    "messageRoles": [
      "user"
    ],
    "hasToolMessage": false
  },
  {
    "at": "2026-11-10T21:36:06.197Z",
    "method": "POST",
    "path": "/v1/chat/completions",
    "caseId": "5b",
    "hasAuth": true,
    "authorization": "[REDACTED]",
    "model": "coder",
    "stream": true,
    "thinking": null,
    "reasoning_effort": null,
    "tools": null,
    "messageRoles": [
      "user"
    ],
    "hasToolMessage": false
  },
  {
    "at": "2026-11-10T21:36:06.785Z",
    "method": "POST",
    "path": "/v1/chat/completions",
    "caseId": null,
    "hasAuth": true,
    "authorization": "[REDACTED]",
    "model": "coder",
    "stream": true,
    "thinking": null,
    "reasoning_effort": null,
    "tools": null,
    "messageRoles": [
      "system",
      "user"
    ],
    "hasToolMessage": false
  }
]
```

Structured gateway logs (whitelist only; already redacted by `createLogger`):

```
{"level":"info","event":"request","request_id":"req_18ccfdf27f5f4b4e87c0f8261446c666","method":"GET","path":"/healthz","status":200,"ms":1}
{"level":"info","event":"request","request_id":"req_f883862b38024cc3ae41347310ef2153","method":"GET","path":"/healthz","status":200,"ms":0}
{"level":"info","event":"usage_recorded","request_id":"req_92b697c582fa45e3be6d31f5cc4162a3","event_id":"evt_a9a6a7ba1918ecb4b5bbbf1e","model":"OMK/coder","total_tokens":15,"estimated":false,"end_reason":"complete","stream":false}
{"level":"info","event":"request","request_id":"req_92b697c582fa45e3be6d31f5cc4162a3","method":"POST","path":"/v1/chat/completions","status":200,"key":"5a71afd2","model":"OMK/coder","ms":21}
{"level":"info","event":"request","request_id":"req_231e79b775474672bd397e34507b69e1","method":"POST","path":"/v1/chat/completions","status":200,"key":"5a71afd2","model":"OMK/coder","ms":6}
{"level":"info","event":"usage_recorded","request_id":"req_231e79b775474672bd397e34507b69e1","event_id":"evt_230dbfa60631be8e51159f17","model":"OMK/coder","total_tokens":15,"estimated":false,"end_reason":"complete","stream":true}
{"level":"info","event":"request","request_id":"req_8a30b5af7d7340dcaf9da61548912fd2","method":"POST","path":"/v1/chat/completions","status":200,"key":"5a71afd2","model":"OMK/coder","ms":5}
{"level":"info","event":"usage_recorded","request_id":"req_8a30b5af7d7340dcaf9da61548912fd2","event_id":"evt_7d0c868cca9cf5ea0c681ecf","model":"OMK/coder","total_tokens":15,"estimated":false,"end_reason":"complete","stream":true}
{"level":"info","event":"request","request_id":"req_e910b97159894b6ca6d0994c465587a6","method":"POST","path":"/v1/chat/completions","status":200,"key":"5a71afd2","model":"OMK/reasoner","ms":5}
{"level":"info","event":"usage_recorded","request_id":"req_e910b97159894b6ca6d0994c465587a6","event_id":"evt_22b041178bc49e3062d90c00","model":"OMK/reasoner","total_tokens":22,"estimated":false,"end_reason":"complete","stream":true}
{"level":"info","event":"request","request_id":"req_a4f74ec3d0874a358354fb6607568c92","method":"POST","path":"/v1/chat/completions","status":200,"key":"5a71afd2","model":"OMK/reasoner","ms":5}
{"level":"info","event":"usage_recorded","request_id":"req_a4f74ec3d0874a358354fb6607568c92","event_id":"evt_6067a899aa92d720079ddf86","model":"OMK/reasoner","total_tokens":22,"estimated":false,"end_reason":"complete","stream":true}
{"level":"info","event":"request","request_id":"req_021be02dca734c10b189a1eb875b99c5","method":"POST","path":"/v1/chat/completions","status":200,"key":"5a71afd2","model":"OMK/coder","ms":5}
{"level":"info","event":"usage_recorded","request_id":"req_021be02dca734c10b189a1eb875b99c5","event_id":"evt_9e571c3f041b18fa967e9311","model":"OMK/coder","total_tokens":18,"estimated":false,"end_reason":"complete","stream":true}
{"level":"info","event":"request","request_id":"req_a2af9f60cd984b64ba55f64dc3d8e47c","method":"POST","path":"/v1/chat/completions","status":200,"key":"5a71afd2","model":"OMK/coder","ms":4}
{"level":"info","event":"usage_recorded","request_id":"req_a2af9f60cd984b64ba55f64dc3d8e47c","event_id":"evt_002b5755bd8e104ea2c8053f","model":"OMK/coder","total_tokens":22,"estimated":false,"end_reason":"complete","stream":true}
{"level":"info","event":"request","request_id":"req_8e3b7417aff34075a46906157ac50d9b","method":"POST","path":"/v1/chat/completions","status":200,"key":"5a71afd2","model":"OMK/coder","ms":4}
{"level":"info","event":"usage_recorded","request_id":"req_8e3b7417aff34075a46906157ac50d9b","event_id":"evt_04b76f5c52411e9d7c8dbd56","model":"OMK/coder","total_tokens":15,"estimated":false,"end_reason":"complete","stream":true}
{"level":"info","event":"request","request_id":"req_f98f04f715c341bfbd76be8557d04865","method":"POST","path":"/v1/chat/completions","status":400,"key":"5a71afd2","model":"OMK/reasoner","ms":1,"code":"thinking_required"}
{"level":"info","event":"request","request_id":"req_23182d89108341d2a1e8710611bb1327","method":"POST","path":"/v1/chat/completions","status":401,"key":"8b548793","ms":1,"code":"token_invalid"}
{"level":"info","event":"request","request_id":"req_4b8af386bec642f3895a03cd4e5a167c","method":"POST","path":"/v1/chat/completions","status":401,"key":"8b548793","ms":1,"code":"token_invalid"}
```

## Client bugs found

None that blocked T-13. One observation: a bad token is surfaced clearly (`401 The token is not valid. Check OMK_ACCOUNT_TOKEN or ask for a new one.`), but the CLI session termination uses `kind: provider_protocol` / `causeCode: provider.protocol` rather than `provider_auth`. Missing-token preflight correctly uses `provider_auth`.


## Blocked / caveats

- The official client (`openai-completions.ts:517`, and `completeSimple` which wraps `streamSimple`) always sends `stream: true`. Case 1a therefore uses the same token/base URL/model over raw HTTP to exercise the gateway's non-stream JSON mode, and is labeled as such.
- The CLI cannot inject a custom `get_weather` tool (`--tools` only filters built-ins). The tool-call loop was driven through `streamSimple` with a TypeBox `get_weather` tool, which is the fallback T-13 allows.
- A normal client path never sends `thinking: disabled` to `OMK/reasoner` (`route.ts` / the thinking-level map). Case 4b rewrites the payload with `onPayload` so the 400 still travels through the client's HTTP and error path.
- This harness starts the mock stack itself so `usage_events` can be queried from the in-memory PGlite. It is the same modules and bind address as `npm run dev:mock`.
- No push of `feat/omk-gateway-proto`; no commit in the client worktree.

