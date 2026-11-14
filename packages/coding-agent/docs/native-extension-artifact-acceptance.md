# Native extension artifact acceptance

The local artifact gate validates a candidate without replacing the installed
engine. Source tests, packaged Node behavior, host-compiled Bun behavior and
installed declarations are separate checks. Passing one does not pass the others
or authorize the 2.0 milestone release.

## Locked offline consumer

`installConsumer` derives an ordinary consumer shrinkwrap from the reviewed root
lockfile. It replaces the seven internal workspace links with the exact local
candidate tarballs, relocates workspace-local dependency rows, and retains locked
third-party versions, URLs and integrity values. Workspace example manifests and
internal development dependencies are not consumer roots.

The installer uses `npm ci --offline --ignore-scripts --omit=dev` in a fresh owned
prefix with an isolated copy of the existing npm cache. It does not resolve fresh
semver ranges or fetch registry metadata. A missing archive still fails offline;
there is no network fallback. Install scripts, including third-party lifecycle
scripts, remain disabled.

Before installation the gate checks the projected lock against the reviewed
candidate. After installation it checks the resulting lock and the files of all
seven internal packages against the packed candidate. A different same-version
registry build is not accepted. The public CLI/SDK matrix then checks real
extension/provider/tool behavior through installed exports.

## Commands

Run from the candidate source checkout. The work root must be new, outside the
checkout, under the harness's approved temporary root, and exactly match
`OMK_NATIVE_ARTIFACT_ROOT`. Read the emitted fingerprint and pass it literally to
prepare; a changed source candidate invalidates the evidence.

```sh
node --test scripts/test/native-extension-consumer-lock.test.mjs scripts/test/native-extension-artifact-gate.test.mjs
node scripts/native-extension-artifact-gate.mjs fingerprint
node scripts/native-extension-artifact-gate.mjs prepare --work "$OMK_NATIVE_ARTIFACT_ROOT" --frozen-inputs "$FINGERPRINT"
node scripts/native-extension-artifact-gate.mjs node --work "$OMK_NATIVE_ARTIFACT_ROOT"
node scripts/native-extension-artifact-gate.mjs bun --work "$OMK_NATIVE_ARTIFACT_ROOT"
node scripts/native-extension-artifact-gate.mjs types --work "$OMK_NATIVE_ARTIFACT_ROOT"
node scripts/native-extension-artifact-gate.mjs verify --work "$OMK_NATIVE_ARTIFACT_ROOT"
```

The combined gate also requires current source-group receipts. Do not substitute
old results or create passing receipts for commands that did not run. Failed work
roots and logs are retained; retry in a fresh root rather than overwriting them.

The synthetic provider identifies its explicit fixture requests separately from
harness-generated follow-up prompts. Each explicit request gets a distinct tool
call ID. This keeps completion checks enabled and lets the SDK prove tool
execution again after reload without colliding with a previously settled call.
The SDK gate still requires four executions across reload and cwd replacement.

The npm regression includes both controls: range resolution fails with
`ENOTCACHED` when registry metadata is absent, while locked installation succeeds
using only the cached archive. Separate tests reject stale workspace identity and
preserve nested scoped dependencies without mutating the reviewed lock.

## Compiled Bun package.json resolution

Since Bun 1.3.4, standalone executables do not read on-disk `package.json` at
runtime unless built with `--compile-autoload-package-json`. Without it,
packages in a project's `node_modules` lose `main` and `exports` resolution;
only `index.*` fallbacks resolve, so `require("pkg/cjs")` from an installed
extension dependency fails. Plain `bun` and Node are unaffected. Both compile
commands, `scripts/build-binaries.sh` and `build:binary`, pass the flag.
`scripts/test/bun-compile-package-json.test.mjs` checks every compile command and
builds a real executable with the release flags to resolve `main`, a subpath
export and a nested CJS subpath. `.env` and `bunfig.toml` autoloading keep
Bun's defaults.

## Installed declaration boundary

The root `omk-ai` entry re-exports `GoogleThinkingLevel` from the SDK-free
`providers/google-thinking-level.ts`, so strict consumers no longer load
`@google/genai` declarations and their optional `@modelcontextprotocol/sdk`
peer. `packages/ai/test/public-declaration-sdk-boundary.test.ts` emits the root
declarations and fails on any new reachable provider-SDK import.

One reviewed edge remains: `AnthropicOptions.client` is typed as the
`@anthropic-ai/sdk` client, re-exported from `providers/anthropic-client.ts`. The
SDK is pinned at 0.92.0. Its declarations put `@ts-ignore` on its own line, so
strict consumers compile them; 0.91.1 produced seven TS2307 errors. The gate
keeps `skipLibCheck` off.

0.92.0 also reads `ANTHROPIC_CUSTOM_HEADERS` in the client constructor and merges
it into `defaultHeaders`, which the SDK applies after its auth headers. OMK uses
the same client for Anthropic-compatible third-party endpoints. An ambient value,
for example one set for another tool's proxy, would be sent to those endpoints
and could replace the selected `x-api-key` or `Authorization`. `OmkAnthropic`
restores the constructed `defaultHeaders`, so OMK keeps the pre-0.92.0 behavior:
request headers come only from `model.headers` and `options.headers`.
`packages/ai/test/anthropic-ambient-custom-headers.test.ts` runs the real SDK
against a local server for API-key and OAuth requests.

See [the migration roadmap](omk-2-migration.md) for the remaining Rust ownership,
R oracle, UI and platform acceptance requirements.
