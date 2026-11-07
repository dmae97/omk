# Inactive no-execution workbench control boundary

`omk.workbench-control.v1` is a separate, bounded validation contract for the
[native migration](omk-2-migration.md). It is not public RPC, private N02,
`omk.run-graph.v1` or an executing control channel. There is no production caller,
listener, UI connection or Rust executor for this module.

## Request

`parseWorkbenchControlFrame()` in `omk-protocol` accepts one complete frame:
compact UTF-8 JSON followed by exactly one LF, with at most 4096 payload bytes.
The compact form must roundtrip through `JSON.parse`/`JSON.stringify` unchanged.
Duplicate and escaped-equivalent keys, BOM, malformed UTF-8, CRLF, multiple
frames, unknown fields and missing nullable fields are rejected. Errors do not
reflect input. This is a frame parser, not a queued or streaming transport.

| Field | Accepted value |
|---|---|
| `schemaVersion` | `omk.workbench-control.v1` |
| `kind` | `validate-start` only |
| `requestId` | Bounded run-ID syntax, used to correlate this validation |
| `hostId`, `actorId`, `connectionId` | Bounded run-ID syntax; untrusted claims until compared with host context |
| `hostEpoch` | Canonical positive decimal string, at most 40 digits |
| `graphRevision` | `0` for this initial-state slice |
| `expectedState` | `absent` |
| `nodeId`, `attempt`, `grantDigest` | Explicit `null`; this operation targets no existing node, attempt or grant |
| `command` | Existing strictly parsed `omk.verified-command.v1` start command |

The nested command retains the existing run ID, command ID, initial revision and
generation, and contract digest. Its schema and digest semantics are unchanged.
Execute, resume, reconnect, cancel, detach, shutdown and graph mutation are not
supported operations. UI data cannot add approval, roles, timestamps, deadlines
or an execution request.

## Trusted host comparison

The internal source module `src/core/verified-run/workbench-control.ts` exports
`validateWorkbenchControlFrame(frame, context)`. The host supplies `context`
out of band, after authenticating the peer through its eventual transport.
It must contain:

- The current host ID and epoch, plus its real host-lifetime `AbortSignal`.
- The authenticated actor ID and connection ID, a real connection-lifetime
  `AbortSignal`, and the host's absolute authorization deadline.
- The current graph revision/run-absence view and the exact host-expected start
  command, obtained independently of the request being validated.
- A host-owned rollback-detecting clock, such as `createAuthorityClock()`.

Missing context/peer, serialized signal lookalikes and revoked lifetimes fail
closed. IDs, epoch, state and the entire normalized command must match the trusted
context. Authorization is checked at the exact deadline and again before the
reply; lifetime revocation during validation is refused. The gate does not extend
a deadline from retry data or read a timestamp from the wire.

**Neither an ID nor an active AbortSignal authenticates a peer.** Signals only
fence host/connection lifetime. The low-level gate checks consistency with an already
trusted host context; it does not establish credentials, verify IPC peer identity,
read a durable host epoch or prove that the caller supplied a fresh context.
Never deserialize the context from UI data. In-process code that can fabricate
host context is outside this boundary's trust model.

The authorization deadline here is for the trusted connection context. It does
not add an expiry field to `VerifiedRunApproval`, mint run approval or replace
the execution host's approval/owner/authority checks.

## Ownership-bound context

`src/core/verified-run/workbench-connection.ts` adds the inactive
`createWorkbenchControlConnection(options)` wrapper. The trusted host supplies its
existing `SessionOwnerLease`, `RunAuthority`, state root, expected start command,
host lifetime and already-authenticated peer information. The wrapper does not
open/reconcile a store, acquire/release a lease or authenticate that peer.

The wrapper checks the authority path/session against the run and the owner's
actual journal path. It independently reads the committed authority journal and
compares its head with the held store's current accepted head, rather than using
the cached projection as proof. A reconciled durable epoch and exact session
incarnation are pinned at creation; caller/wire epoch claims cannot select them.
The readonly `AuthorityStore.isReleased` flag is only one lifecycle check, not a
replacement for this fresh inspection or the existing lease protocol.

