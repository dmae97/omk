# K1 explicit HTTP byte-stream transport

Status: implemented and locally verified. This is not complete
K1, RC2, PL1, a selectable Rust core or installed adoption.

## Scope and ownership

The previous `transport::build_client` only constructed the B1-approved client.
`Transport::post` reuses it to send one explicit POST and deliver response chunks
with response status/headers. No new dependency, feature, lockfile, crypto owner,
provider model, credential store, production Node caller or engine selection is
introduced. Ring, native certificate verification, disabled redirects/retries and
inherited proxies, and the existing 30-second client ceiling are preserved.

The caller supplies an absolute Tokio deadline, response byte cap and irreversible
cancellation handle. One future owns headers and body; dropping it releases local
I/O, with no detached request task. Cancellation does not undo server-side work
already dispatched. Cancellation wins a ready race with the operation. A response
consumer is synchronous and must return promptly; it cannot be preempted.

Requests above 8 MiB, response limits above 8 MiB, URL credentials/fragments,
non-HTTPS endpoints except numeric loopback HTTP, and caller-controlled HTTP
framing headers are refused before dispatch. The body cap is cumulative and
checked before delivery, including unknown-length chunked responses. Zero and
exact limits are supported. Typed errors omit endpoints, secrets and raw client
errors. HTTP error statuses/bodies are returned once without automatic retry or
redirect; provider-specific handling remains with its future provider owner.

## Independent data and actual socket checks

The existing `tests/fixtures/anthropic.json` remains unchanged. The first request
in that independently recorded Node/SDK oracle is sent through a real loopback
socket; the server compares exact body bytes and synthetic auth. The recorded SSE
bytes return through the real HTTP parser, then existing Anthropic replay matches
recorded semantic events and final output. Physical TCP chunk boundaries are not
claimed to match the Node recording. Remaining tests exercise transport contracts,
not Node SDK retry/proxy/error-message parity. No expected output is supplied to
production transport code.

Thirteen tests cover request transmission, streamed delivery before EOF, pre-dispatch
cancellation/expiry with zero connections, cancellation waiting for headers,
cancellation during delivery, stalled header/body deadlines, declared/chunked byte
caps, 307/429/503 with no follow/retry, sink failure, truncated-body failure,
endpoint/request/framing refusal, secret-free errors and zero/exact byte limits.
Socket closure is observed after cancellation and sink failure. Each server task
is joined; test runtime teardown owns any task left by a failing assertion.

## Verification record

- `cargo check --offline --locked`, `cargo fmt --check`, Clippy `--all-targets
  -- -D warnings`, and full crate tests: exit 0. The crate runs 36 tests, including
  all 13 new socket tests. Check/test/Clippy use a read-only network-isolated Linux
  sandbox with the evidence directory as the writable build/temp/home mount.
- Six focused independent Node fixture test files: 14 passed, zero skipped,
  network-isolated, without rewriting a corpus.
- `npm run check`: final exit 0 in 225.933 seconds, including all six native crates,
  fresh Node provider/JSON recordings, K0 contract recordings and repository guards.
  This is not the full product Vitest suite or platform/provider acceptance.
- Preservation audit: HEAD and complete staged-diff digest unchanged; exactly six
  owned paths changed, no other Git-visible file changes. Original provider/history/
  content/vision corpora, manifests, locks and notices are unchanged.
- Active LSP probe: two paths confirmed clean, one existing inactive-cfg hint,
  one inconclusive path. Compiler success does not turn that into an all-clean LSP
  claim. Documentation links and `git diff --check` pass.
- Retained non-passes: initial missing-API RED (101); first compiled run failed from
  the test-server assumption that empty requests always include Content-Length,
  then passed after fixing only the test server; initial fmt check (1), corrected
  only owned files; initial repository check (1) because the isolated TMPDIR path
  exceeded the K0 recorder's fixed path width, then passed using short `/tmp`.
- Compiled negative control: disabling cancellation polling fails the real
  header-wait cancellation test (101), including its socket-closure assertion.
  The mutation was undone before all final GREEN checks.

The full active migration objective remains open: remaining Anthropic/provider
auth/catalog/policies and Node parity, other APIs, K2-K5 and later roadmap gates.
No live API, OAuth, TLS handshake/revocation, proxy parity, native macOS/Windows,
packaging, install, commit, push or release occurred.
