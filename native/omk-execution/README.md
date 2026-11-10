# Linux execution host

An unpublished, opt-in Rust backend for the existing verified-run command
boundary. Unlike `omk-runtime`, this binary actually supervises commands. Unlike
a complete native agent, it does not own approval, durable grants, scheduling,
provider calls, candidate verification, publication or a desktop UI.

## Ownership and wire

The trusted Node parent sends one bounded JSONL start request over private stdio.
Rust starts the same bubblewrap PID/network/filesystem sandbox and emits its
supervisor PID followed by the private namespace metadata. Candidate code waits
on stdin. Node independently captures the namespace identity, commits the run
journal and authority start, then sends a matching `commit`. Only then does Rust
release the command. A missing, malformed, repeated or wrong-owner commit never
permits an additional dispatch.

Rust owns child lifetime, combined stdout/stderr retention, monotonic deadline,
process-group cancellation and namespace-init termination observation. Output
arrives in bounded byte-array frames, preserving non-UTF-8 command output. The
parent checks identity, ordering, retained bytes and termination again. A lost
host, protocol error, uncertain teardown or backpressure failure cannot become a
successful receipt or trigger a second Node dispatch. Existing authority recovery
retains possibly live effects until a separate termination witness reconciles them.

With an optional `witnessDir` (absolute, owner-only, not a symlink), Rust durably
records a canonical termination receipt once it witnessed the namespace init gone
in the same boot, including after parent EOF. The write is idempotent: identical
existing bytes succeed, different bytes fail. See `src/witness.rs`.

## Durable execution records and command reconnect

An optional private `recordDir` creates `<requestId>.jsonl` exclusively before
spawning. Rust appends and syncs `accepted`, `ready`, `committed`, optional
`detached`, and a terminal `finished` or `error` record. The durable commit
precedes code release. An existing request file rejects a duplicate before any
spawn. Only the owning authority may discard settled records; this file is not
an approval or a replacement for the grant ledger. Accepted records also contain
`hostBootId`, `startedAtMs` and an optional `bindingDigest` supplied by the trusted
parent. The production binding covers its original grant token, intent, execution
ID and run generation. Rust records the original wall-clock start once; execution
timeouts and reported duration still use the same monotonic start across detachment.

The terminal record is synced **before** `finished` is sent to the parent. A
storage failure cannot emit a successful finished event. The consumer must still
check process closure and independently witness namespace termination. A partial
last line is not a result, and losing the host does not authorize another dispatch.
After the payload sync, Rust atomically publishes `<requestId>.head` (the committed
byte count, private mode `0600`) through a synced temporary file and directory sync.
Readers ignore every byte beyond this marker, including complete but unpublished
terminal lines. A persistence error poisons the record writer. Legacy markerless
records may be inspected but cannot supply a reconnect outcome.

Explicit wire-level `detachable: true` requires `recordDir`. After commit, parent
EOF or a disconnected output channel can leave the host running under its
original deadline and output limit. A private `<requestId>.cancel` file requests
cancellation; it does not prove termination. Detachable executions persist their
bounded stdout/stderr as hex, even if the parent remained connected through the
last event. This closes the terminal-delivery/disconnect race without appending
records after the terminal. Non-detachable executions do not persist output.

