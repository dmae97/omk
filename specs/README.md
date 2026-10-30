# OMK Specifications

`specs/constitution.md` and `specs/templates/` govern new work. Feature specs
record a point-in-time intent; source, tests, and release tags determine current
runtime behavior.

## Status terms

- **Released** — present in a reachable release tag.
- **Worktree-only** — implemented or documented locally but not committed or released.
- **Active** — still governs current work.
- **Historical** — completed record; unchecked task boxes are not current backlog.
- **Superseded** — replaced by a later algorithm or spec.
- **Missing identifier** — the number has no tracked spec and is not an implied task.

## Current index

| ID | Specification | Current status |
| --- | --- | --- |
| 001 | [Think command routing](001-think-command-routing/spec.md) | Historical; implemented and released |
| 002 | [OMK v0.90.2 full upgrade](002-omk-v0902-full-upgrade/spec.md) | Historical release operation |
| 003 | [Reasoning-effort router](003-reasoning-effort-router/spec.md) | Superseded by the released v4 router |
| 004 | [Reasoning router v2](004-reasoning-router-v2/spec.md) | Superseded by the released v4 router |
| 005 | — | Missing identifier |
| 006 | [Reasoning-router accuracy boost](006-reasoning-router-accuracy-boost/spec.md) | Historical v3 work; superseded by v4 |
| 007 | — | Missing identifier |
| 008 | [Reasoning-router advanced accuracy](008-reasoning-router-advanced-accuracy/spec.md) | Historical v4 implementation record; v4 is released |
| 009 | [Headroom upgrade](009-headroom-github-main-0290-upgrade/spec.md) | Historical machine-local upgrade operation |
| 010 | [v0.90.6 release alignment](010-omk-v0906-release-alignment/spec.md) | Historical completed alignment |
| 011 | [GPT-5.6 MoA and Ultra fix](011-gpt56-moa-ultra-fix/spec.md) | Released |
| 012 | [Harness Graph engineering](012-harness-graph-engineering/spec.md) | Active repository-maintenance tooling; not default CLI orchestration |
| 013 | [Command safety, attachments, and resilience](013-command-safety-attachment-resilience/spec.md) | Released in `v0.97.0` |
| 014 | [Repository-understanding wiki](014-repository-understanding-wiki/spec.md) | Policy/workflow in v0.97.0; integrity/output guards in v0.98.0; no bundled corpus |
| 015 | [Runtime algorithms and direction](015-runtime-algorithm-direction/spec.md) | Active documentation and governance sync |
| 016 | [Terminal settlement notification](016-terminal-settlement-notification/spec.md) | Released in v0.98.0 |
| 017 | [Resource promotion evidence](017-resource-promotion-evidence/spec.md) | Report released in v0.98.0; adaptive-default promotion remains blocked |
| 018 | [Type-aware compaction](018-type-aware-compaction/spec.md) | Explicit-rule default-compactor slice released in v0.98.0 |
| 019 | [Cross-session verified memory](019-cross-session-verified-memory/spec.md) | Full automatic memory proposed and promotion-blocked; explicit source-quote slice is documented separately |
| 020 | [Live lane and shard authority](020-live-lane-shard-authority/spec.md) | Proposed; implementation blocked on canonical production caller |
| 021 | [Advisory selection integrity](021-advisory-selection-integrity/spec.md) | v0.98.3 opt-in SDK; no automatic TUI judge |

## Point-in-time specification inventory

The following rows complete the file inventory, not a current-runtime certification.
Their original draft, implementation, and review statements are historical evidence.
Check current source, tests, release tags, and the harness quality review before
using one as a statement about the present runtime.