It captures the owner lease identity and fixed peer/deadline/command data. Release,
lease transfer/identity refresh, authority reopen or incarnation replacement
requires a new explicit binding; retagging an old request cannot revive an old
connection. Unrelated committed authority updates remain readable when the held
store has accepted them and the pinned epoch/incarnation still match.

Only an actually absent run journal is accepted for this start-only slice. `lstat`
must report `ENOENT`; a present file, symlink or other read error is not absence.
Ownership, durable bytes and run absence are checked before validation and after
every host-clock callback, including the final response check. The wrapper owns
a rollback-detecting clock and returns only immutable identity metadata plus
`validate(frame)`, never its store/owner handles.

Inspection preserves the existing committed-prefix semantics: uncommitted suffixes
are not promoted, truncated or repaired. Corrupt committed bytes and unexpected
inode replacement fail. No grant, run record or authority record is written by
connection creation or validation. The caller still owns resource cleanup.

This derives an ownership-bound context; it is not OS-peer authentication, an
atomic authority transaction, durable reconnect or execution permission. Existing
single-writer/lease trust assumptions remain. An eventual dispatcher must still
perform its own approval, ownership and effect-admission checks.

## Local bearer-authenticated peer adapter

`src/core/session-control-peer.ts` adds `authenticateSessionControlPeer()` for an
already accepted private POSIX socket. It reuses the existing safe endpoint reader,
session-control request parser and total connection deadline. It does not start a
listener, enroll a session, change the legacy control protocol or dispatch an action.

The trusted host supplies the persisted control-session path, its actual owner
lease and a host lifetime. The host must accept the socket on its own private
listener at the published endpoint. The authenticator rejects unconnected and TCP
sockets. It checks the owner-only descriptor, socket/directory types, permissions
and local UID, then compares socket-received credentials with the descriptor's
current 32-byte bearer token. These checks do not obtain the kernel peer UID or
identify an individual user behind a shared token. The existing same-OS-user and
trusted-in-process assumptions remain. Windows is explicitly unsupported here.

The socket supplies one compact UTF-8 `status` credential request with one LF,
bounded by the existing 32 KiB frame limit. Wrong session/token, extra fields,
other actions, malformed encoding, duplicate keys and extra frames fail closed.
No status operation runs and no credential response is sent. Parser and descriptor
errors become a fixed authentication error without including token or input text.

Only this actual authentication path registers a peer handle in a private weak
registry. The frozen handle exposes session metadata, a host-generated connection
ID, an abort signal and `dispose()`. It exposes no token. Lookalike flags, copies
and serialized handles are not authenticated results.

`src/core/verified-run/workbench-local-peer.ts` adds
`bindAuthenticatedWorkbenchControlConnection(peer, options)`. It requires that
registered peer and matches the host-selected control session and canonical path.
The actor and authorization deadline come from host policy, not request JSON.
The generated connection ID and lifetime come from actual socket authentication.
The existing ownership-bound factory still verifies the separate run owner,
committed authority epoch, incarnation, command and run absence.

Validation rechecks the peer before entry and after host-clock callbacks. Socket
end/close/error, host abort, explicit disposal and the fixed total deadline revoke
the peer. Current descriptor/token changes, unsafe permissions and control-owner
release or identity transfer also revoke it. Request activity does not reset a
deadline. Authentication failure closes the supplied socket; the caller disposes
a successful handle when finished, including after a later binding error.

By default this socket carries authentication and lifetime only. Further bytes
close it rather than being silently discarded. An explicit handoff is required
for the separate inactive frame handler below. The adapter itself still accepts
an in-process frame argument and does not activate a listener or complete U1.

## Inactive authenticated socket handler

`handoffAuthenticatedSessionControlPeer(peer)` returns the actual registered
socket, paused, only once. A copied or revoked handle cannot claim a socket.
Handoff removes the auth-only data listener, not its authentication/lifetime
fences. Without handoff, the original post-authentication byte rejection remains.
The trusted host owns a socket it claims directly and must dispose it when done.

`src/core/verified-run/workbench-ipc.ts` exports
`attachWorkbenchControlIpc(peer, options)`. It binds the existing ownership-bound
connection and takes that one-shot handoff. A duplicate attachment fails without
disposing the first handler. The frozen result exposes the pinned `identity`,
`dispose()` and a `closed` promise that observes the actual socket close event.
It does not expose a validator that can bypass the stream bounds.

