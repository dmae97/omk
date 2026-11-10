# OMK v1.5.11

OMK 1.5.11 is a patch release from `main`. It brings safer edit recovery,
Anthropic Fable 5.2 catalog support, Codex streaming fixes, read-only
workspace/run inspection, status-panel improvements and scoped dependency
security updates. Rust-core and v2 development are not included.

## Editing and provider fixes

- Ambiguous overlapping `oldText` matches are rejected without writing the file.
  Failed edits add bounded read ranges, candidate positions or an observation that
  the replacement is already present. Multi-edit failures remain atomic; successful
  edit responses and write permissions are unchanged (#363, #369).
- Claude Fable 5.2 is listed for Anthropic, Bedrock, OpenCode, OpenRouter and Vercel
  AI Gateway with its supported adaptive reasoning efforts. Eligible first-party
  Anthropic requests use the official refusal fallback, retaining the responding
  model, catalog cost and refusal categories. Proxies and Haiku 5.5 are excluded
  (#368).
- OpenAI Codex SSE accepts bare-CR line endings. Unknown fields and malformed retry
  hints do not terminate a turn; an unfinished stream buffer is bounded to
  16,777,216 characters (#365).
- Compaction and branch-summary retries distinguish transport status codes from
  numbers in message bodies, so a validation message containing `5000` no longer
  causes an unnecessary provider retry (#364).

## Inspection and verification

- `omk explore <question>` returns bounded, read-only workspace evidence with paths,
  line ranges and explicit coverage/truncation information (#316).
- `omk run graph RUN_ID` and `readRunGraph()` expose a read-only ledger/authority
  snapshot. A successful read is not a passing verification verdict (#343).
- `/goal verify --reuse` reuses a passing receipt only for the matching workspace
  state and goal generation. Plain `/goal verify`, `--force` and `--rerun` still
  execute the check (#315).

## Terminal and usage

- The pinned status panel uses the hybrid OpenTUI renderer by default, with native
  fallback on unsupported Node versions, a missing optional dependency, renderer
  failure or timeout. `OMK_OPENTUI_STATUS_RAIL=0` selects the native sidebar (#350).
- Host CPU/RAM, session TODO progress and read-only `/rnode` run observations appear
  in the status area. The startup deck avoids duplicate status columns, and a
  custom extension footer owns the status slot while installed (#344, #349,
  #351, #353, #354).
- `OMK_TMUX_STATUS_RAIL=1` moves the status rail to a separate tmux pane
  (**flag, default off**; requires an existing tmux session). Narrow terminals or
  failed splits retain the native layout (#352).
- Extension `render()`/`invalidate()` exceptions are isolated instead of crashing
  the TUI; tool/message content is retained and a failed custom editor restores
  the default editor (#355).
- META subscription usage is read through the official Muse Code CLI when the
  corresponding OAuth login is configured. Unknown usage remains unknown, not
  zero. Global-only `subscriptionUsageProviders` limits the usage groups shown and
  requested; `[]` suppresses every usage request (#356, #357).
- Kimi usage requests identify as OMK rather than impersonating Kimi CLI (#358).

## MCP compatibility

- The client offers protocol `2025-11-25`, accepts the supported older revisions
  including `2025-03-26`, and reports bounded startup failure codes without exposing
  server stderr or payloads (#326).
- Server labels beginning with a non-letter gain an `mcp_` prefix in tool names:
  `21st__search` becomes `mcp_21st__search`. Update explicit allow/deny lists using
  the old names.
- `tools/call` accepts JSON values in `structuredContent`, including non-objects.
  This is intentionally more permissive than MCP's object-only definition; invalid
  JSON values, accessors, non-plain objects and excessive nesting remain rejected.

## Ontology comparison

- Experimental `OMK_ONTOLOGY_SHADOW=1` records a worktree-scoped comparison between
  native Context Budget selection and a bounded local metadata index. It requires
  active Context Budget and remains default-off. Shadow results never select prompt
  content, and the store keeps approved metadata rather than raw prompts, queries,
  commands or absolute paths (#379).

## Dependency security

- `undici` 8.12.4 rejects mismatched integrity metadata surrounded by ASCII
  whitespace. OMK selects the explicit npm implementation on Bun and preserves
  pre-created Request fields across lazy dispatcher installation. Cache/redirect
  advisories require their affected interceptors, and Node's built-in fetch is not
  replaced by this update.
- `glob` 14.0.4 and direct/root-override `minimatch` 11.0.5 retain the existing
  TypeBox and brace-expansion pins. Published ESM/CJS bundles and the shrinkwrap
  were checked directly. No startup or per-worker memory reduction is claimed.

## Packaging and maintenance

- Runtime `glob`/`minimatch` updates address GHSA-3g3m-2fjr-6pw4 and
  GHSA-g3hv-75wg-m249, including the published shrinkwrap (#332).
- npm artifacts include the applicable MIT license notices. Author/contributor
  metadata records OMK's maintainers and its pi origin (#318, #320).
- Bundled pstack content targets OMK paths and delegation contracts; installing
  project content remains explicit (#313).

All seven public workspace packages are released at 1.5.11. Rust-core and v2
development are not included.
