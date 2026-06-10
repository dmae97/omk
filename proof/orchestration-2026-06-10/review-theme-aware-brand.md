# Theme-Aware Brand Chrome Re-Review

VERDICT: PASS

Scope: read-only re-review of `src/util/chat-cockpit.ts`, changed brand/cockpit/HUD/theme files, changed tests, and `proof/orchestration-2026-06-10/impl-theme-aware-brand.md`. Per instruction, ignored concurrent `AGENTS.md`, `CLAUDE.md`, `src/providers/*`, fable proof/tests, and provider/fable work.

## Findings

No blocking findings.

## Must-Fix Recheck

- `OMK_THEME=rust-forge` with default chat brand is no longer overwritten: `src/util/chat-cockpit.ts:139` resolves env chrome before chat brand, and neutral `omk` normalizes to `undefined`.
- The tmux launch path uses the resolved chrome theme: `src/util/chat-cockpit.ts:307` computes `chromeTheme`, `src/util/chat-cockpit.ts:318` passes it to the cockpit pane command, and `src/util/chat-cockpit.ts:419` passes it to tmux chrome application.
- `buildRightPaneCommand()` only injects recognized chrome themes: `src/util/chat-cockpit.ts:159` re-normalizes the input and `src/util/chat-cockpit.ts:161` prefixes `OMK_THEME` only when a recognized `night-city` or `rust-forge` value exists.
- `applyTmuxBrandTheme()` now consumes resolved chrome, not chat skin: `src/util/chat-cockpit.ts:198` calls `buildTmuxBrandChromeOptions()` with the launch-resolved value.
- Regression coverage exists for the default-brand/env path and command/chrome behavior: `test/chat-cockpit.test.mjs:367`, `test/chat-cockpit.test.mjs:378`, `test/chat-cockpit.test.mjs:384`, and `test/chat-cockpit.test.mjs:430` cover neutral `omk`, env rust-forge precedence, right-pane injection, and Night City/Rust Forge tmux chrome.

## Additional Checks

- Default Night City remains unchanged in the reviewed paths: default cockpit still asserts Neon Grid copy at `test/cockpit-render-core.test.mjs:26`, and tmux Night City bytes are asserted at `test/chat-cockpit.test.mjs:430`.
- Rust Forge live chrome works in both cockpit and tmux surfaces: `test/cockpit-render-core.test.mjs:34` covers `OMK_THEME=rust-forge`, and `test/chat-cockpit.test.mjs:443` covers Oxidized Forge tmux status/options.
- `P` and `BRAND_HEX` shape compatibility is preserved through stable object identity and in-place mutation coverage in `test/brand-theme.test.mjs`.
- No new runtime raw hex/SGR issue was found in changed source; color bytes are derived through theme JSON/palette helpers or appear only in tests/proof snapshots.
- Runtime version display remains dynamic via existing version helpers; the only reviewed hardcoded `0.78.6` occurrences are theme/proof metadata, not UI version output.

## Verification Notes

Trusted per request: `npm run build` passed; targeted `node --test` brand/cockpit/HUD/chat coverage passed; schema, theme, color, and secret gates passed. I did not rerun those gates.

## Residual Risk

- Tests cover resolver, command construction, and tmux chrome helpers separately rather than executing a full tmux session; source review confirms the composed launch path now uses `chromeTheme` throughout.
- Active brand palette state remains process-global by design; reviewed tests reset after rust-forge checks, and CLI process boundaries keep normal default/night-city behavior stable.
