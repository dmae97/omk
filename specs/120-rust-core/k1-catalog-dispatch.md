# K1 catalog and explicit authenticated Anthropic dispatch

Date: 2026-11-17
Status: implemented and locally verified bounded unit. K1 and the full migration remain open.

## Scope and owners

The unpublished `native/omk-providers` crate embeds the public Node catalog and consumes
host-supplied models.json/credential/environment snapshots. It composes the existing
request converter, credential resolver, HTTP transport and incremental stream. It does
not replace the installed Node provider host or introduce another parser or agent loop.
No dependency, lockfile, notice, launcher, settings, credential file or installed engine
changes are part of this unit. J2/B1 dependency and distribution requirements still apply.

Sources: `packages/ai/src/models.ts`, generated catalog and Grok thinking owner;
`packages/coding-agent/src/core/model-registry.ts`, schema and JSON parser;
`packages/ai/src/providers/anthropic.ts`, compatibility helpers and SDK;
`packages/coding-agent/src/core/provider-request-key.ts` and existing auth owners.
The frozen fixtures include source SHA-256 provenance. Root MIT licensing and the existing
native notices remain applicable; the generated catalog is public project data.

## Independent expectations and behavioral evidence

- Before Rust catalog implementation, the real Node `getModels`, `ModelRegistry` and
  `AuthStorage` recorded 2,245 builtin models and 16 models.json overlay scenarios.
- Before dispatch implementation, real Node `streamAnthropic` and the Anthropic SDK
  recorded 10 authenticated requests using synthetic credentials and in-memory fetch.
- Recorder subprocesses have isolated HOME/config/environment. Network fetch is replaced
  with a synthetic URL-only recorder, never a provider. Creation is exclusive; `--check`
  compares without rewriting. Rust receives inputs, not expected answers.
- Compiled catalog RED recorded 28 library/executable mismatches; compiled dispatch RED
  refused the catalog model with `UnknownModel`. Both were followed by focused GREEN.
- Catalog scenarios compare total/model order/metadata/availability in library and CLI.
  They cover custom defaults, builtin inheritance/replacement, duplicate IDs, provider and
  model overrides, partial costs, compatibility, headers, visibility, retired provider,
  invalid JSON/schema and missing custom API/auth configuration.
- Every dispatch case traverses real numeric-loopback HTTP through the library and
  executable. Serialized SDK body bytes and non-runtime headers match. Semantic events,
  final content and token usage match; runtime SDK headers, mutable snapshots, timestamps
  and monetary costs are explicitly excluded.
- A real CLI/server handshake withholds later response bytes until flushed `text_delta`
  is observed. A separate library test cancels at that event, retains partial content and
  observes socket closure. These are not helper-only or whole-response-buffer tests.
- HTTP failures with empty/nonempty bodies produce one terminal error, no retry and no
  echoed secret. Auth/header/catalog refusal and CLI limits are tested before dispatch.

## API and security boundaries

`Catalog::load` uses embedded builtins and optional overlay text bounded at 1 MiB.
Provider order follows Node integer-key/insertion order. Invalid overlays retain builtin
inspection but prohibit dispatch. Explicit invalid visibility blocks availability, including
commented/trailing-comma input. Authenticated provider IDs are host-supplied, not inferred.
Frozen catalog loading does not implement filesystem discovery, refresh, legacy migration,
dynamic provider registration or OAuth-driven model mutation.

`dispatch::prepare` accepts the chosen catalog/provider, request input, credential snapshot,
`KeySources` and explicit environment lookup. Model-config fallback is used only when the
host enables `include_fallback`; an explicit supplied fallback takes precedence. Empty or
unresolved stored keys and malformed/unreadable stores do not switch accounts. This
fail-closed boundary is stricter than any higher-level Node models.json substitution after
an unresolved stored key; the positive dispatch recordings do not claim that error-policy
parity. Commands and stored OAuth still require unimplemented host ownership. Bearer OAuth
token strings and special Copilot/Cloudflare/Kimi client paths are refused.

`Prepared` cannot be Debug/Serialize. Header values are marked sensitive; header/framing
and endpoint validation retain the transport boundary. Raw provider error bytes are not
returned as diagnostics. User content is necessarily present in successful response events.
The host owns output handling and must not log request headers/credential snapshots.

This adapter is explicit single-attempt, API-key, no-cache Anthropic dispatch. It supports
recorded eager-tool/beta headers and configured header precedence. Request vision follows
catalog capability, but vision-response parity is unproven. New thinking/temperature/cache,
retry policies, cross-provider histories and all other API dispatchers remain outstanding.
Callbacks must return promptly; cancellation cannot preempt synchronous callbacks/output.

`provider catalog` and `provider stream` are explicit stdin interfaces, not installed
product commands. Input is bounded at 2 MiB and unknown fields fail closed. Stream emits
flushed `{event: ...}` lines followed by `{result: ...}`. Its protocol exit status alone is
not provider success; callers inspect the terminal event/result. It consumes only supplied
snapshot values, including a supplied provider-selected environment key. It does not read
ambient keys/auth files, refresh OAuth, execute commands or choose an installed engine.

## Verification

Private evidence: `/mnt/omkdata/tmp/omk-k1-dispatch-NN8uZtix`.
The immutable baseline predates this unit. `verify.py` records argv/cwd/exit/duration and
compares HEAD, complete staged binary-diff digest and every Git-visible path to that
baseline, allowing only this unit's explicit paths. Prior corpora remain unchanged.

Observed checks:

- Cargo offline/locked tests: 54 passed, zero failed/ignored, including prior regressions.
- Cargo check, fmt and all-target Clippy with warnings denied: exit 0.
- Strict recorder TypeScript: exit 0.
- Nine Node regression files: 18 passed, zero failed/skipped, including both fresh oracles.
- `npm run check`: exit 0, 269.711 seconds; script tests 747 total, 717 passed,
  30 skipped, zero failed. This is not full product Vitest or platform acceptance.
- Initial formatting and one Clippy collapsible-if failure remain recorded; fixed locally.
- Active LSP: 11 paths, three confirmed clean, six inconclusive, two with five auxiliary
  ast-grep findings. Synthetic URL literals and recorder-style hints are retained; this is
  not an all-clean LSP claim. Strict recorder TypeScript and Rust compiler gates passed.

No live credentials/provider inference, external networking in parity tests, TLS/proxy/root
store acceptance, macOS/Windows acceptance, installation, commit, push or publication.
Performance, memory and cost superiority are not measured. Remaining K1 and later migration
gates retain their original scope in [spec.md](spec.md) and [tasks.md](tasks.md).
