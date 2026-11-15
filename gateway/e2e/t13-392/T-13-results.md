# T-13 re-run: feat/omk-provider after #392 (token login, gateway errors) against the local mock gateway

Run at 2026-11-11 12:13:00 KST (Asia/Seoul).

## SHAs and setup

- **Client under test:** `13753b84acb72ca077f0a188c32ffae879b9a173` — Merge pull request #392 from dmae97/feat/omk-provider-token-login-v2
- **Contains #387 head `cd25e92907`:** yes (`git merge-base --is-ancestor`)
- **origin/feat/omk-provider after re-fetch:** `13753b84acb72ca077f0a188c32ffae879b9a173` (contains cd25e92907: yes). Re-checked origin/feat/omk-provider after the run: still at the SHA under test.
- **Gateway proto (at start of run):** `ba4c11cfec93830c693fc89a0b0286143248c7ce` — docs(gateway): mark T-13 mock e2e as done in DEVIATIONS
- **Gateway stack:** same as `npm run dev:mock` (Hono + in-memory PGlite + `createDevMockUpstream`), listening on `http://127.0.0.1:8787/v1`.
- **Client env:** `OMK_PROVIDER_OMK=1`, `OMK_GATEWAY_BASE_URL=http://127.0.0.1:8787/v1`, `OMK_ACCOUNT_TOKEN` (dev token issued at startup, stored as SHA-256 only, never written into this report).
- **No real DeepSeek key, no paid infra, no push, no npm publish.** The client worktree is detached and was not committed to.
- **Client driver exit code:** 0
- **Node for client/CLI cases:** `/home/box/.nvm/versions/node/v22.23.4/bin/node` (client `engines.node` is `>=22.19.0`).
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
  "ms": 39,
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
  "ms": 93,
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
  "ms": 733,
  "exitCode": 0,
  "node": "/home/box/.nvm/versions/node/v22.23.4/bin/node",
  "sawText": true,
  "termination": {
    "type": "session_termination",
    "termination": {
      "schemaVersion": 1,
      "sessionId": "01a1c898-2197-7b25-b6b0-9d5498b52cec",
      "runId": "e6598253-e799-4b71-871e-bd4d68f1511e",
      "kind": "completed",
      "phase": "completed",
      "source": "observed",
      "message": "Run completed.",
      "causeCode": "session.completed",
      "nextAction": "No recovery action is required; continue with the next prompt.",
      "retryable": false,
      "safeToAutoRetry": false,
      "sideEffects": "none",
      "timestamp": "2026-11-11T03:12:55.917Z",
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
  "stdoutClip": "{\"type\":\"session\",\"version\":3,\"id\":\"01a1c898-2197-7b25-b6b0-9d5498b52cec\",\"timestamp\":\"2026-11-11T03:12:55.703Z\",\"cwd\":\"/tmp/omk-t13-home-Tcbt5Q\"}\n{\"type\":\"omk_session_info\",\"seq\":1,\"systemHash\":\"3781c8262b34ad33e5b056c2175be1c586e8025bba2c8dadce4dc12dd5df42e2\",\"toolsHash\":\"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945\",\"systemPrompt\":\"You are an expert coding assistant operating inside OMK, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.\\n\\nAvailable tools:\\n(none)\\n\\nIn addition to the tools above, you may have access to other custom tools depending on the project.\\n\\nGuidelines:\\n- Be concise in your responses\\n- Show file paths clearly when working with files\\n\\nOMK documentation (read only when the user asks about OMK itself, its SDK, extensions, themes, skills, or TUI):\\n- Main documentation: /workspace/omk-t13-client/packages/coding-agent/README.md\\n- Additional docs: /workspace/omk-t13-client/packages/coding-agent/docs\\n- Examples: /workspace/omk-t13-client/packages/coding-agent/examples (extensions, custom tools, SDK)\\n- When reading OMK docs or examples, resolve docs/... under Additional …",
  "stderrClip": ""
}
```

### 2. OMK/reasoner streamed turn with reasoning shown — PASS

```
{
  "ms": 726,
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
        "sessionId": "01a1c898-24aa-7fd5-8a21-7633af2f47ba",
        "runId": "fc6c0905-575e-4996-bc50-b0546cf2bc9d",
        "kind": "completed",
        "phase": "completed",
        "source": "observed",
        "message": "Run completed.",
        "causeCode": "session.completed",
        "nextAction": "No recovery action is required; continue with the next prompt.",
        "retryable": false,
        "safeToAutoRetry": false,
        "sideEffects": "none",
        "timestamp": "2026-11-11T03:12:56.658Z",
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
    "stdoutClip": "{\"type\":\"session\",\"version\":3,\"id\":\"01a1c898-24aa-7fd5-8a21-7633af2f47ba\",\"timestamp\":\"2026-11-11T03:12:56.490Z\",\"cwd\":\"/tmp/omk-t13-home-mERpSt\"}\n{\"type\":\"omk_session_info\",\"seq\":1,\"systemHash\":\"b5083fd9724e67b40020e75a247087ce68c7d2f770d5c49557c8240136153e55\",\"toolsHash\":\"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945\",\"systemPrompt\":\"You are an expert coding assistant operating inside OMK, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.\\n\\nAvailable tools:\\n(none)\\n\\nIn addition to the tools above, you may have access to other custom tools depending on the project.\\n\\nGuidelines:\\n- Be concise in your responses\\n- Show file paths clearly when working with files\\n\\nOMK documentation (read only when the user asks about OMK itself, its SDK, extensions, themes, skills, or TUI):\\n- Main documentation: /workspace/omk-t13-client/packages/coding-agent/README.md\\n- Additional docs: /workspace/omk-t13-client/packages/coding-agent/docs\\n- Examples: /workspace/omk-t13-client/packages/coding-agent/examples (extensions, custom tools, SDK)\\n- When reading OMK docs or examples, resolve docs/... under Additional …",
    "stderrClip": ""
  }
}
```

### 3. Tool-call loop via streamSimple (get_weather -> final answer) — PASS

- CLI --tools only filters built-in tools; it cannot inject a custom get_weather tool. This loop drives the provider stream function directly, as allowed by T-13.

```
{
  "ms": 19,
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
  "ms": 8,
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
  "ms": 422,
  "streamSimple": {
    "stopReason": "error",
    "errorMessage": "OMK account token missing. Set OMK_ACCOUNT_TOKEN or run /login and choose OMK."
  },
  "cli": {
    "exitCode": 1,
    "node": "/home/box/.nvm/versions/node/v22.23.4/bin/node",
    "termination": {
      "type": "session_termination",
      "termination": {
        "schemaVersion": 1,
        "sessionId": "01a1c898-2734-79d8-9639-209fef77a042",
        "runId": "preflight-afd56a97-1604-45a3-8a08-8992903ebca9",
        "kind": "provider_auth",
        "phase": "provider",
        "source": "observed",
        "message": "OMK account token missing. Set OMK_ACCOUNT_TOKEN or run /login and choose OMK.",
        "causeCode": "provider.auth",
        "nextAction": "Run /login OMK in an interactive session, or set the provider's API key environment variable, then retry.",
        "retryable": false,
        "safeToAutoRetry": false,
        "sideEffects": "none",
        "timestamp": "2026-11-11T03:12:57.179Z",
        "provider": "OMK",
        "model": "coder"
      }
    },
    "stdoutClip": "{\"type\":\"session\",\"version\":3,\"id\":\"01a1c898-2734-79d8-9639-209fef77a042\",\"timestamp\":\"2026-11-11T03:12:57.140Z\",\"cwd\":\"/tmp/omk-t13-home-iu7Vwt\"}\n{\"type\":\"omk_session_info\",\"seq\":1,\"systemHash\":\"d1e6b83e4ac56fb287dd1ad907e6a3e287e8d41f3947bbffde5f45d0fa0d956e\",\"toolsHash\":\"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945\",\"systemPrompt\":\"You are an expert coding assistant operating inside OMK, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.\\n\\nAvailable tools:\\n(none)\\n\\nIn addition to the tools above, you may have access to other custom tools depending on the project.\\n\\nGuidelines:\\n- Be concise in your responses\\n- Show file paths clearly when working with files\\n\\nOMK documentation (read only when the us…",
    "stderrClip": ""
  }
}
```

### 5b. Bad token is rejected by the gateway and surfaced as a clear auth error — PASS

```
{
  "ms": 623,
  "streamSimple": {
    "stopReason": "error",
    "errorMessage": "OMK token rejected (401 token_invalid): the gateway does not accept this token. Check OMK_ACCOUNT_TOKEN or run /login to store a new one."
  },
  "cli": {
    "exitCode": 1,
    "node": "/home/box/.nvm/versions/node/v22.23.4/bin/node",
    "termination": {
      "type": "session_termination",
      "termination": {
        "schemaVersion": 1,
        "sessionId": "01a1c898-28e7-74ec-a87c-c306920bd8ae",
        "runId": "856c9857-422f-4619-9187-a687b7b16e3c",
        "kind": "provider_auth",
        "phase": "provider",
        "source": "observed",
        "message": "OMK token rejected (401 token_invalid): the gateway does not accept this token. Check OMK_ACCOUNT_TOKEN or run /login to store a new one.",
        "causeCode": "provider.auth",
        "nextAction": "Run /login OMK in an interactive session, or set the provider's API key environment variable, then retry.",
        "retryable": false,
        "safeToAutoRetry": false,
        "sideEffects": "none",
        "timestamp": "2026-11-11T03:12:57.728Z",
        "provider": "OMK",
        "model": "coder"
      }
    },
    "stdoutClip": "{\"type\":\"session\",\"version\":3,\"id\":\"01a1c898-28e7-74ec-a87c-c306920bd8ae\",\"timestamp\":\"2026-11-11T03:12:57.575Z\",\"cwd\":\"/tmp/omk-t13-home-dqf5hi\"}\n{\"type\":\"omk_session_info\",\"seq\":1,\"systemHash\":\"4616e4fa5900a95610fdec0c9239d60ca05c18ea8046270a09b746027c410cbf\",\"toolsHash\":\"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945\",\"systemPrompt\":\"You are an expert coding assistant operating inside OMK, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.\\n\\nAvailable tools:\\n(none)\\n\\nIn addition to the tools above, you may have access to other custom tools depending on the project.\\n\\nGuidelines:\\n- Be concise in your responses\\n- Show file paths clearly when working with files\\n\\nOMK documentation (read only when the us…",
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
    "at": "2026-11-11T03:12:54.550Z",
    "method": "GET",
    "path": "/healthz",
    "caseId": null,
    "hasAuth": false,
    "authorization": null
  },
  {
    "at": "2026-11-11T03:12:54.560Z",
    "method": "GET",
    "path": "/healthz",
    "caseId": null,
    "hasAuth": false,
    "authorization": null
  },
  {
    "at": "2026-11-11T03:12:55.162Z",
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
    "at": "2026-11-11T03:12:55.270Z",
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
    "at": "2026-11-11T03:12:55.901Z",
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
    "at": "2026-11-11T03:12:56.015Z",
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
    "at": "2026-11-11T03:12:56.641Z",
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
    "at": "2026-11-11T03:12:56.741Z",
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
    "at": "2026-11-11T03:12:56.750Z",
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
    "at": "2026-11-11T03:12:56.759Z",
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
    "at": "2026-11-11T03:12:56.766Z",
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
    "at": "2026-11-11T03:12:57.194Z",
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
    "at": "2026-11-11T03:12:57.718Z",
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
{"level":"info","event":"request","request_id":"req_4979b96c801e4ea8bd341a98a77f633a","method":"GET","path":"/healthz","status":200,"ms":1}
{"level":"info","event":"request","request_id":"req_0df81a8eccff4504a927f29f342e75e5","method":"GET","path":"/healthz","status":200,"ms":0}
{"level":"info","event":"usage_recorded","request_id":"req_72e153d658e742dc980f3367e853d96e","event_id":"evt_97ebf690f9260f9582186cc3","model":"OMK/coder","total_tokens":15,"estimated":false,"end_reason":"complete","stream":false}
{"level":"info","event":"request","request_id":"req_72e153d658e742dc980f3367e853d96e","method":"POST","path":"/v1/chat/completions","status":200,"key":"431109ae","model":"OMK/coder","ms":16}
{"level":"info","event":"request","request_id":"req_f868a39a20db4c5ea0e281c18622e183","method":"POST","path":"/v1/chat/completions","status":200,"key":"431109ae","model":"OMK/coder","ms":5}
{"level":"info","event":"usage_recorded","request_id":"req_f868a39a20db4c5ea0e281c18622e183","event_id":"evt_ff4adef1f4a236b4858ce252","model":"OMK/coder","total_tokens":15,"estimated":false,"end_reason":"complete","stream":true}
{"level":"info","event":"request","request_id":"req_7cb2a018d0734750964aaec2b73b4c1a","method":"POST","path":"/v1/chat/completions","status":200,"key":"431109ae","model":"OMK/coder","ms":5}
{"level":"info","event":"usage_recorded","request_id":"req_7cb2a018d0734750964aaec2b73b4c1a","event_id":"evt_a486533bae63e60374a57641","model":"OMK/coder","total_tokens":15,"estimated":false,"end_reason":"complete","stream":true}
{"level":"info","event":"request","request_id":"req_1dc2ca21c0944aa78561e32c4b34dd3b","method":"POST","path":"/v1/chat/completions","status":200,"key":"431109ae","model":"OMK/reasoner","ms":4}
{"level":"info","event":"usage_recorded","request_id":"req_1dc2ca21c0944aa78561e32c4b34dd3b","event_id":"evt_751f0040416dfc6dbb5a3940","model":"OMK/reasoner","total_tokens":22,"estimated":false,"end_reason":"complete","stream":true}
{"level":"info","event":"request","request_id":"req_7bb11e6ed43146f099135010ce11bfe4","method":"POST","path":"/v1/chat/completions","status":200,"key":"431109ae","model":"OMK/reasoner","ms":4}
{"level":"info","event":"usage_recorded","request_id":"req_7bb11e6ed43146f099135010ce11bfe4","event_id":"evt_8706f4d3bc985437dfd0f31b","model":"OMK/reasoner","total_tokens":22,"estimated":false,"end_reason":"complete","stream":true}
{"level":"info","event":"request","request_id":"req_99189dbb36014c9eba49eccc0e7aebbe","method":"POST","path":"/v1/chat/completions","status":200,"key":"431109ae","model":"OMK/coder","ms":4}
{"level":"info","event":"usage_recorded","request_id":"req_99189dbb36014c9eba49eccc0e7aebbe","event_id":"evt_8d98be7e52fb314e910de3d0","model":"OMK/coder","total_tokens":18,"estimated":false,"end_reason":"complete","stream":true}
{"level":"info","event":"request","request_id":"req_e553d637a3c144cbb1770c8662a06725","method":"POST","path":"/v1/chat/completions","status":200,"key":"431109ae","model":"OMK/coder","ms":3}
{"level":"info","event":"usage_recorded","request_id":"req_e553d637a3c144cbb1770c8662a06725","event_id":"evt_60a42d39e3e938e831eef997","model":"OMK/coder","total_tokens":22,"estimated":false,"end_reason":"complete","stream":true}
{"level":"info","event":"request","request_id":"req_fbaa8c2f06b64279967781af560df345","method":"POST","path":"/v1/chat/completions","status":200,"key":"431109ae","model":"OMK/coder","ms":3}
{"level":"info","event":"usage_recorded","request_id":"req_fbaa8c2f06b64279967781af560df345","event_id":"evt_691156d7c9c5080cd0e6cdf1","model":"OMK/coder","total_tokens":15,"estimated":false,"end_reason":"complete","stream":true}
{"level":"info","event":"request","request_id":"req_36652cff01cb410588a647cdc2f47fc8","method":"POST","path":"/v1/chat/completions","status":400,"key":"431109ae","model":"OMK/reasoner","ms":1,"code":"thinking_required"}
{"level":"info","event":"request","request_id":"req_b95e1d30d134434eb5ac670766d9226b","method":"POST","path":"/v1/chat/completions","status":401,"key":"8b548793","ms":1,"code":"token_invalid"}
{"level":"info","event":"request","request_id":"req_cdc6af604906419db44012250be7e9af","method":"POST","path":"/v1/chat/completions","status":401,"key":"8b548793","ms":1,"code":"token_invalid"}
```

## Client bugs found

None confirmed in this run.

## Blocked / caveats

- The official client (`openai-completions.ts:517`, and `completeSimple` which wraps `streamSimple`) always sends `stream: true`. Case 1a therefore uses the same token/base URL/model over raw HTTP to exercise the gateway's non-stream JSON mode, and is labeled as such.
- The CLI cannot inject a custom `get_weather` tool (`--tools` only filters built-ins). The tool-call loop was driven through `streamSimple` with a TypeBox `get_weather` tool, which is the fallback T-13 allows.
- A normal client path never sends `thinking: disabled` to `OMK/reasoner` (`route.ts` / the thinking-level map). Case 4b rewrites the payload with `onPayload` so the 400 still travels through the client's HTTP and error path.
- This harness starts the mock stack itself so `usage_events` can be queried from the in-memory PGlite. It is the same modules and bind address as `npm run dev:mock`.
- No push of `feat/omk-gateway-proto`; no commit in the client worktree.

