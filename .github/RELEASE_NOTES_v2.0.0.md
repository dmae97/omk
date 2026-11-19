# OMK v2.0.0

OMK 2.0.0 is a declared milestone release. The owner declared the `2.0.0`
milestone on 2026-11-14, which the constitution requires before a release may
cross the major boundary (`OMK_ALLOW_MAJOR_RELEASE=1`). It does not reopen
routine major bumps: later releases go back to `patch` and `minor`.

The headline change is that OMK now loads native `omk` package manifests by
default. Legacy Pi packages still work, but only when you opt in.

## Breaking change: native package manifests by default

The default package manifest dialect is now `omk`. Extensions that import
legacy Pi packages without installing them, and packages that ship only a `pi`
manifest, no longer load by default. To keep loading them:

- CLI: `--package-manifest-dialect omk+pi`
- SDK: `packageManifestDialect: "omk+pi"` in the constructor options

The load error names this option, and `omk package doctor` checks against the
native target by default. See
[the OMK 2 migration notes](https://github.com/dmae97/omk/blob/main/packages/coding-agent/docs/omk-2-migration.md#native-default-2026-11-08).

## Added

- `omk-speak-like-you-eat` is a new optional package adapting SLYE 1.6.1: manual
  and automatic plain-language companions, ELI5 and Light tabs, scoped model
  selection, trusted project settings, custom prompts, cancellation and retry.
  Install it with `omk install npm:omk-speak-like-you-eat@2.0.0`.
- Extensions can render persisted custom entries with `registerEntryRenderer()`
  without adding them to the model's context, and extension contexts expose
  session-scoped models.
- Next-task suggestions (`OMK_NEXT_SUGGESTIONS`, flag, default off) show a
  complete prompt in the empty editor: a title, then input, verification,
  evidence and result sections. Tab inserts exactly the displayed text.
- `Editor.setInlineSuggestion()` in `omk-tui` renders a dim suffix at the end of
  the document.

## Changed

- Automatic skill loads and provider-harness grants score each clause of a
  request that needs several capabilities, and grant one skill per clause before
  a second skill for the same clause, still at most three. Single-clause
  requests rank as before.
- `omk-ai` pins `@anthropic-ai/sdk` 0.92.0. Anthropic requests ignore the SDK's
  new `ANTHROPIC_CUSTOM_HEADERS` variable, and the root declarations no longer
  load `@google/genai`.

## Fixed

- A receipt-reading critic, visual-QA or document lane waits only for the
  producers whose receipts it reads.

## Rust core status

This release contains stage K0 of the Rust core plan (spec 120): the
`native/omk-contract` crate defines the session JSONL, public RPC and
extension-host wire types, and the Node core's compatibility table and protocol
type declarations are generated from it. Nothing in production calls a Rust
crate. Node still runs the agent, extensions and SDK, and there is no Rust
runtime to select. This release makes no speed, memory or solve-rate claim; see
[the Rust core plan](https://github.com/dmae97/omk/blob/main/packages/coding-agent/docs/omk-2-rust-core.md).

## Packages

All eight public packages move to `2.0.0` in lockstep: `open-multi-agent-kit`,
`omk-ai`, `omk-agent-core`, `omk-tui`, `omk-protocol`, `omk-adaptorch-wpl`,
`omk-book-to-skill` and `omk-speak-like-you-eat`. Full details are in each
package's `CHANGELOG.md`.
