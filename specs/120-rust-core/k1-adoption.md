# K1 B1 adoption and first Anthropic replay

Date: 2026-11-12. Baseline HEAD: `3045c4ca2f548865b4638759a4e253cd23333688`.
Scope: the first synthetic Anthropic Messages request/SSE unit only.
Status: first unit implemented and locally verified. Repository check remains
blocked by K0 fixture drift. Not complete K1 or RC2/PL1 acceptance.

## Owner authorization

The current owner request explicitly approves the reviewed K1 bundle as B1,
incorporation into the project, builds, the synthetic Anthropic recorder and Rust
replay, while retaining the recorded license and platform constraints. This is
decision J2. It supersedes J1's resolution-only restriction for this exact bundle,
not for a newly resolved graph, another dependency bundle or publication.

The frozen [review JSON](k1-dependency-review.json) is retained byte-for-byte with
SHA-256 `609eb2e6889488a0c80bd3501d514daf14757b40a67ae9d419f061fe5d30cf93`.
Its `authorization` and pending status describe the historical resolution review,
not today's authorization. [k1-adoption.json](k1-adoption.json) binds this adoption
to that review and the retained distribution notice digest.

## Implementation units and acceptance

1. **Dependency adoption:** new independent `native/omk-providers` crate, five exact
   direct pins, no extra dev/build dependency, default features off. Import the
   checksum-verified temporary lock with only its root package renamed. Compare
   direct features, restored lock digest and all six effective normal/build graphs.
2. **Node recorder first:** real `streamAnthropic` and the official SDK serialize
   synthetic requests through an in-memory fetch only. Record expected artifacts
   before implementing their replay, in an isolated home without inherited auth.
3. **Rust replay second:** build request bytes independently from typed inputs,
   parse recorded UTF-8 byte chunks and reduce semantic events. The CLI receives
   only input/chunks/cancellation, never expected request/events/results. Library
   and subprocess assertions compare the frozen Node outputs.
4. **Verification:** request mismatch/behavioral RED, then Rust GREEN; format,
   Clippy with denied warnings, tests, build, fresh Node drift check, repository
   guards and concise direct self-review. No delegation or paid provider call.

The initial 11-case Node recording was captured before Rust replay, with SHA-256
`17b68242e6154ee449e7f0a04abf8836e963a206536876c391504c942eaecffd`.
Five additional Node-only cases (thinking, mid-stream cancel, empty refusal,
intact CRLF and trailing EOF frame) were recorded before their replay support.
The final 16-case fixture digest is
`9a0485fa14c1da7904c80f7b80630e0416f493b39663843ea21872d047e1f46a`.
No expected result is generated from Rust or changed to make Rust pass.
Commit/push was not requested, so these are separate file/implementation units,
not claims of separate committed changes.

## Verification outcomes

- Exact frozen graph, notices and six target resolution comparisons: exit 0.
  These remain Linux-host resolver checks, not six native builds.
- Credential-free `cargo build --locked --offline` on GNU Linux x64: exit 0.
- RED: missing Rust replay API, then observed tool request whitespace mismatch,
  then unsupported thinking events. Fixed Rust only; expected Node output retained.
- GREEN: 16 library comparisons and 16 real CLI subprocess comparisons: exit 0.
- Rust boundary tests and explicit Ring/native-root client construction and
  process-global crypto conflict tests: exit 0, with no request dispatched.
- Node B1 mutation tests and fresh-recording/auth-isolation test: 3 passed.
- Targeted strict TypeScript recorder check: exit 0 (`tsgo --ignoreConfig --noEmit
  --module nodenext --target es2022 --allowImportingTsExtensions --skipLibCheck
  --strict scripts/fixtures/anthropic-provider-cases.ts
  scripts/fixtures/anthropic-provider-recorder.ts`).
- Active LSP probe: no blocking diagnostic returned, but most files inconclusive.
  Do not count a silent probe as clean; compiler/Clippy results are independent.
- Repository `npm run check`: exit 1. Initial new-code Clippy `err_expect` and
  subsequent fmt failure were corrected. The final run passed all native fmt,
  Clippy and tests, all six graphs and the 16-case Node drift check, then failed
  at `check:contracts`: `fixture bytes or file set differ from fresh recording`.
  Rust declaration drift and capability-matrix checks passed before that failure.
  K0 expected fixtures were not regenerated or modified by this unit.
