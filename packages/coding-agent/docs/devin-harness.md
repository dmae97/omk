# Devin SWE-2 harness

This page is the canonical operator guide for the built-in `devin` provider and its only logical model, `swe-2`. Use `/login devin` for the Devin CLI subscription PKCE flow or `DEVIN_API_KEY` for an already-owned CLI session token. A user-local `~/.omk/agent/devin.md` may add operator notes, but it is not the portable product contract.

Authentication, transport, and verification limits are owned by [Providers](providers.md#devin-cli); this page covers how OMK drives SWE-2 as a harness.

## Presets

Project presets live in `.omk/presets.json` (or `~/.omk/agent/presets.json`) and are consumed by the preset extension from `packages/coding-agent/examples/extensions/preset.ts`. The shared SWE-2 presets intentionally omit the `tools` key so role/domain lane grants keep control of the active tools.

| Preset | Provider | Model | Thinking | Use |
| --- | --- | --- | --- | --- |
| `swe2-verified` | `devin` | `swe-2` | `high` | Default SWE-2 coding baseline: multi-file edits with tests. |
| `swe2-max` | `devin` | `swe-2` | `max` | Long-horizon, uncertain, or repository-wide work that should use the 1M budget. |
| `swe2-fast-edit` | `devin` | `swe-2` | `medium` | Small, well-specified edits where medium acts sooner and costs less. |

```json
{
  "swe2-verified": { "provider": "devin", "model": "swe-2", "thinkingLevel": "high" },
  "swe2-max": { "provider": "devin", "model": "swe-2", "thinkingLevel": "max" },
  "swe2-fast-edit": { "provider": "devin", "model": "swe-2", "thinkingLevel": "medium" }
}
```

For a new session without presets:

```bash
omk --provider devin --model swe-2 --thinking max
```

## Effort tiers

SWE-2 exposes exactly three server-declared efforts. OMK maps its thinking tiers as follows and rejects anything else before sending credentials; `max` is a reasoning level, not the Devin Max subscription tier.

| OMK tier | `swe-2` |
| --- | --- |
| `off`, `minimal`, `low` | unavailable |
| `medium` | `medium` |
| `high` | `high` |
| `xhigh`, `ultra` | unavailable |
| `max` | `max` |

Guidance from the [SWE-2 announcement](https://cognition.com/blog/swe-2): `medium` makes its first real edit sooner and is the cost-efficient choice for simple and intermediate tasks; `high` and `max` plan more, explore more of the codebase, and verify more on complex tasks. `recommendedDevinEffortForIntent()` encodes the same split (`code` → `medium`, `test` → `high`, `debug`/`repo` → `max`).

## Context budget: 1,000,000 tokens

`devin/swe-2` ships with `contextWindow: 1000000` and `maxTokens: 16384`. These are local budgets that drive OMK's context budgeting and compaction, **not published SWE-2 limits**; Cognition has not published a context window for SWE-2. The budget also selects the catalog lane:

1. Before each turn OMK reads `GetCliModelConfigs`. SWE-2 family entries may carry a `1M Context` axis (order `1`) beside the effort axis. A local budget of 1,000,000 or more asks for that 1M-context lane; below it, the standard lane is used and 1M entries are ignored.
2. A catalog with no 1M-context lane keeps the standard lane for the selected effort.
3. If the chosen lane declares a context window smaller than the local budget, the request fails with `... declares a N-token context window; lower the models.json contextWindow before retrying`. OMK never shrinks the budget silently, never invents a wire UID, and never downgrades to another effort.
4. Fast-lane (`Fast Mode`) entries are always excluded. Output is capped against the authenticated catalog's declared maximum.

To lower the budget (for example if your account only serves the standard lane at 262,144 tokens), override the built-in model in `~/.omk/agent/models.json`:

```json
{
  "providers": {
    "devin": {
      "modelOverrides": {
        "swe-2": { "contextWindow": 262144 }
      }
    }
  }
}
```

Recommended compaction settings for 1M sessions keep the defaults but raise the recent-token window so summaries do not discard the working set:

```json
{
  "compaction": { "enabled": true, "reserveTokens": 16384, "keepRecentTokens": 60000, "maxUsageRatio": 0.85 }
}
```

Context discipline still applies: the budget is room for the repository, not an invitation to dump it. Prefer targeted reads and searches, keep tool output bounded, and let `precompact-checkpoint` snapshot state before compaction rather than restarting sessions. Quota is per account; a larger window consumes more of it per turn.

With a Devin credential configured, the status rail's USAGE section shows the account's daily and weekly quota meters from `GetUserStatus` (or the plan name and credit balances when the plan reports no quota windows), matching the CLI's `/usage` surface.

## Domain routing

Selecting the `devin` provider auto-applies the `devin-harness` loadout by default; this does not require `OMK_DOMAIN_ROUTING=1`. Set `OMK_DEVIN_HARNESS=0` to disable that provider-specific dispatch. The flag is independent from `OMK_GROK_HARNESS`.

Loadout policies reject extension tools that shadow builtins fail-closed. A host that intentionally replaces the builtin `bash` (for example a Landstrip shell provider) should keep `OMK_DEVIN_HARNESS=0` in its launcher until the replacement is removed or bridged; the `devin.md` overlay and the model budget still apply in that case.

General prompt-based domain routing is separate and opt-in through `OMK_DOMAIN_ROUTING=1`. It selects one of the profiles under [`loadout-domains/`](loadout-domains/README.md) and composes it with the active role loadout. SWE-2 presets only set provider, model, thinking level, and instruction pointers.

## Model selection

The `devin` catalog contains only the logical `swe-2` model; the server's SWE-2 family metadata supplies each effort's wire UID at request time. Use `/model` or `omk --list-models devin` for the current list. Image input is unsupported; provide text.

## Skill and MCP matrix summary

Use the normal OMK lane grant model: grant the smallest skill and MCP surface that matches the task.

For each non-queued `devin` request started through `AgentSession.prompt()`, OMK calls `selectDevinHarnessSkills()` against the live discovered skill descriptions after ordinary prompt-template expansion. It merges up to three matches with explicit/settings selections and rebuilds that turn's `<active_skills source="devin-harness">` marker. The scorer is the same `selectSkills()` used by the Grok harness: weak 0.35 / strong 0.7 thresholds, deterministic input-order ties, first-name-wins deduplication, explicit-only skills never auto-selected, and `headroom` only for lexical pressure cues or the session's measured context-pressure bucket. A task with no signals yields an empty automatic grant rather than the full allowlist. Queued `steer`, `followUp`, or `prompt(..., { streamingBehavior })` messages retain the active run's system prompt.

| Task class | Skills | MCP |
| --- | --- | --- |
| Multi-package or repo-context work | `packages`; add `headroom` only under context pressure | none by default |
| Repo graph or broad comprehension | `understand-anything`; optionally `packages` | `understand-anything` |
| TypeScript/Rust/Python/Go edits | `programming`; add `lsp` or `ast-grep` only for symbol/structural work | none by default |
| New behavior or bug fix with regression test | `tdd-workflow`, `programming` | none by default |
| Runtime failures or broken behavior | `debugging` | task-specific only |
| Library API lookup | task skill as needed | `context7` |
| Current public URL or docs lookup | task skill as needed | `fetch` |
| UI/TUI verification | task skill as needed | `playwright` only when browser/UI evidence is required |

Relevant evidence hooks for SWE-2 lanes are `pre-shell-guard`, `protect-secrets`, `typecheck-after-edit`, `stop-verify`, `session-context`, and `precompact-checkpoint`. Hook output is incremental evidence; code changes still need the project's required final verification command before claiming type/lint cleanliness.

## Suggested TUI flow

1. Run `/login devin` once; the account picker stores the CLI session token in `auth.json`.
2. Select `/preset swe2-verified` for normal coding work, `/preset swe2-max` for long-horizon or repository-wide tasks, and `/preset swe2-fast-edit` for small edits.
3. Use `/think medium`, `/think high`, or `/think max` to change effort mid-session; other levels are rejected.
4. If a turn fails with an "unavailable or ambiguous" route or a smaller declared context window, treat it as a configuration signal: check `devin models list`, or lower `contextWindow` as shown above. Do not retry with a guessed wire UID.
5. Keep credentials out of preset JSON, prompts, and logs: the session token, the exchanged user JWT, and `auth.json` contents are secrets under `protect-secrets`.

## Local overlay

When the `devin` provider is active, OMK appends `~/.omk/agent/devin.md` (capped at 24,000 characters) to the system prompt, mirroring the Grok `grok.md` overlay. Treat that file as optional host configuration for effort defaults, compaction notes, or team conventions; this page and the current provider documentation remain authoritative and it cannot override higher-priority instructions.
