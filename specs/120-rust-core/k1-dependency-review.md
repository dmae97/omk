# K1 B1 dependency review

Date: 2026-11-12. Source baseline: `3045c4ca2f548865b4638759a4e253cd23333688`.
Scope: first Anthropic Messages request/SSE replay unit, not all of K1.
Historical review status: **resolution and static review completed; final B1 approval was pending**.
Follow-up: the owner approved B1, incorporation and builds on 2026-11-12 under
[J2 and the adoption record](k1-adoption.md). The frozen JSON and the review-time
observations below remain unchanged; pending checkboxes describe that checkpoint.
Harness impact: preserve request bytes, stream events, cancellation and G0/I1.

## Authorization and outcome

The owner approved a temporary resolution-only lockfile, explicitly excluding
builds and incorporation into the project. [Decision J1](decisions.md#j-k1-resolution-only-review-2026-11-12)
records this narrow exception to the original B1 lockfile restriction. It is not
approval of the resulting bundle. Production manifests and lockfiles are unchanged.

The review used an isolated HOME/CARGO_HOME and temporary manifest, empty library
placeholder and lockfile. Cargo 1.99.0 generated the lock and read metadata/tree
for six target triples. Registry sources were downloaded for inspection; nothing
was compiled or installed into the project. No dependency build script or proc
macro was executed. No Cargo target directory was created.

**Recommendation:** retain these candidates for owner review, with the explicit
crypto initialization, license/notice obligations and native-platform checks below.
Do not turn a successful resolver or an advisory-range check into B1 approval,
provider parity, platform acceptance or a claim of complete supply-chain safety.

## Frozen inputs and artifacts

[Machine-readable review](k1-dependency-review.json) contains every locked package,
source/checksum, declared license and license-file hashes, executable target
entry-point hashes, yanked observation, per-target feature/edge graphs, duplicate
versions and RustSec dispositions. No source code, credentials, private paths,
registry tokens or raw environment values are included. This JSON is not a Cargo
manifest or a dependency installation.

| Material | SHA-256 |
| --- | --- |
| Temporary manifest | `b337f150583dfe0909de7e1c82fb3f13884845cb1323981ae7506c55e0bc6599` |
| Temporary Cargo.lock | `264a67f792eed93a40a7e3f169d9646ded0ed007061c7c63540f64e3f506a6aa` |
| Review JSON | `609eb2e6889488a0c80bd3501d514daf14757b40a67ae9d419f061fe5d30cf93` |

The actual lockfile remains in the temporary review directory. The JSON records its
package rows for inspection and its byte digest; it is not an implicitly approved
replacement for any production lockfile. Raw metadata/tree logs remain local.

### Direct candidates

All defaults are explicitly off. Serde pins/features match the existing contract
crate; the three transport crates are new candidates.

| Exact pin | Declared license / MSRV | Features |
| --- | --- | --- |
| `tokio =1.54.1` | MIT / 1.85 | `rt`, `net`, `time`, `sync`, `io-util` |
| `reqwest =0.13.5` | MIT OR Apache-2.0 / 1.85.0 | `rustls-no-provider` |
| `rustls =0.23.46` | Apache-2.0 OR ISC OR MIT / 1.71 | `std`, `tls12`, `ring` |
| `serde =1.0.229` | MIT OR Apache-2.0 | `std`, `derive` |
| `serde_json =1.0.154` | MIT OR Apache-2.0 | `std`, `raw_value` |

Primary registry versions:
[Tokio](https://crates.io/api/v1/crates/tokio/1.54.1),
[Reqwest](https://crates.io/api/v1/crates/reqwest/0.13.5),
[Rustls](https://crates.io/api/v1/crates/rustls/0.23.46).
The manifest sets edition 2024, `rust-version = "1.99"`, resolver 3 and
`publish = false`; it has no dev dependencies. Highest declared MSRV among selected
packages is 1.88, below the pinned 1.99 toolchain. This is metadata compatibility,
not evidence that all packages compile successfully.

## Resolved graph

Counts are unique registry **name/version identities**, excluding the temporary
root. Transitive counts exclude all five direct dependencies, not only the three
new ones. Normal and build edges are retained separately; no root dev edge exists.

| Target (resolved from Linux x64 host) | Total | Direct | Transitive | Build-script packages | Proc-macro packages |
| --- | ---: | ---: | ---: | ---: | ---: |
| `x86_64-unknown-linux-gnu` | 90 | 5 | 85 | 12 | 5 |
| `aarch64-unknown-linux-gnu` | 90 | 5 | 85 | 12 | 5 |
| `x86_64-apple-darwin` | 92 | 5 | 87 | 12 | 5 |
| `aarch64-apple-darwin` | 92 | 5 | 87 | 12 | 5 |
| `x86_64-pc-windows-msvc` | 90 | 5 | 85 | 12 | 5 |
| `aarch64-pc-windows-msvc` | 93 | 5 | 88 | 13 | 5 |
| Six-target union | 99 | 5 | 94 | 13 | 5 |

- The lock contains 134 registry packages. Another 35 are target-inactive for
  these six graphs, including Android/WASM and other Windows architecture paths.
  They are inventoried separately, not counted as active dependencies.
- Nine selected package identities already appear in the five existing native
  locks; 90 do not. Existing production locks were not refreshed.
- Windows ARM64 selects both `windows-sys 0.52.0` and `0.61.2`. No other selected
  target has duplicate package-name versions. Do not force-unify these semver lines.
- Every archive checksum matched both lockfile and downloaded registry index.
  All 134 resolved versions were not yanked at review time.
- Each target's reachable metadata package set exactly matched `cargo tree` with
  normal/build edges. Metadata alone overapproximated five packages' features and
  two edges per target (`icu_normalizer -> icu_properties`, `url -> serde`). The
  JSON therefore uses Cargo tree for effective feature sets and selected edges,
  retaining metadata's kind/cfg and the extra metadata-only material separately.
  This distinction prevents inactive features from becoming approval scope.
- Selected Rustls features are `ring,std,tls12`; AWS-LC, native-tls/OpenSSL, HTTP/2,
  HTTP/3, compression and Tokio attribute macros are not enabled by this proposal.
  Tokio's empty `default` feature can still appear through feature unification.

**Host limitation:** these are Linux-host resolution graphs, not native macOS or
Windows builds. Build dependencies and proc macros execute on the build host in a
future build, so native-host graph validation remains required. GNU Linux is the
reviewed candidate ABI; this does not certify musl or finalize release packaging.

## License review

Every selected package has a declared license and discoverable license/notice
files, hashed in the JSON. Metadata is not a legal opinion or full file-by-file
license audit. Material categories requiring explicit acceptance are:

| Selected expression | Package count | Review obligation |
| --- | ---: | --- |
| MIT, MIT OR Apache-2.0, Apache-2.0 OR MIT | 71 | Choose allowed alternative and retain required notices |
| Apache-2.0 | 1 | `sync_wrapper`; retain Apache license/notice obligations |
| Apache-2.0 OR ISC OR MIT | 3 | Includes Rustls/transport/native-certs; select allowed alternative |
| Apache-2.0 AND ISC | 1 | `ring`; both obligations, not an OR choice |
| ISC | 2 | `rustls-webpki`, `untrusted` |
| BSD-3-Clause | 1 | `subtle` |
| Unicode-3.0 | 18 | ICU4X/IDNA data and derive dependencies |
| (MIT OR Apache-2.0) AND Unicode-3.0 | 1 | `unicode-ident`; both parts apply |
| Unlicense OR MIT | 1 | `memchr`; MIT alternative available |

The existing MIT/Apache rule for **copied external code** does not automatically
approve all these dependency licenses. No external code or license corpus was
copied into production. B1 must explicitly review this inventory before adoption;
a distribution notice plan is required before shipping binaries.

Four inactive Android packages (`jni`, `jni-macros`, `jni-sys-macros`,
`rustls-platform-verifier-android`) declare licenses but did not contain standalone
license/notice files matching the inventory search. They are not selected for the
six reviewed targets. Enabling Android requires resolving this gap, not reusing
six-target approval. This search finding is not a claim that they have no license.

## Build scripts and procedural macros

All thirteen selected build-script entry points and five proc-macro entry points
are named and hashed in the JSON. Static review covered the following entry paths;
it was not a whole-source security audit and none of this code was executed.

| Packages | Observed build behavior / obligation |
| --- | --- |
| `ring 0.17.14` with `cc 1.11.1` / `find-msvc-tools` / `shlex` | Compiles C/assembly and static archives; packaged pregenerated assembly/objects are used. The git/pregeneration path also invokes Perl/NASM. Windows ARM64 explicitly switches to Clang when the selected compiler is not Clang. Future builders need native compiler/SDK review; no toolchain was installed here |
| `proc-macro2 1.0.107` | Invokes rustc version and compile probes under OUT_DIR; wrapper/RUSTFLAGS/RUSTC_BOOTSTRAP can influence that future execution. Pin/clean the build environment |
| `serde 1.0.229`, `serde_core 1.0.229` | Write a private module under OUT_DIR, query compiler version and emit cfg |
| `libc 0.2.191` | Compiler/target cfg detection; platform-specific version-command paths exist for other OS targets. Review the actual native-host path before shipping |
| `httparse 1.10.1`, `quote 1.0.47`, `zmij 1.0.23` | Compiler-version, SIMD/diagnostic/optimization cfg selection |
| `serde_json 1.0.154` | Arithmetic cfg chosen from target architecture/width |
| `icu_normalizer_data 2.4.0`, `icu_properties_data 2.4.0` | `ICU4X_DATA_DIR` can enable custom data cfg. Keep it unset in reproducible builds |
| `rustls 0.23.46` | Empty main with proposed features; `read_buf` would enable the nightly/rustversion branch and is off |
| `windows_aarch64_msvc 0.52.6` | Emits native linker search path for packaged Windows import libraries |

Proc macros: `serde_derive 1.0.229`, `displaydoc 0.2.7`, `yoke-derive 0.8.4`,
`zerofrom-derive 0.1.8`, `zerovec-derive 0.11.7`. Serde derives are inherited from
the existing serialization choice; the other derives arrive through URL/IDNA/ICU
paths. Turning off Tokio macros therefore does **not** remove compile-time code
execution. Macro entry points and filesystem/process/environment references were
inspected; that limited static scan is not a guarantee about generated code or all
helper modules. Future builds must treat macros and build scripts as executable
third-party code and give them no credentials or unnecessary network access.

## Runtime integration findings (not implemented)

1. **Explicit crypto initialization is mandatory.** Reqwest 0.13.5
   `src/async_impl/client.rs::default_rustls_crypto_provider` panics without a
   process provider when `rustls-no-provider` is used. Enabling `rustls/ring`
   alone does not install it. The future owner must initialize Ring explicitly
   before Client construction or supply a matching explicit TLS configuration.
   Check conflicting process-global providers; do not hide initialization failure.
2. **Trust stores differ by platform.** `rustls-platform-verifier 0.7.1` uses
   macOS/Windows APIs and Linux native roots with WebPKI. Linux root discovery
   honors `SSL_CERT_FILE`/`SSL_CERT_DIR`; this is not automatically Node CA parity.
   OS revocation/network retrieval behavior needs separate policy and latency tests.
   Windows code uses cache-only chain-engine flags but also a revocation retrieval
   timeout; no blanket offline or zero-extra-network promise is made.
3. **Transport defaults are not the provider contract.** Redirects and retries
   remain in the selected stack even though Cargo defaults are off. Reqwest's
   documented default follows up to ten redirects and retries protocol NACKs.
   Explicitly match Node request, proxy, retry, deadline and cancellation semantics.
   No certificate-verification bypass is an acceptable parity fix.
4. **Native Windows ARM64 is a real build dependency risk.** Ring's Clang branch
   requires an appropriate native toolchain/SDK. Resolving a Windows target on
   Linux does not prove that requirement is met on a Windows ARM64 runner.

Versioned source references:
[Ring build](https://docs.rs/crate/ring/0.17.14/source/build.rs),
[Reqwest client](https://docs.rs/crate/reqwest/0.13.5/source/src/async_impl/client.rs),
[platform verifier](https://docs.rs/crate/rustls-platform-verifier/0.7.1/source/README.md),
[native certificates](https://docs.rs/crate/rustls-native-certs/0.8.5/source/src/lib.rs).

## Advisory review

RustSec snapshot: [`62d798d9a940a852b56ac482baa9f389ba5058b4`](https://github.com/RustSec/advisory-db/tree/62d798d9a940a852b56ac482baa9f389ba5058b4),
archive SHA-256 `b7411ede71f8190f467148551cc16cde69255cde8e6bc262148ba059d128c926`.

All 134 locked package identities were matched against this database. Sixty-one
advisory records matched package names: 58 resolved versions satisfy a patched
range, one satisfies an unaffected range, two records are withdrawn. **No matching
active affected version was found in this snapshot.** Every selected range branch
is stored in the JSON. Installed JS semver 7.8.0 was used for range selection;
every accepted branch was independently checked using numeric bounds because all
selected versions are stable and those branches use simple lower/upper bounds.

Important recent floors include:

- Tokio 1.54.1: patched for `RUSTSEC-2026-0384` and `RUSTSEC-2026-0386`.
- Rustls 0.23.46: patched for `RUSTSEC-2026-0346` through `RUSTSEC-2026-0349`.
- rustls-webpki 0.103.16: patched for `RUSTSEC-2026-0382`.
- Ring 0.17.14: patched for `RUSTSEC-2025-0009`; `RUSTSEC-2025-0010` only
  concerns versions before 0.17, and the blanket `2025-0007` notice is withdrawn.

No `cargo-audit` or `cargo-deny` binary was installed or compiled. This is a pinned
advisory/range review, not a claim that those tools passed, that no unknown
vulnerability exists, or that upstream packages cannot contain malicious code.
Refresh the snapshot and yanked observations before final adoption if time passes.

## Reproduction and checks performed

In a new temporary directory, use the exact package/directDependencies fields from
the review JSON to author the reviewed manifest and an empty `src/lib.rs`. Use the
already installed Cargo/Rustc 1.99.0 binaries, an isolated HOME and CARGO_HOME, no
inherited credentials/wrappers/config, and an isolated CARGO_TARGET_DIR. Then:

```sh
cargo generate-lockfile
cargo metadata --locked --format-version 1 --filter-platform <target>
cargo tree --locked --target <target> --edges normal,build --prefix depth --format '{p}|features={f}|license={l}'
cargo metadata --locked --format-version 1
```

The target-specific commands ran for each of the six triples above; all exited 0.
Fresh resolution at a later date may select different transitive versions. Such a
result requires a new review; it must not overwrite this frozen evidence silently.
The unfiltered command inventories lock-only targets, not a seventh release target.

Normalization walked each filtered resolve graph from its root over normal/build
edges and replaced package IDs with name/version. It compared reachable package
sets with Cargo tree, then took selected edge pairs and feature sets from that
same target's tree while preserving metadata kind/cfg and feature differences.
It verified all downloaded archive hashes against lock/index checksums and hashed
discovered license files and executable entry points. It excluded local absolute
paths. Tree feature sets are per-package occurrences, not a compiled unit graph.

Local validation exited 0 for JSON referential/count/feature/license/advisory
invariants, artifact digests, absence of private paths, unchanged production input
hashes and native manifest/lockfile file set, and absence of target/build artifacts.
`node scripts/check-doc-links.mjs` and `git diff --check` also exited 0. Self-review
caught metadata's feature/edge overapproximation and preserved its distinction
from the effective Cargo tree graph before freezing the final artifact.

`npm run check` was deliberately **not** run: it invokes native builds, outside J1.
No runtime test, provider call, workflow change, commit or publication occurred.

## Remaining approval gates

- [x] Resolve the proposed graph under J1 and record checksums/features/edges.
- [x] Inventory target counts, duplicate versions, licenses, build scripts and macros.
- [x] Review selected native build/trust-store risks and the pinned advisory snapshot.
- [x] Freeze sanitized evidence without modifying production dependencies.
- [ ] Owner B1 approval of this exact graph and explicit license/native-tool obligations.
- [ ] Separate authorization to incorporate dependencies and build/test them.
- [ ] Native-host graph/build validation on macOS and Windows, including ARM64 Clang.
- [ ] Independent Node recorder then Rust replay for the first provider, preserving
  Unicode/chunk boundaries, tool JSON, usage, errors, cancellation and EOF behavior.

The earlier preparation was unresolved; J1 allowed this review to close that data
gap. It did not complete K1 or relax the existing platform/provider-parity gates.