The handler first writes one compact JSON/LF `ready-no-execution` message with
`schemaVersion: "omk.workbench-control.v1"`, the pinned `identity`,
`executionRequested: false`, false `execute`/`amendGraph`/`publish` capabilities,
and `limits: { payloadBytes: 4096, queuedFrames: 4, requests: 64 }`.
Input remains paused until the ready write completes, including required drain.
Already buffered early input closes the connection. Clients must wait for ready
before sending control frames; an auth frame and control frame cannot be combined
into one authentication read. This is not a claim about when a peer sent bytes
or proof that a client received ready.

| Resource | Per-connection bound |
|---|---|
| Control frame | At most 4096 payload bytes plus one LF |
| Partial input | At most 4096 bytes before LF |
| Waiting frames | Four, in addition to one response in flight |
| Complete requests | 64 for the entire connection; repeated IDs also count |
| Ready or validation reply | At most 4096 payload bytes plus one LF |
| Connection lifetime | Original total auth deadline, never reset by handoff or activity |

Fragmented frames are assembled and coalesced frames retain order. Retained frame
bytes are copied rather than keeping views into an arbitrarily large input chunk.
The entire incoming event is bounded before dispatch; an overflowing coalesced
burst can reject that event without a validation reply. These are per-connection
bounds, not a global listener/concurrency policy or a bound on kernel buffers.

Each queued frame is passed through the actual authenticated ownership connection
only when its reply can be written. Thus a queued frame is checked against current
peer, owner, committed state and deadline, not a cached earlier validation result.
Only one reply is written at a time. A false `socket.write()` return requires both
the write callback and `drain` before advancing. A write callback is not a durable
acknowledgement or proof of delivery.

Malformed input, forged identity, overflow, expired/revoked context and write
failure close without reflecting an error or input bytes. Disposal clears pending
input and prevents late write/drain notifications from restarting processing.
Socket close/end/error and host/peer disposal retain their existing revocation
meaning. The handler releases no host-owned store or run lease. Bytes already
sent cannot be retracted if revocation happens later.

This is an inactive per-socket route, tested with isolated listeners only. It adds
no production caller/listener, UI attachment, listener admission policy, Windows
ACL authentication, durable cursor/snapshot resynchronization or reconnect. The
POSIX same-user bearer trust model is unchanged. The host must still provide the
accepted private-listener socket and independently selected session/run policy.

## Result and limits

Successful validation returns a frozen `validated-no-execution` object with the
request, host, epoch, connection, run and command identities and a normalized
command digest. `executionRequested` is `false`; `execute`, `amendGraph` and
`publish` capabilities are all `false`. It exposes no grant or approval token.

This result is not admission, a durable acknowledgement, settlement or permission
to dispatch. No authority store, run journal, workspace or executor is mutated.
An eventual dispatcher must independently recheck current state and authority;
this snapshot comparison cannot close a check-to-dispatch race.

Exact repeated validation may return the same data, but no durable request cache,
cross-incarnation result adoption or exactly-once guarantee is implemented. No
event cursor, snapshot resynchronization, authenticated reconnect or recovery
claim follows. `resume` remains execution intent, not UI reattachment.

## Scoped verification

From `packages/protocol`, run the installed Vitest CLI against
`test/workbench-control.test.ts`. From `packages/coding-agent`, run it against
`test/workbench-control.test.ts`, `test/workbench-connection.test.ts`,
`test/workbench-local-peer.test.ts`, `test/workbench-ipc.test.ts`,
`test/verified-run-admission.test.ts` and `test/safe-wiring-authority-admission.test.ts`.

The boundary tests invoke the actual new parser and host gate, with real abort
signals and the existing clock helper. Sentinels reject executor, sandbox probe,
workspace capture and grant issuance calls. This is not the earlier legacy-parser
substitution probe and does not establish native interoperability or Windows,
Linux/WSLg and macOS application acceptance. Production execution remains Node.

The IPC tests use actual private sockets and credentials, authority stores and
owner leases. Native stream `cork()` makes `write(false)` observable; test-only
gates delay actual callback/drain notifications to check both orderings. Separate
write-fault injections cover synchronous and callback failures and are not OS I/O
failure evidence. No fake authenticator or validator supplies successful results.
