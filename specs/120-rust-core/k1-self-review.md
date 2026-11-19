# First K1 unit: direct self-review

Date: 2026-11-12. No delegated reviewer or merge approval.

- Correctness: Node/SDK produces expected fixtures before Rust support. Rust CLI
  accepts inputs/chunks/cancel only and refuses oracle fields. Request strings,
  projected headers/events and final messages match all 16 cases. Tests observe
  actual EOF/errors/cancel, including the known split-CRLF Node failure.
- Security: isolated recorder home/environment, synthetic credentials, no network
  fetch implementation, exact dependency graph/notice digests, explicit Ring and
  visible crypto-owner conflict, certificate verification retained. Replay and CLI
  inputs have size limits and unknown-field checks. No live auth/dispatch exists.
- Architecture: standalone unpublished crate, no default runtime selection or
  Node provider source change. Separate request, SSE, reducer and transport modules;
  no new dependency beyond the approved five direct pins and exact lock graph.
- Distribution: all discovered six-target license/notice texts are retained with
  per-package references; identical texts deduplicated. No binaries published.
  Native macOS/Windows validation and ARM64 Clang/SDK remain open gates.
- Review correction: a mandatory offline graph check before Cargo's first fetch
  would break cold-cache fresh clones. The guard now verifies the frozen lock
  first and uses locked Cargo tree downloads without executing builds; offline
  cached checks remain available through `CARGO_NET_OFFLINE=true`.
- Verification limits: this is not full Anthropic/provider parity. Request history,
  OAuth, cache policy, image conversion, JSON repair, full partial-tool parsing,
  raw SDK/platform headers, partial snapshots and live transport semantics remain
  outside the slice. Root `npm run check` is still red on K0 fresh fixture drift;
  its golden was not changed to make the new unit pass.

No outstanding blocker was found inside the documented 16-case offline slice.
The repository/K1/K5 gates above remain open; this review is not release approval.
See [adoption and exact verification outcomes](k1-adoption.md).