The production Node broker selects detachable execution for the writer and its
sequential verifiers in `linux-command-v1` when the operator sets
`OMK_RUST_EXECUTION_RECONNECT=1` along with the native binary selection before
planning. The default remains cancel-on-parent-loss.
Explicit `omk run reconnect`/`RunCoordinator.reconnect` reacquires exclusive observer
leases and binds the original grant, claims, execution ID, namespace, boot and
run generation. It observes the same execution, never dispatches a replacement or
renews its deadline. A verifier intent additionally binds its frozen candidate,
check claim and receipt timeout. Native output/timestamps make check receipt
publication idempotent across a parent crash; only never-dispatched checks receive
new grants. Verification uses its original phase deadline, not the work deadline.
See [the command and limits](../../packages/coding-agent/docs/rust-execution-host.md#reconnect-the-same-native-writer-opt-in)
and [verifier continuation](../../packages/coding-agent/docs/rust-execution-host.md#reconnect-the-same-verifier).

Reconnectable records are retained across settlement/candidate/verification crash
windows. Explicit `omk run gc` can retire records only once recovery is closed,
the original grant is terminated, both host and namespace are gone, retention has
elapsed and private bytes still match. It syncs a `.gc.jsonl` retirement rename
before removing companions, keeping interrupted cleanup retryable. Unprovable,
orphan, legacy and recoverable records remain untouched; no background GC runs.
See [retention and GC](../../packages/coding-agent/docs/rust-execution-host.md#native-record-retention-and-gc).
File trust is same-user, as for the existing journal. This is not authenticated remote IPC, cross-boot execution
recovery, a multi-run scheduler or general session/provider reattachment.

## Transport limits

Incoming start frames are at most 262,144 bytes, control frames at most 1,024 bytes,
and output frames at most 65,536 bytes. At most four control frames are read.
Reader queues and the outbound queue each hold at most eight messages. A parent
that stops reading cannot block the supervisor on stdout: a full outbound queue
fails the host and cancels its owned sandbox. Terminal output waits only for a
bounded flush acknowledgement. This is not resumable network IPC.

The stdin reader and outbound writer are CLI-process-scoped threads. Output
readers join on witnessed normal termination. An unrecoverable channel/cleanup
failure ends the CLI process, which closes its remaining local threads and
reports no successful settlement. Cancellation is not assumed to prove cleanup.

## Sandbox

The fixed backend is Linux `/usr/bin/bwrap` with unshared namespaces, parent-death
handling, capability drop, empty environment, read-only `/usr`, private `/proc`,
`/dev` and `/tmp`, and one read-only or writable `/workspace` bind. A fixed shell
wrapper duplicates the metadata descriptor without unsafe Rust or descriptor
libraries. Commands are argv arrays, not interpolated shell strings. Operator
shell commands remain possible only when explicitly present in the approved argv.

Windows and macOS are unsupported. Git publication retains the existing Node
backend; this host accepts no publication mounts. It is not a multi-run scheduler,
a grant issuer, a Rust port of the durable journal, or a replacement for all tools.

## Build and checks

Use a checksum-verified isolated Cargo cache, external target directory, cleared
environment and network-disabled sandbox with read-only source/toolchain, as for
the sibling native crates. Cargo offline mode alone is not an OS sandbox. The
lock reuses the same eleven pinned Serde dependencies; no new third-party package
or unsafe Rust was added. See [dependency notices](THIRD-PARTY-NOTICES.md).

```sh
cargo test --offline --locked --manifest-path native/omk-execution/Cargo.toml
cargo clippy --offline --locked --manifest-path native/omk-execution/Cargo.toml -- -D warnings
cargo fmt --manifest-path native/omk-execution/Cargo.toml --check
cargo build --release --offline --locked --manifest-path native/omk-execution/Cargo.toml --bins
```

Set the resulting host executable to owner-controlled executable permissions;
group/other-writable binaries are rejected. The runtime binding pins its canonical
path and SHA-256 for the process lifetime and rechecks both before dispatch.
See [runtime selection and acceptance](../../packages/coding-agent/docs/rust-execution-host.md).

## Budget mathematics

For timeout T, limit L, retained bytes u, elapsed e and chunk b, the production
reducer continues only when elapsed has not regressed, e < T and b <= L-u.
It adds b only after the subtraction comparison, avoiding addition overflow.

Induction on accepted chunks establishes 0 <= u <= L: the initial u is zero;
acceptance requires b <= L-u; rejection leaves u unchanged. The first failure is
latched, so later input cannot restore dispatch eligibility or replenish budget.
The deadline comparison is inclusive at e = T. This describes decision semantics,
not a hard real-time guarantee for OS scheduling or uninterruptible processes.

The independent base-R oracle uses prefix sums and the earliest violating index,
not the Rust state-machine implementation. It compares 6,566 fixed traces,
including exact time/byte limits, backwards time and a large exact integer, and
rejects a changed decision. This finite comparison is not a formal proof of the
entire host or its concurrent/process behavior.

```sh
OMK_RSCRIPT=/path/to/Rscript node scripts/architecture/verify-execution-budget.mjs \
  /path/to/new-evidence-directory /path/to/budget-fixtures
```
