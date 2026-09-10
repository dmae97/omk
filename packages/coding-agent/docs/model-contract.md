# Model dispatch contracts

This opt-in working-tree feature implements the first execution-contract slice of
[the harness roadmap](../../../ROADMAP.md). It restricts **logical stream dispatch**
and checks the final **Chat Completions model ID and output-limit parameter**.
Other APIs, network destinations, and billable attempts are not fully covered.
It is not a sandbox or a benchmark-integrity attestation.

## CLI

Create a UTF-8 JSON policy, replacing the example identities with the exact
provider and model you intend to use:

```json
{
  "allowedModels": [{ "provider": "your-provider", "id": "exact-model-id" }],
  "allowedProviders": ["your-provider"],
  "allowedAuthOrigins": ["your-provider"],
  "thinking": false,
  "thinkingLevel": "off",
  "maxOutputTokens": 4096
}
```

```bash
omk --provider your-provider --model exact-model-id --thinking off \
  --model-contract ./policy.json -p "Run the requested checks"
```

The flag does not start an extra model call. A normal prompt still calls the
configured provider and may incur cost. `--offline` suppresses startup network
work; it does not prevent prompt inference.

The CLI reads the policy once, before migrations and session creation, and keeps
that snapshot when replacing or resuming sessions within the process. A later
process must supply the flag again. It does not alter settings, credentials,
model selection, or a saved transcript. `--help` does not read the policy.

Missing, unreadable, malformed, non-regular, or oversized files exit with code 1.
Reads are bounded to 64 KiB; invalid UTF-8 and unknown top-level fields are
rejected. Missing flag values and duplicate flags are errors. Both
`--model-contract policy.json` and `--model-contract=policy.json` are accepted.

## SDK

`createAgentSession()` and `createAgentSessionFromServices()` accept an optional
`modelContract` and main-loop `maxTokens`. `Agent` accepts the same options.

```typescript
const { session } = await createAgentSession({
  model,
  thinkingLevel: "off",
  modelContract: {
    allowedModels: [{ provider: model.provider, id: model.id }],
    allowedProviders: [model.provider],
    allowedAuthOrigins: [model.provider],
    thinking: false,
    thinkingLevel: "off",
    maxOutputTokens: 4096,
  },
});
```

`ModelContract`, `RouteRequest`, `ModelContractViolation`,
`snapshotModelContract()`, and `assertModelContract()` are exported by
`omk-agent-core`. No global setting enables this policy implicitly.

The policy is copied and frozen. Each allowlist has 1–64 entries; identities are
exact, bounded strings, not wildcards. Allowed models are provider/ID pairs.
`allowedAuthOrigins` names logical credential resolvers, normally the provider;
it does not authenticate an account or HTTPS origin.

`thinking: false` forbids a requested reasoning level. `thinking: true` permits
reasoning, while optional `thinkingLevel` pins the effective logical level.
An absent level is `off` in the compatibility validator. The runtime supplies
an explicit effective level when checking a request.

Contract and explicit request limits must be positive safe integers. A larger
explicit limit is rejected rather than silently clamped. When a runtime request
omits `maxTokens`, the dispatch boundary supplies the smaller of the contract
cap and model metadata cap. `assertModelContract()` alone retains compatibility
with an omitted limit and does not fill it in.

## Covered paths

- In contract mode, tool-generated images do not trigger automatic vision routing.
  For a text-only selected model, the provider view replaces those image blocks
  with explicit uninspected-image notices and retains the existing text/tool IDs.
  Original session attachments are unchanged. This is not OCR or visual analysis.
  User-provided images still require a permitted vision route; they are not silently
  discarded. A vision-capable selected model and non-contract routing retain their
  existing behavior. The SDK summary stream uses the same projection.
- Core prompt and continuation loops check the automatically selected route
  before resolving its credentials. Policy remains fixed across lifecycle,
  context, auth, and next-turn callbacks.
- The SDK stream checks again before authentication, covering first-party
  compaction and branch-summary calls that use `session.agent.streamFn`.
  An explicitly requested summary cap above the policy is rejected, not reduced.
- For `openai-completions`, the payload hook checks the serialized model ID and
  exactly one defined `max_tokens` or `max_completion_tokens` before HTTP dispatch.
  The cap must be a positive safe integer no larger than the effective logical
  request cap. Missing, ambiguous, enlarged, or invalid limits are refused, even
  without a user hook. Model identity is pinned before asynchronous callbacks.
- Contracted payload hooks may observe detached immutable payload/model data or
  return an equivalent payload. In-place changes and replacements are refused.
  Optional `undefined` payload fields are accepted. Hook-return equivalence is
  conservative JSON serialization equality, not arbitrary semantic equivalence.
  Without a user observer, validation does not clone the conversation; nested
  core/SDK enforcement shares the existing observation boundary.
- Automatic cross-provider vision routing never forwards the source provider's
  static API key, request headers, or model headers. This isolation also applies
  when no contract is configured. Destination credentials must come from the
  destination resolver or the provider's normal credential path.

## Dispatch events

Contracted **core-loop** calls emit:

| Event | Meaning |
| --- | --- |
| `provider_denied` | A logical contract violation or observed cancellation prevented dispatch |
| `provider_request` | The harness entered its stream-function dispatch boundary |
| `provider_request_end` | That dispatch finished, errored, or aborted |

`provider_request.omittedToolImages`, when present, counts tool attachments replaced
in this request's provider view. It does not count visual interpretations or saved
bytes in the session. A core contract denial becomes a non-retryable `configuration`
termination rather than a provider-protocol diagnosis.

`requestId` joins the events. Request and end events identify their boundary as
`stream-dispatch`. Metadata excludes prompts, output, headers, keys, and raw
errors. The end outcome is a transport/lifecycle result, not task correctness;
`completed` does not mean an answer passed a verifier.

A start event can be followed by an error before network transmission, including
an observer or custom-stream error. An abort event does not prove that a remote
request or custom stream has stopped. Auth/context failures before dispatch are
not a complete attempted-request ledger. Summaries using the SDK wrapper are
checked but do not yet emit these core-loop events. Persistence, run/attempt
correlation, HTTP retry accounting, usage and billing joins remain follow-up work.

## Limits and next steps

The Chat Completions check validates the parameter sent by the first-party
adapter, not the provider's interpretation or enforcement of it. Reasoning-token
budgets, remote routing, response model identity, and actual charges still need
separate evidence. Adapters that rewrite model names (for example, adding a
namespace) are rejected by this exact-identity check unless the selected model ID
already equals the transmitted ID.

Other APIs still have only logical checks. For example,
`adjustMaxTokensForThinking()` can add thinking tokens, and the inspected Codex
request builder does not serialize `maxTokens`. Thus this contract is **not a
universal output or billing cap**. A strict single-model benchmark still needs
adapter-specific request provenance. For Model Studio's thinking fields and
separate billing endpoints, see [the provider guide](providers.md#model-studio-deepseek-v4).

Direct `omk-ai` calls, the separate `AgentHarness` family, advisory judges, child
processes, custom streams that replace the SDK wrapper, and arbitrary extension
code do not acquire this policy automatically. Extensions execute with their
existing host permissions; freezing hook arguments does not isolate their code.
Tool permissions, endpoint trust, effect idempotency, deadlines, and semantic
completion still belong to their existing owners.

A fresh build/restart is required to use source changes in an installed CLI.
This implementation work did not build, install, deploy, change active settings,
or run a paid benchmark. See [the boundary redesign](harness-boundaries.md) and
ROADMAP §15 for dated evidence, limitations, and the remaining architecture work.
