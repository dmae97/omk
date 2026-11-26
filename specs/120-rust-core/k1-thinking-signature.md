# K1 same-model thinking signature compatibility

Date: 2026-11-17
Status: implemented bounded source unit; full K1 and migration remain open.

The real Node streamAnthropic/SDK recorded eighteen new requests before Rust changes.
The independent oracle crosses allowEmptySignature false/true with missing, empty,
space-only, BOM-only, NEL, valid, blank-thinking, opaque redacted and empty redacted
signatures. Node runtime source and SDK package provenance are SHA-256 recorded. Only
synthetic keys/content, isolated homes, in-memory synthetic-only fetch and zero retries
are used. The recorder creates exclusively; --check never rewrites expected data.

Catalog model compatibility is resolved before the optional request-options early return,
so absent options cannot drop the model flag. The existing request/history/block owners
thread a single allow_empty_signature boolean; no parallel converter or parser is added.
Missing/ECMAScript-blank signatures on nonblank same-model thinking become an empty
thinking signature only when compatibility permits. Otherwise they stay plain text.
Existing signed, redacted, blank, error/aborted and original-block-bound behavior is reused.
The legacy synthetic replay still defaults false and rejects a caller-injected compat
field. Missing redacted signatures remain invalid; opaque empty data stays supported.

The shared socket harness now handles synthetic base URLs with or without /v1 before
numeric-loopback dispatch. Its first attempt timed out awaiting a socket because the
new oracle used the already-supported root URL spelling, not the previous /v1/ spelling.
Networking was isolated and no provider ran. This harness failure is not behavioral RED.
After correcting only URL substitution, the compiled behavioral RED showed exact text
versus thinking wire mismatch. Expectations were not changed. The subsequent library
and executable tests each match all 92 recorded requests, including prior 74 cases.

Verification evidence: `/mnt/omkdata/tmp/omk-k1-signature-PSLmd94A`, with immutable baseline,
before images, command receipts/logs, retained failures and scoped preservation audit.
Rust: 61 passed, zero failed/ignored. Twelve Node regression files: 21 passed, zero
failed/skipped. Recorder strict TypeScript, Cargo check/fmt and all-target Clippy with
warnings denied passed. Repository/documentation/final preservation gates are recorded
in evidence. The initial formatting failure remains retained.

This is API-key same-model request compatibility, not full K1/RC2, cross-model signature
handling, arbitrary tool normalization/collation, other provider APIs, OAuth/storage/
refresh, complete response parity, agent/session/core adoption or platform/live acceptance.
Original corpora, dependencies/locks/notices, installed engines/settings/credentials and
unrelated work are outside this unit. No delegated agent, provider inference, install,
commit, push or publication occurred. Remaining requirements stay open in [spec.md](spec.md)
and [tasks.md](tasks.md); see also [request policies](k1-request-policy.md) and
[explicit request caching](k1-request-cache.md).