- Separate continuation of repository guards: `check:constitution` exit 0
  (685 passed, 31 skipped; unavailable R/Bun evidence is not a pass). Release
  consistency, README releases, doc links, OpenWiki, feature claims, private-home,
  release surface, shrinkwrap, Pi inventory and browser-smoke guards all exit 0.
  Workspace `tsgo --noEmit`: exit 0.
- `npm run build`: exit 0 for all seven Node workspaces.
- Final `cargo check --locked --offline` and `cargo build --locked --offline`:
  exit 0 for the completed implementation, not just its dependency skeleton.
- Targeted Node fixture/native-check tests: 6 passed, 0 skipped. Existing
  `packages/ai/test/anthropic-sse-parsing.test.ts`: 9 passed, 0 skipped.
- Rust `cargo test --locked --offline`: 7 tests passed, 0 skipped, including one
  test that asserts all 16 library and 16 actual CLI replays.
- `git diff --check`: exit 0. The direct Biome invocation processed no files
  because scripts are outside its configured scope; it is not counted as a script
  lint pass. The strict recorder compiler check and Node script tests are separate
  verification.

The exact commands above ran in the root agent without delegation. Local raw logs
were retained for the run under temporary `omk-k1-*` log names, not committed.
The K0 failure remains a blocker to overall repository acceptance. An independently
working documentation lane updated spec 120 during this run; its edits were
re-read and preserved rather than overwritten.

## Compatibility findings and limits

The fixture exposes a preexisting Node split-CRLF error (empty event parsed before
the `data` line). Rust preserves that error, and a separate intact-CRLF case
passes. Empty stream success also remains unchanged. The Node provider source,
K0 fixtures and all other sessions' preexisting changes are not edited here.

The fixture explicitly excludes SDK OS/runtime headers, timestamps, usage costs
and mutable partial message snapshots. Request body strings, remaining headers,
final messages/tokens/errors and semantic event ordering are compared. No claim
of full raw header, partial-snapshot or whole-provider parity follows.

The request builder refuses models outside the synthetic corpus. OAuth, actual
Anthropic HTTP dispatch, image/history conversion, cache/override/model policies,
JSON repair and complete partial-tool parsing remain future slices. No real
Anthropic, OAuth or billing flow was exercised. The transport probe's safe defaults
are not evidence of proxy/retry/deadline parity.

## License, build and platform constraints

- Retain all discovered license/notice texts for the 99-package union in the new
  crate's `THIRD-PARTY-NOTICES.md`; identical files share one reproduced text.
  The adoption JSON binds its digest. Existing root LICENSE/NOTICE remain intact.
- Select MIT where offered; preserve Ring Apache-2.0 AND ISC and mandatory ISC,
  BSD-3-Clause and Unicode-3.0 terms. No vendored source or binary distribution.
- Build using installed Rust/Cargo 1.99.0, isolated HOME/CARGO_HOME, a minimal PATH,
  no inherited credentials/compiler wrappers/RUSTFLAGS/ICU4X data overrides and
  cached checksummed sources. Dependency build scripts/proc macros execute only
  within this explicitly approved build scope.
- Explicit Ring initialization; conflicting TLS provider ownership fails visibly.
  No certificate bypass. Native trust roots and platform revocation remain gates.
- Six resolution graphs match. Only local GNU Linux x64 compiled/executed here.
  macOS and Windows native builds, both ARM64 variants and Windows ARM64 Clang/SDK
  remain outstanding. No musl/Android/WASM or cross-build acceptance is implied.
- No workflow, release, version, installed runtime, auth file or model catalog
  changes. `npm run check:native` automatically discovers the new crate; graph and
  Node recording drift checks are added around the existing native checker.
  The graph command uses `--locked` and may download locked registry sources in a
  fresh clone, without running build scripts; cached runs can set
  `CARGO_NET_OFFLINE=true`. It must not require an already warmed cache before the
  normal native checker can fetch/build.

## Proposed review split

- `build: 승인된 K1 의존성 그래프와 라이선스 고지 편입`
- `test: Anthropic 합성 요청과 스트림 recorder 추가`
- `feat: 독립 Rust Anthropic replay와 CLI 검증 추가`

These are proposed messages only; nothing has been committed or published.
