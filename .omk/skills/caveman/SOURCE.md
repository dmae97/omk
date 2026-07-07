# SOURCE — caveman skill (OMK port)

## Upstream

- **Repo:** https://github.com/JuliusBrussee/caveman
- **Pin (commit hash):** `0d95a81d35a9f2d123a5e9430d1cfc43d55f1bb0`
- **Branch:** `main`
- **Date:** 2026-07-03
- **Commit subject:** `chore: sync SKILL.md copies [skip ci]`
- **License:** MIT — `Copyright (c) 2026 Julius Brussee` (preserved verbatim in `LICENSE`)

## Source file acquired

- `skills/caveman/SKILL.md` (canonical upstream skill body)

Also read for accurate quoting (not ported into this skill, cited in SKILL.md):

- `README.md` — benchmark table, level table, honest-number warning box
- `docs/HONEST-NUMBERS.md` — measured figures and net-negative conditions
- `LICENSE` — MIT notice
- `commands/caveman.md` — `/caveman <level>` argument hint

## Acquisition method

```bash
git clone --depth 1 https://github.com/JuliusBrussee/caveman /tmp/caveman-pin
git -C /tmp/caveman-pin rev-parse HEAD
# => 0d95a81d35a9f2d123a5e9430d1cfc43d55f1bb0  (verified matches pin)
```

Pin verified at acquisition time via `git rev-parse HEAD` and `git log -1 --format='%H %cd %s' --date=short`.

## What was ported verbatim

The upstream skill body is preserved faithfully in `SKILL.md`:

- Persistence rule (active every response, off only on "stop caveman" / "normal mode")
- Rules (drop articles/filler/pleasantries/hedging; fragments OK; standard acronyms OK; no invented abbreviations cfg/impl/req/res/fn; no causal arrows; technical terms / code / errors byte-exact; preserve user's dominant language; no self-reference)
- Intensity table — all six levels: `lite`, `full` (default), `ultra`, `wenyan-lite`, `wenyan-full`, `wenyan-ultra`
- All upstream examples (React re-render, DB connection pooling, across levels)
- Auto-Clarity (security warnings, irreversible ops, ambiguous compression, clarification requests)
- Boundaries (code/commits/PRs normal style)

## OMK-specific changes (additive, clearly marked in SKILL.md)

These are additions for the OMK environment; upstream prose is otherwise unchanged.

1. **`disable-model-invocation: true`** frontmatter — excludes the skill from the auto-invocation `<available_skills>` list (`packages/agent` harness: `disableModelInvocation = frontmatter["disable-model-invocation"] === true`; `system-prompt.ts` filters it out). Guarantees opt-in: never auto-fires, only on explicit `/caveman` or a direct user brevity request.
2. **`/compact` prohibition** — OMK ships a builtin `/compact` slash command (`packages/coding-agent/src/core/slash-commands.ts:40`, "Manually compact the session context"). caveman must not register or respond to `/compact`; the only brief trigger is `/caveman` or `/caveman <level>`.
3. **OMK Auto-Clarity extension** — adds OMK-specific OFF triggers: spec/evidence/rationale artifacts (component-spec, visual-diff manifest, security report, migration plan, design rationale, ADR), AGENTS.md/CLAUDE.md/CHANGELOG/SOURCE.md/LICENSE edits, quoted command output (`npm run check`, tests, `git diff`), multi-step migration/release/deploy sequences.
4. **Precedence rule** — explicit: `task skill > safety/clarity > brevity`. caveman yields to any loaded task-specific skill and to any Auto-Clarity condition.
5. **headroom cross-link** — one-line: headroom compresses input/context, caveman compresses output prose; orthogonal and complementary.
6. **DOMAIN_PROFILES auto-load prohibition** — caveman is opt-in only; must never be added to any domain gate or loadout.
7. **wenyan note** — clarifies that wenyan modes output 文言文 by design (overrides language-preservation), flagging the Korean readability trade-off; terse-Korean users should use `lite`/`full`/`ultra`.
8. **Honest warning in description** — description states output-only, 0% input reduction, ~1–1.5k input added per turn, net-negative on terse Q&A / per-request billing.

## What was NOT ported (intentionally, out of scope or harmful in OMK)

These upstream pieces are deliberately excluded from this OMK skill:

- **SessionStart / auto-activate hook** (`src/hooks/caveman-activate.js`) — would force caveman on from message one. Violates the opt-in contract and the "no auto-activation pattern" constraint. Not ported.
- **`caveman-stats`** (`skills/caveman-stats/`, `src/hooks/caveman-stats.js`, statusline scripts) — reads a Claude Code session log format OMK does not produce; depends on agent-specific telemetry. Not ported. See Risks.
- **`caveman-compress`** (`skills/caveman-compress/` + Python scripts) — rewrites memory files (`CLAUDE.md` etc.) into caveman-speak. Overlaps with `headroom`'s input-compression role and would mutate repo rule files. Not ported.
- **`cavecrew-*` subagents** (`skills/cavecrew/`, `agents/cavecrew-*.md`) — separate agent role files, outside this skill's write scope.
- **`caveman-commit` / `caveman-review` commands** — separate slash commands; out of scope for this single-skill port.
- **`caveman-shrink` MCP middleware** — compresses foreign MCP tool descriptions; out of scope.
- **Plugin/installer machinery** (`.claude-plugin/`, `bin/install.js`, `install.sh`, `skills-lock.json`, etc.) — agent-specific install paths, not applicable to OMK's `.omk/skills/` layout.

## License

MIT, inherited from upstream. Copyright notice `Copyright (c) 2026 Julius Brussee` preserved verbatim in `LICENSE`. OMK-specific additions in `SKILL.md` are released under the same MIT terms.
