# OMK v1.5.10

OMK 1.5.10 is a patch release. It bundles the pinned pstack project setup, adds a
prototype `omk codex-ultra` bridge and Terra catalog routes, bounds the TUI kill ring and
adaptive-effort state, and gives binary releases a manifest plus a reconciliation job.
Two lifecycle fixes stop leaked provider connections and hung proxy reads. New behavior
is opt-in, gated by a flag, or requires an explicit command.

## Behavior changes

- **`omk init --project` installs a bundled pstack snapshot** (#300). The pinned MIT
  content from `backnotprop/pstack` (commit `f51fdeba3d803ef90e4eaa4a95ffb4e76008ab37`)
  places 58 namespaced `pstack-*` skills under `.omk/skills/pstack/` and two adapted
  agents under `.omk/agents/`. An empty Git root's bare-launch bootstrap uses the same
  path. Initialization writes into the project only, preserves existing files, and does
  not fetch or execute upstream code. Existing projects are unchanged until they run it.
- **`omk codex-ultra` runs a separate Codex CLI session** (#299). It starts a
  non-interactive `codex exec` session in the current directory and requests the `ultra`
  reasoning effort after checking the installed CLI and its advertised model list. It
  does not transfer OMK's conversation, tools, extensions, credentials, approval policy,
  sandbox or verification status. It uses the Codex CLI's own account: if OMK and the
  Codex CLI are signed into different accounts, the task runs against the Codex CLI
  account. Standalone Bun and native Windows fail closed.
- **Acceptance diagnostics excerpt v3 is gated** (#176). `OMK_GOAL_DIAGNOSTICS_V3` is
  default off; unset or `0` keeps the 1.5.9 excerpt byte for byte.

## Added

- Bundled pstack project setup, preflighted against existing default project and user
  skill names before any write (#300).
- `omk codex-ultra` prototype bridge with process-group supervision, bounded output and
  fail-closed platform checks (#299).
- GPT-6.1 Terra in the OpenAI, Azure, OpenRouter and Vercel gateway catalog routes with
  the documented Terra reasoning ladder (#297). The newly listed Terra batch route stays
  out of the synchronous catalog pending verification.

## Fixed

- A proxied response that aborts after headers now rejects instead of leaving the OAuth
  fetch pending while buffered chunks are retained (#301).
- Each Bedrock stream destroys its per-stream SDK client and request handler after
  completion or error, and reports a cleanup failure instead of a false success (#304).
- The TUI editor and input kill ring keeps at most 128 entries and 2,097,152 UTF-16 code
  units, so repeated kills no longer retain text for the component's lifetime. The newest
  entry may exceed the character budget so it stays yankable (#302).
- Adaptive-effort deduplication tracks at most 8,192 distinct IDs and 1,048,576 UTF-16
  code units. Past either limit it stops adapting and passes the configured reasoning
  effort through for the rest of the wrapper lifetime instead of reclassifying forgotten
  calls (#306).
- Compaction keeps covered messages behind the boundary and preserves genuinely new
  assistant usage after a backward wall-clock step, so the next prompt is neither
  rejected with `context_input_capacity_exceeded` nor admitted over the hard ceiling
  (#296).
- The ultra thinking-level selector no longer implies that selecting the tier enables
  automatic task delegation (#305).

## Changed

- Binary releases ship `release-manifest.json` with `SHA256SUMS`, and the release job
  reconciles an existing GitHub Release by uploading only missing assets instead of
  skipping the upload. A same-name asset with a different digest stops the run (#311).
- Documentation rewrites the workflow sections around prompt cache boundaries, context
  budget, session history and host resources (#298), and scopes the subagent credential
  warning (#304).

## Internal

- Unit tests for JSON repair and streaming parse, abort-signal combination and surrogate
  sanitization.
- Vendored pstack suites isolated in tests; spec 097 diagnostics covered by holdout
  fixtures and a workflow contract test.