| ID | Specification |
| --- | --- |
| 022 | [TUI chat transcript windowing](022-tui-chat-windowing/spec.md) |
| 024 | [Lazy interactive mode and TUI-only tool render](024-lazy-interactive-mode/spec.md) |
| 026 | [Event-boundary rule for finished messages](026-message-settled/spec.md) |
| 028 | [Dash-led inline print prompt](028-print-prompt-dash/spec.md) |
| 029 | [Terminal-Bench 2.1 result in the README](029-readme-tb21-benchmark/spec.md) |
| 030 | [Lazy undici install](030-lazy-undici-fetch/spec.md) |
| 031 | [No remote answer lookup in headless runs](031-no-remote-answer-lookup/spec.md) |
| 032 | [Fresh-context re-verification for early finishes](032-fresh-context-reverify/spec.md) |
| 033 | [Per-response reasoning cap](033-response-reasoning-cap/spec.md) |
| 034 | [Deliverable watchdog and last-good copy](034-deliverable-guard/spec.md) |
| 035 | [Finish-check threshold refusal](035-finish-check-threshold-refusal/spec.md) |
| 036 | [Shared run-budget clock and bash timeout clamp](036-run-budget-clock/spec.md) |
| 037 | [Adaptive reasoning effort](037-adaptive-effort/spec.md) |
| 039 | [Drop pi-ask-user from Pi package intake](039-drop-pi-ask-user/spec.md) |
| 041 | [Verified-memory record size check](041-memory-record-grow-check/spec.md) |
| 042 | [Shared run log directory](042-run-log-dir/spec.md) |
| 043 | [Worker startup module diet](043-worker-startup-diet/spec.md) |
| 045 | [TUI scrollback loss on resize](045-tui-scrollback-loss/spec.md) |
| 046 | [Headroom version probe off the render path](046-headroom-probe-off-render/spec.md) |
| 047 | [Browser control over WebDriver BiDi](047-browser-bidi/spec.md) |
| 048 | [Pi package and extension compatibility](048-pi-compat/spec.md) |
| 049 | [Typed todos and finish-check verification](049-todos-typed-verify/spec.md) |
| 050 | [Task and todo skill selection](050-skill-selection/spec.md) |
| 051 | [Prompt-cache prefix stability guard](051-prompt-cache-stability/spec.md) |
| 052 | [Cache boundary with appended system-prompt text](052-cache-boundary-prefix/spec.md) |
| 053 | [Install-script and project trust gate](053-install-safety-trust-gate/spec.md) |
| 056 | [Journal reads during a live writer](056-journal-read-retry/spec.md) |
| 057 | [Workers do not load user extensions](057-worker-no-extensions/spec.md) |
| 058 | [Skill selection modes](058-skill-select-modes/spec.md) |
| 059 | [Per-request LLM call log](059-llm-call-log/spec.md) |
| 061 | [Oversized tool-output hang](061-oversized-output-hang/spec.md) |
| 062 | [UI lag measurement and token-estimate cache](062-ui-lag/spec.md) |
| 063 | [Model registry refresh cache](063-model-refresh-cache/spec.md) |
| 065 | [Opt-in per-phase timing log](065-debug-timing/spec.md) |
| 066 | [MCP tool-output truncation](066-tool-output-truncation/spec.md) |
| 071 | [Subagent runtime](071-subagent-runtime/spec.md) |
| 076 | [Bash correctness](076-bash-correctness/spec.md) |
| 088 | [Concurrent journal reads](088-journal-concurrent-read/spec.md) |
| 090 | [No same-route retry after quota exhaustion](090-quota-no-retry/spec.md) |
| 091 | [Next-task suggestions and Jev skill selection](091-next-suggestions/spec.md) |
| 092 | [Skill candidates from the hub router](092-hub-router-skills/spec.md) |
| 093 | [`/jev` TypeSafe key command](093-jev-key/spec.md) |
| 094 | [Acceptance-failure diagnostics](094-acceptance-diagnostics/spec.md) |
| 095 | [Two-window diagnostic excerpt](095-excerpt-two-window/spec.md) |
| 096 | [Fact-based common task-result projection](096-task-result-projection/spec.md) |
| 097 | [Acceptance-diagnostic excerpt v3](097-excerpt-v3/spec.md) |
| 098 | [Raw-output recall for failing acceptance checks](098-output-recall/spec.md) |
| 099 | [Acceptance contract revision](099-acceptance-contract-revision/spec.md) |
| 100 | [Real task-result producer wiring](100-task-result-producer/spec.md) |
| 102 | [Stable cache boundary with a changing dynamic tail](102-prefix-boundary/spec.md) |
| 103 | [Next-suggestion caps, settlement, and cache capability](103-next-suggestion-budget/spec.md) |
| 103b | [Per-cap hit counts in the next-suggestion trace](103b-cap-hit-trace/spec.md) |
| 104 | [Required-tool admission and compaction cost observation](104-required-capability-admission/spec.md) |
| 105 | [Next-suggestion Tab acceptance measurement](105-next-suggestion-accept/spec.md) |
| 106 | [Session skill admission, goal autonomy, lane failure isolation, and evidence lifecycle](106-session-autonomy-dag-evidence/spec.md) |
| 107 | [New-only diagnostics after edit and write](107-edit-diagnostics/spec.md) |
| 108 | [Pi decoupling](108-pi-decoupling/spec.md) |
| 109 | [Single-binary distribution](109-binary/spec.md) |
| 110 | [ATIF trajectory export](110-atif-export/spec.md) |
| 111 | [Finish-confirmation gate](111-finish-confirm/spec.md) |
| 112 | [Session information in JSON mode](112-json-session-info/spec.md) |
| 113 | [Head and tail bash output with a middle marker](113-exec-truncate-middle/spec.md) |
| 114 | [Unique-only indentation-tolerant edit matching](114-edit-fuzzy-match/spec.md) |
| 115 | [Whole-file write stale guard](115-write-stale-guard/spec.md) |
| 116 | [Compaction comparison and default-off candidates](116-compaction-compare/spec.md) |
| 117 | [Skill auto-selection and body load](117-skill-auto-load/spec.md) |
| 118 | [Evidence delete-after-use](118-evidence-delete/spec.md) |
| 119 | [Goal autonomy](119-goal-autonomy/spec.md) |

Additional records:

- [Project Context Bootstrap](015-project-context-bootstrap/spec.md), an earlier spec sharing identifier 015.
- [Behavior-neutral AgentSession split](agent-session-split/spec.md), an unnumbered structural proposal.
- Missing identifiers: 023, 025, 027, 038, 040, 044, 054, 055, 060, 064, 067–070,
  072–075, 077–087, 089, and 101. Missing numbers are not implied backlog items.

## Spec Kitty status, 2026-10-30

Spec Kitty CLI and `.kittify/metadata.yaml` are at 3.2.7. The upgrade agent check
reported `action: none` and `reason: up_to_date`. Mission lifecycle artifacts under
`kitty-specs/` are separate from this point-in-time specification inventory.

The existing `attachment-preview-memory-operational-01M45JAP` mission remains an
approved historical delivery, not the owner of the 2026-10-30 harness review.
No new mission was minted for that review because Spec Kitty 3.2.7 always commits
the mission scaffold and the review did not include commit authorization.

## Current direction

Spec 015 is the entry point for algorithm maturity and direction. The current
verification baseline is [Harness quality review, 2026-10-30](../packages/coding-agent/docs/harness-improvements.md).
Separate delivery, activation, and evidence labels prevent an internal mechanism or
passing local test from being mistaken for a shipped live path.

Historical `plan.md` and `tasks.md` files remain evidence of their original cycle.
Do not reopen them merely because a checkbox is blank; create or update a current
spec with a versioned baseline and measurable acceptance gate instead.
