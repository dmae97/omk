# G1 clipboard dependency preflight

Date: 2026-11-13. Base: `3045c4ca2f` on `2.0.0`, shared dirty checkout.
Historical preflight status: **direct-source review only, not a resolved B1 bundle or implementation**.
Machine-readable observations: [g1-dependency-review.json](g1-dependency-review.json).

Follow-up: the owner subsequently authorized G1-only temporary resolution and transitive
review, excluding builds/adoption and any K1 changes. The [resolved B1 review bundle](g1-b1-review.md)
and [its frozen graph](g1-b1-review.json) record that work and its unresolved license/native
obligations. Final B1 approval remains pending. The observations and authorization-needed
sections below describe the earlier preflight checkpoint; its JSON is preserved unchanged.

Harness impact: **preserve**. Text copy, image paste, remote OSC 52 behavior,
headless/Termux refusal, WSL ordering and optional-addon failure behavior must not
regress. No speed or quality improvement is claimed.

## Authority and scope

Decision G1 selects an OMK-owned Node native addon based on `arboard` for six
release targets. B1 requires the owner to approve the stage's exact resolved
bundle, including licenses, build scripts, procedural macros and transitive count.
A selected library is not an approved graph.

J1 permits temporary resolution before approval **for K1 only**. J2 approves K1's
frozen graph only. Neither supplies a clipboard lockfile exception or G1 adoption.
The current request authorizes investigation and replacement work, but it does not
name a resolved G1 bundle or reverse B1's separate approval requirement.

This preflight uses registry metadata and checksum-verified published source
archives. It did not run Cargo resolution, create a temporary or production
`Cargo.lock`, compile dependencies, execute build scripts/macros, or change any
production manifest, lockfile, workflow or K1 file. Downloaded source remains in
ignored local evidence, not in the repository or published artifacts.

**Next authorization needed:** permit an isolated temporary G1 resolution manifest
and lockfile, registry metadata/source acquisition, `cargo generate-lockfile`,
`cargo metadata` and `cargo tree`, without compilation or production adoption.
That would allow a resolved review; the resulting exact B1 bundle still requires
owner approval before incorporation or dependency execution. No approval record
has been fabricated here.

## Current path

- `packages/coding-agent/src/utils/clipboard-native.ts` loads the optional package
  from the module root, then from the executable's directory. It skips Termux and
  display-less Linux. Its interface is `setText(): Promise<void>`, synchronous
  `hasImage()` and `getImageBinary(): Promise<number[]>`.
- `clipboard.ts` uses the addon for text on macOS/Windows only. Linux already
  relies on `wl-copy`, `xclip`/`xsel` and Termux tools to retain selection ownership.
  Remote sessions also emit OSC 52, with a 100,000-character encoded limit.
- `clipboard-image.ts` reads Windows clipboard first on WSL. An empty Windows
  clipboard must not resurrect stale Linux data. Wayland uses MIME negotiation
  through `wl-paste`/`xclip`, with per-source BMP conversion. Non-Wayland native
  reads currently label the returned bytes as PNG.
- The optional dependency is in `packages/coding-agent/package.json` and the npm
  locks/shrinkwrap. `scripts/cross-platform-clipboard` stages seven Pi packages;
  `scripts/build-binaries.sh` copies the wrapper and target binding. The Bun
  artifact prerequisite checker also names them. Renaming one require would leave
  the runtime and distribution dependency intact.

## Proposed direct pins, not approved dependencies

All defaults are disabled explicitly; selected features are listed below. The JSON
records archive checksums, normalized-manifest digests, declared target edges and
license-file observations. These edges are **not** a resolved dependency graph.

| Crate | Proposed pin | Features | Purpose | Declared license / MSRV |
|---|---|---|---|---|
| arboard | `=3.7.0` | `image-data` | Native text and RGBA image reads | MIT OR Apache-2.0 / 1.71.0 |
| napi | `=3.16.2` | `napi4`, `dyn-symbols` | Node-API ABI, worker tasks | MIT / 1.88 |
| napi-derive | `=3.7.1` | `strict` | Procedural bindings | MIT / 1.88 |
| napi-build | `=2.6.0` | none | Native link configuration in OMK build.rs | MIT / 1.88 |
| png | `=0.18.1` | none | Encode `arboard` RGBA as actual PNG | MIT OR Apache-2.0 / 1.73 |

The pinned repository toolchain is Rust 1.99.0, but an MSRV declaration does not
prove this candidate builds with it. No native addon or build helper was compiled.
These are a candidate set, not a preference for latest versions irrespective of
the eventual resolved graph.

### Observed build and license obligations

- `arboard`, `png` and `napi-derive` declare no build script. `napi-derive` is a
  procedural macro. It declares `napi-derive-backend`, `proc-macro2`, `quote`,
  `syn` and `convert_case`; their selected versions and licenses are unreviewed.
- `napi` includes `build.rs` and a `napi-build` build dependency. Its runtime
  declarations include `ctor`, `futures`, `napi-sys`, hash helpers and Unix `libc`.
  Disabling `async`/`tokio_rt` avoids selecting Tokio through this direct feature
  choice, but only a resolved graph can confirm actual feature unification.
- `napi-build` has no declared dependencies or own build script; it is executable
  build-helper code when called by an addon's build.rs. Source inspection found
  platform-specific link arguments and Cargo configuration output. It was read,
  not executed. The selected feature set does not authorize Android, WASI or GNU
  Windows support.
- `arboard` enables PNG codecs on Linux, TIFF on macOS and PNG/BMP on Windows
  through target-specific `image` dependencies. Its default Linux backend is X11.
  Native Wayland requires optional `wayland-data-control` and compositor protocol
  support. The initial candidate leaves that feature off and preserves existing
  Wayland CLI fallbacks rather than implying universal Wayland support.
