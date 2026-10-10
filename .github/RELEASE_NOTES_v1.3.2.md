# OMK v1.3.2

## Install in one line, check your machine, and keep every notification

OMK 1.3.2 adds a checksum-verified installer for the standalone binary, an
`omk doctor` that tells you what blocks a first session, and a first run that
opens sign-in instead of failing your first prompt. It also fixes messages that
were lost while a session was compacting. All seven public workspace packages
move together to 1.3.2.

This is a patch release under OMK's version policy: fixes and additions, with no
breaking change to the SDK or CLI. A few defaults behave differently; read the
compatibility notes below.

## What's new

- **A verified one-line install.** Once this release's assets are published:

  ```bash
  curl -fsSL https://github.com/dmae97/omk/releases/latest/download/install.sh | sh
  ```

  The installer checks the archive against the release's `SHA256SUMS`, which it
  always takes from GitHub over HTTPS, even when `--base-url` names a download
  mirror (`--trust-mirror` opts into the mirror's file, with a warning). It
  installs into `~/.omk/versions/<version>`, switches `~/.omk/bin/omk` with an
  atomic rename, and never replaces an installed version directory. It needs
  `curl`. Release assets now include `SHA256SUMS` and a signed build-provenance
  attestation for the binaries and the installer:
  `gh attestation verify omk-linux-x64.tar.gz -R dmae97/omk`. See the
  [quickstart](https://github.com/dmae97/omk/blob/v1.3.2/packages/coding-agent/docs/quickstart.md).
- **`omk doctor`.** It checks the runtime, the agent directory, credentials,
  the model a first session would pick, the bash sandbox, `fd` and `rg`, and the
  network, and prints the fix for your machine. It is read-only, connects to
  nothing without `--online`, and exits 0, 1 (a check failed) or 2 (usage).
  Use `--json` for scripts.
- **A first run that starts with sign-in.** With no model configured, OMK opens
  the `/login` selector before your first prompt. If a Claude Code or Codex CLI
  login already exists, it names the `omk provider adopt` command that reuses it.
- **No more lost notifications during compaction.** A background-task
  notification or other extension message that arrived while the session was
  compacting, summarizing a branch, switching models for a retry or preparing a
  prompt failed with `PromptExecutionBusyError`, so the agent never woke up for
  it. After a manual `/compact` it could also be answered from the
  pre-compaction context. Such messages now reach the agent once, after that
  work, on the current context. Text you type in the TUI during compaction is
  sent when compaction ends instead of returning to the editor queue.
- **Faster start.** `omk --version` no longer loads the runtime (635 ms to
  62 ms for the Node CLI on the measurement VM). `fd` and `rg` download after
  the first frame, so a stalled network no longer delays the first screen
  (about 11 s to 1.2 s).
- **A clearer sandbox check.** The bash sandbox counts as available only when
  `bwrap` actually runs a command. Hosts that block unprivileged user namespaces
  get setup steps for that host instead of a raw `bwrap` error. See
  [Bash sandbox setup](https://github.com/dmae97/omk/blob/v1.3.2/packages/coding-agent/docs/sandbox-setup.md).
- **`omk run explain`.** Explains a verified run from one ledger snapshot: DAG
  dependencies, unfinished ancestors, candidate and receipt bindings, and claim
  closure. It changes nothing. The SDK equivalent is `RunCoordinator.explain`.
- **Opt-in RTK output filter.** `OMK_RTK_OUTPUT=1` summarizes long successful
  `vitest run` and `tsc --noEmit` output from the `bash` tool through RTK, which
  you install separately; the full output stays in a file. Off by default. See
  [RTK output filter](https://github.com/dmae97/omk/blob/v1.3.2/packages/coding-agent/docs/rtk-and-mutation-testing.md).
- **Model catalog.** Mistral Large 4 on Mistral and OpenCode Zen, a catalog
  refresh to 1,932 coding routes across 40 providers, and 61 image models. See
  the [ai changelog](https://github.com/dmae97/omk/blob/v1.3.2/packages/ai/CHANGELOG.md).

## Compatibility

- With no default model configured, credentials are now ranked stored login,
  then a provider API key, then ambient cloud credentials. With AWS credentials
  in the environment and `ANTHROPIC_API_KEY` set, a first session uses Anthropic
  instead of Amazon Bedrock. A configured default model is unchanged.
- On hosts where `bwrap` cannot create user namespaces, `omk doctor` and the
  bash tool report the sandbox as unavailable with setup steps, instead of
  failing at the first command with a raw `bwrap` error. Bash still refuses to
  run without a working sandbox.
- Follow-up input that arrives while another prompt is still being prepared
  waits for that prompt's run instead of failing. Registered extension commands
  run at once in that window; other slash text is still refused while the
  session is busy.
- The installer is Linux and macOS only; on Windows use WSL2. It does not verify
  the provenance attestation itself; run `gh attestation verify` for that.
- The 1.3.1 changelog entries now record what the 1.3.1 packages contain:
  changes that were still listed under Unreleased when `v1.3.1` was tagged are
  listed under 1.3.1.

## Upgrade

```bash
curl -fsSL https://github.com/dmae97/omk/releases/latest/download/install.sh | sh
# or, with Node.js 22.19 or newer
npm install -g open-multi-agent-kit@1.3.2 --ignore-scripts
omk --version
omk doctor
```

Restart any running OMK process after upgrading. A release is complete only when
the `v1.3.2` tag is reachable from `main`, its GitHub Release exists, and npm
`latest` points to 1.3.2 for all seven public packages.

## How this release was checked

These are scoped checks, not a certification:

- The local AdaptOrch command verifier ran 18 gates on the release candidate:
  build, the whole-repository `npm run check`, the onboarding, session-routing,
  compaction, model and verified-run test files, the installer end-to-end
  tests, built-CLI and terminal smoke tests, and the private-home boundary, with
  a negative control that must fail.
- A real `claude-haiku-4-5` session in the interactive TUI received a
  background-task notification that landed during automatic and during manual
  compaction. The build before these fixes, with 1.3.1's session code, lost the
  first and answered the second from the pre-compaction context.
- Mutation tests: each of 26 single-line reversions of the session-routing and
  TUI changes made at least one test fail.
- Installer: 11 kit checks and 12 hardening tests pass; the earlier installer
  draft fails the hardening tests.
- A reviewer from a different model family approved the installer, the session
  input changes and the onboarding follow-ups, after up to three rounds.

Not tested: macOS, native Windows, NixOS and setuid-`bwrap` hosts, and the
release workflow itself, which runs only on a tag.
