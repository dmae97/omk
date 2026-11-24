# K1 synthetic Anthropic vision requests

## Scope

This is one request-conversion continuation, not completed K1, live image delivery,
an agent loop or installed-engine adoption. It adds only the independently recorded
`synthetic-anthropic-vision` model. The existing `synthetic-anthropic` text-only
model and all earlier request/SSE/JSON/history corpora remain unchanged.

The shared checkout already contained the tool/thinking and non-vision content
slices plus a transport build-only probe. Those are preserved prerequisites, not
new work in this unit. No manifest, dependency, lockfile, notice, production Node
provider, model catalog, capability matrix, launcher or setting is changed.

## Independent Node oracle

- `scripts/fixtures/anthropic-vision-cases.ts` builds synthetic header samples.
- `scripts/fixtures/anthropic-vision-recorder.ts` invokes actual `streamAnthropic`
  and the official SDK with a distinct image-capable synthetic model.
- `scripts/record-anthropic-vision-fixtures.mjs` isolates HOME and allowlists the
  environment. Fetch is intercepted in memory, only `synthetic.invalid` and
  `faux-key` are accepted, and unexpected requests/retries are refused.
- `native/omk-providers/tests/fixtures/anthropic-vision.json` contains 50 captured
  SDK requests and source hashes. Expected bodies are SDK-serialized strings, not
  Rust output. Runtime/OS headers alone are projected out.
- `--check` compares fresh Node output without rewriting. Initial creation uses
  exclusive creation and refuses an existing corpus.

The initial compiled Rust tests failed twice: `png-limit` was refused as an
unsupported synthetic model, and the valid 4096-block vision boundary was refused.
The two Node oracle tests passed before implementation. A separate Node observation
recorded low UTF-16 byte handling for permissive base64 before the Rust decoder.
No expected request is supplied to the executable: its input is only
`{input, chunks: [], abort: false}`.

## Conversion

`request_content.rs` now converts image-capable user/tool blocks while retaining
the existing non-vision downgrade. `request_images.rs` ports the Node header guard
from `packages/ai/src/providers/anthropic-image-guard.ts`, retaining its MIT source
attribution. Existing wire blocks gain borrowed image sources and owned/borrowed
text for generated omission messages.

- User images preserve order and the original base64/MIME strings. Blank text is
  filtered after guarding; empty arrays still interrupt pending tool flow.
- Tool results become mixed arrays if any images remain. Image-only results gain
  `(see attached image)`; an existing empty text block prevents that insertion.
- Tool results with no remaining images become newline-joined text. Multiple
  oversized images retain separate omission messages, without non-vision dedup.
- Recognized PNG/JPEG/GIF/WebP dimensions above 1900px use the exact Node omission
  text. MIME labels do not select the sniffed header format.
- Header decoding examines only the first 87384 UTF-16 code units, permitting at
  most 65538 decoded bytes. JPEG marker scanning is bounded to that window.
- Base64 reproduces Node's URL alphabet, ignored characters, unpadded input,
  padding termination and low UTF-16 bytes. Unknown/short/malformed formats pass
  through unchanged, as Node does. This is not complete image validation and does
  not establish downstream API acceptance.
- The 4096-block limit counts original blocks, including orphan tool results.
  Strict tagged input still refuses missing/wrong/extra fields without CLI stdout.
- Vision replay permits only the empty response used to exercise the request
  entrypoint. Nonempty responses and cancellation are explicitly refused until
  an independent response oracle exists.

The 50 cases include 1900/1901 boundaries, u32/u24 dimensions, JPEG segment skips,
excluded markers, the last readable/beyond-window SOF positions, each WebP layout,
base64 variants, user/tool mixtures, image-only tool placeholders, orphan/error
filtering, missing-result synthesis and tool-group boundaries.

## Verification

Private logs, exact commands/exits, baseline hashes and before-images are in
`/tmp/omk-k1-vision-HqCnwn/README.md` and `verify.py`.

- Offline/locked Cargo tests pass: 23 tests, including 50 exact requests compared
  through both `build_request` and the actual executable.
- Cargo format and Clippy (`--all-targets -- -D warnings`) pass.
- Four new Rust tests cover request parity, invalid/bounded input, replay refusal
  and the bounded permissive base64 decoder.
- Strict recorder TypeScript compilation passes with `--ignoreConfig`.
- Six focused Node files pass in a read-only, network-disabled sandbox: 14 tests,
  zero skips. Fresh Node recording includes the new and earlier corpora.
- `npm run check` exits 0 in 257.986 seconds, including six native crates and
  repository guards. Its script subrun reports 743 total, 713 passed, 30 skipped,
  zero failures. This is not the full product Vitest suite or a live-provider run.
- Preservation audit passes: HEAD/index unchanged, exactly the 15 owned repository
  paths differ from the captured baseline, and `otherChanges` is empty.
- LSP probes are inconclusive for all seven paths. Compiler/test success is not a
  confirmed-clean LSP result.

The initial behavioral RED, subsequent intermediate compile error and initial
format findings remain non-passing evidence, not reclassified by final passes.

## Remaining work

No actual provider inference, HTTP image delivery, credential access, image
resizing, model-catalog/capability selection, cross-provider history, installed
runtime switch, commit or publication occurs here. Full K1, later Rust stages and
native platform acceptance remain incomplete. The standalone transport probe
remains build-only and receives no dispatch integration from this unit.