- `windows-sys` has a broad declared range, `>=0.52.0, <0.62.0`. Do not assume it
  resolves like K1's graph or mutate K1 to share a version. macOS uses `objc2` and
  framework bindings; native SDK and loader evidence is still required.
- `arboard` and `png` archives include license texts, with digests in the JSON.
  The three N-API archives declare MIT but omit root license texts. Recover and
  verify notices from a matching pinned upstream revision before B1 adoption;
  package metadata alone is not a complete distribution notice bundle.
- Transitive count, transitive licenses, transitive scripts/macros, vulnerabilities
  and six-target selected graphs are **unknown**, not zero, clean or approved.
  The direct tarball checksum check is an integrity observation, not an audit.

## Implementation constraints after approval

1. Add a separate `native/omk-clipboard` crate, never a provider dependency. Keep
   direct pins exact and the approved graph frozen with `--locked`. Use the
   repository's seven npm package names; an addon does not authorize a new public
   workspace or npm package.
2. Keep loading optional and validate the binding's shape, ABI and target. Preserve
   both resolution roots, Termux and headless guards. No Pi fallback may survive
   the completed replacement. Remove the old package from all runtime manifests,
   locks, staging and binary prerequisites in the same independently verified unit.
3. Return real PNG, not RGBA bytes tagged as PNG. Prefer one atomic async native
   image read over `hasImage()` followed by another read: the clipboard can change
   between those calls. Distinguish empty data from unavailable backend/error.
4. Serialize clipboard access, particularly Windows' global clipboard. Avoid
   blocking the JS event loop with image decoding/encoding. Give workers, native
   clipboard state and teardown explicit ownership. Do not introduce a Tokio
   provider runtime just to expose Promise-returning clipboard methods.
5. Preserve Linux's CLI text-copy path until selection ownership has native
   evidence. `arboard` documents that dropping the clipboard or exiting can lose
   clipboard contents. A short-lived command or arbitrary sleep is not a fix.
6. Check dimension multiplication, RGBA length, pixel/byte limits and PNG output
   growth. Review upstream decoding allocations separately: validating the returned
   buffer does not retroactively bound allocations already made inside `arboard`.
   Never persist or log the user's clipboard as evidence.
7. Update Node package assets, shrinkwrap and Bun staging together. Build each
   target on its native runner under C6; do not replace this with Bun's ability to
   cross-compile the JS executable. Workflow edits outside C3's existing allowances
   need separate owner authorization. Preserve all license/notice assets.

## Required acceptance

Targets: darwin x64/arm64, linux GNU x64/arm64, Windows MSVC x64/arm64. WSL is Linux,
not native Windows evidence. No native desktop clipboard/runner is available in
this inspection; none of these targets is recorded as passing.

- RED/GREEN for missing/malformed addon, primary/secondary resolution roots,
  backend initialization failure, empty image, typed backend failure, PNG
  dimensions/pixels, overflow/oversized image and async cleanup.
- Existing text-copy, Wayland, WSL, BMP conversion and interactive attachment
  regressions stay passing, including remote OSC 52 and empty Windows precedence.
- Native addon loading and synthetic text/image round trips in an owned clipboard
  environment; do not overwrite the user's desktop clipboard to gather evidence.
- Node packed artifact and extracted Bun archive load the matching addon without
  a Pi package, source checkout links or network installation. Verify notices and
  archive target identity, not just the loader's mocked resolution calls.
- Run `node --test scripts/test/pi-inventory.test.mjs`, regenerate inventory and
  compare every removed row. Then `npm run check:pi-inventory`, the focused Vitest
  files and `npm run check`. Source inventory zero alone is not PZ1 acceptance.

These checks describe the completion contract. They have not been run against a
replacement because no replacement or resolved G1 bundle exists yet.

## Local verification of this preflight

- Published-source metadata parity, all five archive checksums, selected-feature
  existence, manifest digests and included license-file digests: passed. Explicit
  unknown graph/approval fields and absence of a G1 lockfile were checked.
- Existing clipboard Vitest baseline: 7 files, 31 tests passed. This exercises the
  old implementation and mocks, not an OMK addon or native desktop clipboard.
- Inventory regressions: 3 tests passed; freshness passed with 9 manifest deps,
  73 imports/mentions and one remaining source clipboard require. No inventory
  was regenerated or its coverage reduced.
- Document-link checker and scoped whitespace check: exit 0.
- `npm run check`: exit 1 at Biome, before native/contract stages. Failures were in
  concurrent extension exports/import ordering and `packages/speak-like-you-eat`,
  outside this preflight's files. No formatting fix was applied to those paths.
- Independent `tsgo --noEmit`: exit 2, including unresolved imports in the new
  custom-entry component, missing extension/context fixture fields and incomplete
  `speak-like-you-eat` modules. These were not repaired as clipboard work.

The shared checkout changed during observation, including three K1 source/test
files. This lane only read their hashes; it neither edited nor restored them.
There is no all-checks-green, native build or Pi-zero acceptance claim.

## Sources

Versioned registry and source URLs for all five candidates are in the JSON.
Relevant upstream API and operational notes:

- [Arboard 3.7.0 source](https://docs.rs/crate/arboard/3.7.0/source/)
- [Arboard 3.7.0 API](https://docs.rs/arboard/3.7.0/arboard/)
- [napi 3.16.2 source](https://docs.rs/crate/napi/3.16.2/source/)
- [napi-derive 3.7.1 source](https://docs.rs/crate/napi-derive/3.7.1/source/)
- [napi-build 2.6.0 source](https://docs.rs/crate/napi-build/2.6.0/source/)
- [png 0.18.1 source](https://docs.rs/crate/png/0.18.1/source/)
