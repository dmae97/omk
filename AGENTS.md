# OMK project rules

## Start

1. **Pstack first.** Read `pstack-poteto-mode` before exploring, planning or editing, after any required host gates. Use `.omk/skills/pstack/poteto-mode/SKILL.md` if installed; otherwise use a configured user copy or the [bundled OMK copy](packages/coding-agent/resources/pstack/skills/poteto-mode/SKILL.md). Read the matching playbook. If the skill cannot load, report why and work directly. This does not grant delegation or install anything.
2. **AdaptOrch for a real DAG.** When dependencies change the work order or verification, call the available AdaptOrch MCP `adaptorch_route_topology` with `from`/`to` edges and `prefer_ensemble_singleton=false`. Use `adaptorch_navigate_evidence` for a fixed evidence pack and run reads for an existing run. Follow stricter host gates. Advice does not authorize a run, delegation, data transfer or spend. If unavailable, report it and follow the permitted local path.
3. **Name the proof.** Resume from the prior checkpoint or identify the behavior and a check that would fail if it broke. Preserve other sessions' work.

## Code and verification

- Put recurring corrections in the API, type or boundary. Use lint or a regression test to catch mistakes still expressible. Fix misleading examples in scope. Keep comments for reasons the code cannot show. Drive UI changes through the real user path. [Source: Lauren Tan, All Code Is Slop (Except Mine)](https://ai.engineer/talks/O_zcc6Xl12g-all-code-is-slop-except-mine).
- The npm manifest owns toolchain versions and scripts. After non-doc changes run the focused tests, then `npm run check`. The check is not the full test suite. Run one test from its workspace with `node ../../node_modules/vitest/dist/cli.js --run test/x.test.ts`. Use `./test.sh` for the approved full non-e2e suite; never run full Vitest directly with live credentials. Build or run the full suite only when requested. Use `./omk-test.sh` for the source CLI.
- Coding-agent behavior lives in `packages/coding-agent/src/`; tests in its `test/`; user-facing changes in its `docs/`. For TUI changes verify the actual entry point. A source test does not prove an installed build or an already-running session picked up the change.
- TypeScript is strict and erasable in `packages/*/src`, `packages/*/test` and coding-agent examples. Keep imports at top level. Avoid `any`; inline trivial single-use helpers. Keybindings belong in `DEFAULT_*_KEYBINDINGS`. `scripts/check-module-size.mjs` owns the 250 pure-LOC ratchet. Read the relevant file before broad edits and preserve intentional behavior.
- Model catalog: edit generators in `packages/ai/scripts/`, never generated catalogs. Run `npm run models:refresh` as a separate reviewed operation; endpoint failures can remove models. Running model metadata may be overridden by the user `models.json`. Releases use the committed catalogs.
- Provider work: follow [the provider checklist](.omk/skills/add-llm-provider.md). Add a representative `stream.test.ts` model and applicable matrix cases. Gate live tests on the provider's own credential variable.
- Harness flags and opt-outs live in [environment variables](packages/coding-agent/docs/environment-variables.md). Keep the G0 flag-off session hash unchanged. Check spec 119 and `/goal` budget, stop and resume behavior when changing goal autonomy.

## Git, release and publication boundary

- Stage only authorized paths or hunks. No blanket stage, hard reset, worktree-wide checkout or clean, stash, hook bypass, or force-push. Commit, push, PR, merge and release stay within current approval. After a PR opens, merge `main` instead of rebasing or amending. One concern per PR. Use repo author `dmae97` on authorized commits.
- Merge only with green CI and approval of the current head; pin `gh pr merge N --merge --match-head-commit <sha>`. A head change needs new review. Workflow changes and new dependencies require owner review. Paid benchmarks need an owner-set dollar cap; pin the A/B baseline SHA. Public benchmark figures are "self-measured under TB 4.0 rules"; omit ranking claims.
- [The constitution](specs/constitution.md) owns releases and governance. Keep lockstep versions, leave released changelog entries unchanged, and document default-off behavior and measured claims accurately. CI publishes; do not publish or create a GitHub release by hand.
- Keep secrets out of source, logs and reports. Copy only MIT- or Apache-2.0-licensed code; name the source and update `NOTICE` for Apache-2.0. Public files must not copy or quote the private agent home. `scripts/check-private-agent-home.mjs` enforces this. Links in tracked files must resolve in a fresh clone; root `docs/` is ignored working material.
- Claude Code imports this file from `CLAUDE.md`. OMK chooses this file first and does not expand `@` imports. Keep shared behavior here and user preferences outside the repository.

<!-- OPENWIKI:START -->

## OpenWiki

Use `openwiki/` as leads, not startup reading or authority. Verify claims against source and tests. Check `.last-update.json` for the revision and `.manual-review.json` for a reviewed interrupted corpus. `scripts/check-openwiki.mjs` owns admission. The scheduled workflow owns generated pages.

<!-- OPENWIKI:END -->
