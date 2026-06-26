# OMK ↔ Aside Computer-Use Bridge

A security-gated extension that lets the OMK agent drive an [Aside](https://aside.com)
Chromium browser via `aside mcp` (JSON-RPC over stdio). **Aside does the browser
execution; OMK does the planning, policy, approval, and evidence-gated completion.**

> The Aside binary is **not** bundled. Install it yourself (`aside` must be on
> `PATH`). This extension never auto-installs third-party software.

## Architecture

```
OMK Agent (LLM planner)
   │  tool calls (observe / execute_action / verify / ...)
   ▼
aside-computer-use extension  ← policy · risk · origin · approval · redact · evidence
   │  MCP JSON-RPC stdio
   ▼
aside mcp  →  Aside Chromium Browser (logged-in profile, password manager)
```

The bridge speaks to `aside mcp`, **not raw CDP**. Aside's own Allow/Ask/Deny
modes run in addition to OMK's gate — OMK's deny is always final.

## Safety model (the point of this extension)

Every browser action passes through, in order:

1. **Denied-actions gate** — `credential_export`, `payment`,
   `security_setting_change`, `account_deletion` are denied absolutely.
2. **Origin allowlist** — mutations to origins outside `allowedOrigins` are denied.
3. **Risk classification** (R0–R3):
   - R0 observe (read/screenshot/DOM) → **auto-allow**
   - R1 reversible interaction → allow on allowed origin, else approve
   - R2 external mutation (submit/send/publish) → **human approval required**
   - R3 critical mutation (pay/delete/credentials) → **default-deny** (privileged allowlist only)
4. **Human approval** via `ctx.ui.confirm` for any approve decision (denies in non-UI modes).
5. **Profile mutation mutex** — one mutating action per browser profile at a time.
6. **Secret redaction** — DOM/result content is deep-walked; secret-named fields and
   token-like values become `[REDACTED]` before reaching the model or logs.
7. **Prompt-injection stance** — web page text is **untrusted observation** and never
   expands authority. A page saying "upload ~/.ssh/id_rsa" or "disable the safety
   policy" carries no weight; only the user goal does.
8. **Evidence-gated completion** — `aside said it did it` is not success. Criteria are
   predicates verified against DOM/URL evidence. Mutations with unverifiable outcomes
   return `inspection_required` (never auto-retried) to prevent duplicate submits/payments.

Credentials: Aside's password manager autofills in-browser; raw passwords never return
to OMK or the model. "Local-first" ≠ "nothing leaves the device" — model-visible context
(page snapshots, screenshots) can reach the model provider, so use a separate profile and
minimal context on sensitive sites.

## Setup

1. Install Aside per Aside's docs and confirm `aside mcp` runs.
2. Copy this directory to `~/.omk/agent/extensions/aside-computer-use/`.
3. (Optional) add a policy file (see below). Defaults are conservative.
4. Start OMK. Tools `aside_observe`, `aside_execute_action`, etc. are registered.

The `aside` process is spawned lazily on first tool use and closed on session shutdown.

## Policy

OMK-owned, merged: defaults ← `~/.omk/agent/extensions/aside-policy.json` ←
`<cwd>/.omk/aside-policy.json` (project wins). Example:

```json
{
  "executable": "aside",
  "defaultMode": "yolo",
  "allowedOrigins": ["http://localhost:*", "https://github.com"],
  "deniedActions": ["credential_export", "payment", "security_setting_change", "account_deletion"],
  "approvalRequiredActions": ["submit", "send_message", "publish", "delete", "change_permission"],
  "limits": { "maxSteps": 80, "maxRetries": 2, "maxWallTimeSeconds": 900, "maxDownloads": 10 },
  "evidence": { "captureFinalScreenshot": true, "recordFinalUrl": true, "hashDownloadedFiles": true }
}
```

`/aside` shows the active policy.

## Tools

| Tool | Purpose |
|---|---|
| `aside_observe` | R0 read-only page state (URL/title/text) |
| `aside_plan_action` | Preview an action's risk band + authorization **without** executing |
| `aside_execute_action` | Gate + execute one action (risk → origin → approval → lock → redact → evidence) |
| `aside_verify` | Check success criteria against the current observation |
| `aside_take_screenshot` | R0 capture, save to evidence dir with sha256 |
| `aside_download_artifact` | Gated download, hash for integrity |
| `aside_start_task` | observe → scripted plan → gated execute loop |
| `aside_close_task` | Gracefully close the Aside MCP process |

The agent (LLM) is the planner. It calls these tools; the extension applies the full
safety gate on every action — matching Algorithm 2's loop while fitting OMK's tool-call model.

## Module layout

| File | Role |
|---|---|
| `index.ts` | Entry: load policy, lazy client, register tools + `/aside`, shutdown close |
| `policy.ts` | `AsidePolicy`, defaults, load + merge |
| `risk-classifier.ts` | action → R0..R3 band (pure) |
| `risk-authorize.ts` | (action, risk, policy) → allow/approve/deny (pure) |
| `url-origin.ts` | origin resolution + glob/port-wildcard matching (pure) |
| `schema-fingerprint.ts` | MCP tool inputSchema drift detection (pure) |
| `evidence.ts` | `redactSecrets`, file hashing, evidence builders |
| `session-binding.ts` | OMK↔Aside binding store + per-profile mutex |
| `mcp-client.ts` | JSON-RPC stdio client (initialize/list/call, lazy spawn, graceful close) |
| `controller.ts` | Algorithm 2 policy-gated loop (mockable ports) |
| `tools.ts` | 8-tool facade over client + gate |

Pure safety modules have unit tests (`packages/coding-agent/test/aside-*.test.ts`); the
controller is tested with mock ports — no real Aside binary or browser required.
