# Grok harness

This page is the project-local operator guide for running OMK with the xAI OAuth proxy. The canonical Grok playbook remains `~/.omk/agent/grok.md`; keep this page as a short routing and preset reference, not a duplicate source of truth.

## Presets

Project presets live in `.omk/presets.json` and are consumed by the preset extension from `packages/coding-agent/examples/extensions/preset.ts`. The shared Grok presets intentionally omit the `tools` key so role/domain lane grants keep control of the active tools.

| Preset | Provider | Model | Thinking | Use |
| --- | --- | --- | --- | --- |
| `grok-verified` | `grok-oauth-proxy` | `grok-4.5` | `high` | Default Grok text-chat baseline (local OAuth proxy). |
| `grok-adaptorch-prod` | `grok-oauth-proxy` | `grok-4.5` | `high` | Same baseline, with AdaptOrch reserved for explicit DAG routing, synthesis, or consistency-verification lanes. |

Register the provider in `~/.omk/agent/models.json` with `baseUrl: http://127.0.0.1:9996/v1` and chat models including `grok-4.5` (and optional fallbacks such as `grok-4.3`). Loopback proxy accepts a dummy `apiKey`; do not put OAuth tokens in models.json. Confirm proxy health with `curl -fsS http://127.0.0.1:9996/health` before long sessions.

Suggested TUI flow:

1. Run `/grok` to inject the pointer to `~/.omk/agent/grok.md`.
2. Select `/preset grok-verified` for normal chat/coding work.
3. Select `/preset grok-adaptorch-prod` only when the task has an explicit DAG, routing, or synthesis objective.
4. Keep credentials and OAuth material out of preset JSON.

## Domain routing

Domain routing is opt-in. Start OMK with `OMK_DOMAIN_ROUTING=1` when you want the domain router to compose the role loadout with a domain profile before dispatch. With the variable unset or any value other than `1`, the domain dispatch layer does not apply a domain access policy.

The router selects one of the documented domain profiles under [`loadout-domains/`](loadout-domains/README.md), then composes that profile with the active role loadout. Grok presets do not replace this mechanism; they only set provider, model, thinking level, and instruction pointers.

## Composer model

`grok-composer-2.5-fast` is a valid Grok chat model, but the project presets keep `grok-4.5` as the default. Use Composer only for explicit Composer validation or comparison work. `grok-4.3` remains a supported fallback chat model. Do not use `grok-imagine-*` ids as chat models; session `setModel` / `prompt` reject them on `grok-oauth-proxy`.

## Imagine tools

Imagine media generation is tool-based, not model-selection-based:

| Task | OMK tool |
| --- | --- |
| Text-to-image, image edits, restyles | `grok_imagine_image` |
| Text-to-video or image-to-video | `grok_imagine_video` |

Do not select `grok-imagine-image`, `grok-imagine-image-quality`, `grok-imagine-video`, or similar Imagine ids as the chat model. For media tasks, require tool output evidence such as the final saved path or URL before claiming success.

## Skill and MCP matrix summary

Use the normal OMK lane grant model: grant the smallest skill and MCP surface that matches the task, and keep media exceptions explicit.

| Task class | Skills | MCP |
| --- | --- | --- |
| Multi-package or repo-context work | `packages`; add `headroom` only under context pressure | none by default |
| Repo graph or broad comprehension | `understand-anything`; optionally `packages` | `understand-anything` |
| DAG planning or synthesis | `adaptorch` / `adaptorch-route` / `adaptorch-synthesize` | `adaptorch` |
| TypeScript/Rust/Python/Go edits | `programming`; add `lsp` or `ast-grep` only for symbol/structural work | none by default |
| Runtime failures or broken behavior | `debugging` | task-specific only |
| UI/TUI verification | `visual-qa` | `playwright` only when browser/UI evidence is required |
| Current public URL or docs lookup | task skill as needed | `fetch` |
| Image prompts or media generation | explicit-only `image-prompt`, `omnigen-vault`, or `gpt-image-2-prompts` | none by default |

Relevant evidence hooks for Grok lanes are `pre-shell-guard`, `protect-secrets`, `typecheck-after-edit`, and `stop-verify`. Hook output is incremental evidence; code changes still need the project's required final verification command before claiming type/lint cleanliness.

## Canonical reference

For proxy health checks, chat model rules, Imagine tool behavior, Hermes parity, Telegram behavior, and unsafe `GROK.MD` handling, read `~/.omk/agent/grok.md`.
