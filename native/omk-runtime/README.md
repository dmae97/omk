# Private offline wire fixture

`omk-native-wire` is an unpublished, standalone synchronous Rust crate, not an
installed agent, backend, tool registration, supervisor, or public SDK.

The only successful conversation is:

1. Receive `hello` with `{identity, controlSeq: 1}`.
2. Emit `ready` with the same owner and sequence, and
   `capabilities: {offlineOnly: true, backend: false, execute: false}`.
3. Receive matching `execute` with `{identity, controlSeq: 2}`.
4. Emit `result` with the same owner and sequence,
   `status: "unsupported"`, `started: false`, then exit successfully.

Each frame is exactly `{type, data}`. Identity has version
`omk.native-agent.v1`, five opaque IDs (`launchId`, `sessionId`, `promptId`,
`toolCallId`, `scopeEpochId`), positive safe-integer `generation` and `attempt`,
and a 64-character lowercase hexadecimal `grantDigest`. Each ID is 1..128 UTF-8
bytes. The integer ceiling is 9007199254740991.

`parse_request` is the input trust boundary. It feeds map-only visitors directly
into typed Serde containers without a `Value` or intermediate map. Unknown,
duplicate, escaped-equivalent duplicate, missing, and array-shaped containers
reject. The JSON decoder's default recursion limit remains enabled. Replies are
constructed from named-field structs, including object-shaped capabilities.

## Bytes and termination

- LF delimits frames. CR, BOM prefixes, empty frames, invalid UTF-8, and an
  unterminated final frame reject. An initial empty stream or EOF before execute
  fails the conversation.
- Payloads have a 262144-byte ceiling excluding LF. Input and output independently
  have an 8388608-byte ceiling including LF. Buffers check limits before extending;
  the input reader has a fixed 8192-byte read-ahead buffer.
- Replies are compact JSON, followed by LF. Their bytes roundtrip through
  `JSON.parse` then `JSON.stringify`; U+2028/U+2029 remain literal Unicode. Escaped
  control-looking text inside an ID remains string data.
- Stdout contains only protocol. Errors return a nonzero status and one static
  stderr code (at most 15 bytes including LF), never input, identifiers, or a JSON
  parser diagnostic. Invalid input never produces a completed result or cost.
- The worker stops after the second valid request. It neither drains later input
  nor supplies a progress queue, scheduler, timeout, backpressure, cancellation,
  recovery, process-tree settlement, or accounting guarantee.

Authored runtime code only reads stdin and writes stdout/stderr. It does not open
workspace files, spawn processes, connect to a network, or execute requests.
`forbid(unsafe_code)` applies to authored runtime code, not to dependencies.

## Dependencies and checks

`Cargo.lock` freezes eleven reviewed external packages. Direct dependencies are
exactly Serde 1.0.229 (`std`, `derive`, defaults disabled) and serde_json 1.0.154
(`std`, defaults disabled); workspace resolver is 3. No crate source is vendored.
See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), including the additional
Unicode-3.0 terms.

Build only with a separately prepared offline Cargo home and external target
directory, cleared environment, network-isolated bubblewrap namespaces, installed
toolchain read-only, and this source read-only. Build scripts and procedural
macros are not sandboxed merely by Cargo's offline flag. Do not fetch or repair a
shared cache to make this fixture build.

Required scoped gates are offline/locked Cargo check, test, fmt check, Clippy with
`-D warnings`, and release build. Library integration tests use in-memory readers
and writers, never spawned children. Executable TypeScript interoperability and
repository-wide acceptance are separate controller-owned gates. No release,
runtime confinement, performance, or cross-platform acceptance is implied.
