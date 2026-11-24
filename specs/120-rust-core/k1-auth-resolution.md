# K1 credential snapshot resolution

Date: 2026-11-17. Baseline HEAD: `ab08eb635e1d3f2d4abd4d3be1569ea8112553af`.
Status: implemented and locally verified. This unit does not complete K1 or the
active objective to continue the complete Rust migration.

## Contract and ownership

The current Node owners are `core/auth-storage.ts`, `core/auth-storage-backend.ts`
and `core/resolve-config-value.ts` under `packages/coding-agent/src`, and
`packages/ai/src/env-api-keys.ts`. Rust adds the read-only `auth::Snapshot` and
`auth::resolve_config` in the existing unpublished provider crate. No dependency,
lock, existing corpus, notice, Node runtime or installed-state change is needed.

A host supplies the complete store JSON or an explicit read-failure outcome,
provider ID, runtime key, already-selected environment key, optional model-config
fallback, and an environment lookup function. There is no ambient environment or
filesystem lookup. The host must load a fresh snapshot with its own locking and
retain refresh ownership. The resolver does not invent another credential store.

Priority matches the recorded Node behavior:

1. Nonempty runtime key wins, verbatim, even over an unreadable store.
2. A stored API key resolves its template. Empty and unresolved stored keys stop
   selection; neither switches silently to an environment/fallback account.
3. An unreadable or malformed store blocks substitution.
4. A nonempty provider-selected environment key wins over fallback.
5. Optional fallback is resolved only when enabled and reached.

Config values support ASCII environment names, `$NAME`, `${NAME}`, `$$` and `$!`.
Unknown/incomplete variable syntax remains literal. Empty environment values count
as missing. Unicode and control characters are retained, not normalized into
credentials for another account. Expanded results are never evaluated again.

Inputs/results are bounded to 65536 bytes per config/key; store snapshots to
1 MiB. Wrong root types are unavailable stores. Invalid selected credentials and
unknown credential kinds fail closed. `Secret` deliberately has no serialization,
clone or ordinary print implementation, and its `Debug` is `[REDACTED]`. Exposing
a key requires an explicit `expose()` call. This is not memory zeroization.

## Independent evidence

`node scripts/record-auth-fixtures.mjs` recorded 52 cases by calling the actual
Node `AuthStorage.fromStorage` and `resolveConfigValue` before the Rust implementation.
The recorder uses an in-memory read-only backend, isolated home and allowlisted
environment; the initial run also disabled external networking with Bubblewrap.
The separate `tests/fixtures/auth.json` includes source hashes. `--check` never
rewrites an existing recording. Expected values are never passed to Rust.

The temporary compiled negative implementation returned literals and selected
only environment/fallback values. `cargo test --test auth` exited 101 with three
failed tests and 68 library/executable mismatches. This is behavioral RED, not a
missing API, dependency or syntax failure. The same three tests then passed after
implementation. An additional test covers exact input/output/store/CLI bounds.
Initial formatting failure is retained separately, not counted as behavioral RED.

`replay-auth` is an offline diagnostic executable. It resolves **supplied stdin
values and prints them**, so it is for synthetic recordings, not real credentials.
It never reads actual auth files, ambient environment or the network, and refuses
unknown/ambiguous input without partial stdout or reflecting input in diagnostics.
Its stdin limit is 2 MiB. Library secrets remain redacted; the diagnostic output is
an explicit test-only exposure, not a production credential-printing command.

## Remaining required work

OAuth refresh/account selection, cross-process file locks/storage, shell-command
execution and provider-specific environment-name selection remain host work.
Commands return `CommandRequiresHost`; OAuth entries return `OAuthRequiresHost`.
Those refusals are safety boundaries, not completed Node OAuth/command parity.
An unresolved shell/OAuth credential never selects a different account.

Model catalog/overlay loading, authenticated Anthropic dispatch, remaining request
options and APIs, dependent K2-K8 stages, installed adoption and platform/provider
acceptance remain open. This API does not make the synthetic request/response
models into arbitrary live-model support. No real credential, paid inference,
installation, engine selection, commit, push or publication occurred.

## Verification

- `cargo check --offline --locked`: exit 0.
- `cargo fmt --check`: exit 0 after owned formatting fixes; initial exit 1 retained.
- `cargo clippy --offline --locked --all-targets -- -D warnings`: exit 0.
- `cargo test --offline --locked`: 45 passed, zero ignored. This includes the
  four auth tests and all prior stream/transport/history/vision regressions.
- Seven focused Node regression files: 16 passed, zero skipped, with external
  networking disabled and original source/recordings read-only.
- Strict recorder TypeScript (`tsgo --ignoreConfig --noEmit --strict`): exit 0.
- `npm run check`: exit 0, 291.969 seconds. Script discovery reports 745 total,
  715 passed, 30 skipped, zero failed. This is not the full product Vitest suite.
- Active LSP: two paths confirmed clean, three inconclusive; no all-clean claim.
- Documentation links and `git diff --check`: exit 0.
- Preservation audit: unchanged HEAD/index, exactly eleven owned paths,
  `otherChanges: []`; earlier corpora, locks, notices and other lanes preserved.

Private command logs, immutable baseline and per-command argv/cwd/exit/duration
records are under `/mnt/omkdata/tmp/omk-k1-auth-ghSvRKXm`, outside the repository.
No unresolved verification process remains. Direct self-review checked credential
priority, malformed/unreadable state, bounded expansion, no ambient reads/commands,
redacted library diagnostics and the explicit diagnostic-only value output.
No provider/network/platform/installed acceptance is inferred from these results.
