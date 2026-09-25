# Source-quote v1 implementation amendment

Status: experimental opt-in implementation target, not default promotion.

This amendment narrows the first slice to explicitly pinned source quotes. It does
not implement automatic fact extraction, procedural advice, learned ranking or
semantic truth verification. The host observes a bounded UTF-8 source span itself;
it does not accept an externally supplied success verdict or model statement.

## Admission contract

Input is a workspace-relative source path, inclusive 1-based line range and a
bounded TTL. Output is accept, abstain or escalate with a fixed reason. A record
contains schema/policy, opaque workspace digest and memory ID, semantic cognitive
type, exact quote, source digest/range, a host-created protocol Observation,
creation/expiry and redaction-policy version. Successful command exit is not input.
Hashes correlate data; they do not authenticate same-UID writers or prove the quote.

Limits: 32 records, 256 KiB per source file, 2 KiB per quote, 16 lines per quote,
16 KiB per record, TTL at most 30 days. No absolute paths, traversal, symlinks,
hardlinks, secret-bearing files, internal .git/.omk state or known injection markers.
Admission scans the source before taking the quote so a cut cannot hide a known
credential prefix. This is best-effort redaction/pattern screening, not DLP or a
semantic injection detector.

Storage: .omk/verified-memory under the workspace, owner-only POSIX files/directory,
exclusive immutable publication, lock-serialized mutations. Revocation appends a
tombstone; no record is overwritten. Explicit removal of this directory by its
owner deletes the retained evidence. Expiry excludes records without deleting
historical bytes. No sync, global memory, automatic renewal or hidden cleanup.
Same-UID concurrent path mutation is outside the filesystem security guarantee.

## Data-only runtime contract

OMK_VERIFIED_MEMORY=1 and Context Budget V2 are both required for recall. Each
provider-request transform rereads/revalidates source bytes and expiry, then sends
selected evidence through the existing V2 planner. It reserves the existing
system/history/tool footprint and checks the complete final input budget again.
The generated evidence is a host-originated closed tool-call/result pair, not a
system instruction, user instruction, skill, assistant answer or model-generated
claim. It is transient: not appended to the transcript, not compacted, not cached
as trusted prose. Missing, expired, revoked or modified evidence is omitted;
unreadable/invalid stores report unavailable rather than inventing content.

## Frozen local regression manifest

Positive fixtures: pin/read/reopen a current source quote; retrieve a relevant quote
through a real Faux AgentSession; retain an escaped quote as tool data; omit when
budget is too small; same input in reversed record order has the same selected IDs.
Negative fixtures: unknown fields/self-claim; missing source; external/traversal
path; leaf and parent symlink; hardlink; sensitive path; known credential; explicit
instruction marker; oversize file/quote/range; invalid TTL; source mutation;
expiry; revocation; malformed or foreign record; source deletion; store symlink;
retrieval disabled; V2 disabled; stale content after a second provider request;
no memory text in system/user positions, persisted transcript or compaction input.

The regression threshold is all named assertions passing, with a nonempty positive
set (reject-all fails). Report executed test count and command rather than an
estimated precision. No sampling-based inference is made from this synthetic set.

## Security review and promotion boundary

Review source containment, read bounds and identity rechecks, immutable publication,
record validation, TTL, revocation, escaped tool-data rendering and full-request
budget tests before calling the slice implemented. Any failed mandatory fixture
blocks that statement. Default promotion remains blocked on the original spec's
independent human-labeled admission sample, preregistered precision/confidence/
minimum-effect thresholds, same-model task-success/cost runs and held-out task
order repetitions. No live provider calls or quality advantage is inferred here.
