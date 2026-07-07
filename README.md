<p align="center">
  <img src="readmeasset/omk-control.webp" alt="OMK//CONTROL Night City Ops Console for routing agents, evidence gates, telemetry, MCP scope, and operator control" width="100%" />
</p>

<h1 align="center">OMK</h1>

<p align="center">
  <strong>OMK//CONTROL — provider-neutral multi-agent control plane for coding workflows.</strong>
</p>

<p align="center">
  Models execute. OMK routes, verifies, measures, and controls.
</p>

<p align="center">
  <a href="https://discord.com/invite/3cU7Bz4UPx"><img alt="Discord" src="https://img.shields.io/badge/discord-community-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
  <a href="https://www.npmjs.com/package/open-multi-agent-kit"><img alt="npm" src="https://img.shields.io/npm/v/open-multi-agent-kit?style=flat-square" /></a>
  <a href="https://github.com/dmae97/open-multi-agent-kit/releases/tag/v0.90.5"><img alt="Release" src="https://img.shields.io/badge/release-v0.90.5-00d7ff?style=flat-square" /></a>
</p>

> New issues and PRs from new contributors are auto-closed by default. Maintainers review auto-closed issues daily. See [CONTRIBUTING.md](CONTRIBUTING.md).

---

# OMK Agent Harness Mono Repo

This is the home of the omk agent harness project including our self extensible coding agent.

* **[open-multi-agent-kit](packages/coding-agent)**: Interactive coding agent CLI
* **[omk-agent-core](packages/agent)**: Agent runtime with tool calling and state management
* **[omk-ai](packages/ai)**: Unified multi-provider LLM API (OpenAI, Anthropic, Google, …)

To learn more about omk:

* [Visit omk.dev](https://omk.dev), the project website with demos
* [Read the documentation](https://omk.dev/docs/latest), but you can also ask the agent to explain itself

## OMK//CONTROL TUI

<p align="center">
  <img src="readmeasset/omk_tui.png" alt="OMK//CONTROL terminal dashboard — live DAG lanes, provider routing, MCP health, evidence gates, and telemetry in Night City Ops Console style" width="100%" />
</p>

The OMK//CONTROL startup surface is the default operator view. The header reads `omk v<package.version> · OMK//CONTROL`, using the published `open-multi-agent-kit` package version as the single source of truth.

The default dark TUI theme uses the `omk-control-grid-dark` Night City palette and keeps the control sidebar focused on route, evidence, loop, MCP, runtime, skills, and context budget state.

## Release v0.90.5

This release collapses automatic reasoning routing to a single `/think auto` backed by the v4 confidence-bearing router, improves v4 real-world routing accuracy, and removes the legacy v1/v2/v3 routers and unused compaction modules.

| Area | What changed |
|------|--------------|
| Reasoning | Collapsed automatic reasoning-effort routing to a single `/think auto` backed by the v4 router; the `/think auto-v1/-v2/-v3/-v4` variants and the v1/v2/v3 routers are removed. Manual `/think <level>` still always takes precedence. |
| Accuracy | Extended the v4 keyword families (review/refactor/plan/debug vocabulary, Korean plan phrasing, negation-aware review) so real-world, out-of-gold-set prompts route correctly; an out-of-vocabulary probe improves from 22/30 to 30/30 while the frozen gold-set holdout and full set stay at 100%. |
| Internals | Consolidated the shared thinking-level resolver into `reasoning-router-resolver.ts` and removed the unused `compactor.ts` and legacy `token-optimizer.ts` modules, inlining compatibility telemetry in context-budget v2. |
| Subagent example | Added a deterministic capability router to the subagent example extension plus read-only `derive`/`check` capability scripts. |
| Pi+OMK | Shoutout to the Pi+OMK root-coordinator flow: DAG lanes, scoped grants, evidence, and verification stayed in the loop for this release. |

GitHub-focused release notes live in [.github/RELEASE_NOTES_v0.90.5.md](.github/RELEASE_NOTES_v0.90.5.md). The GitHub release workflow also extracts the canonical release body from [packages/coding-agent/CHANGELOG.md](packages/coding-agent/CHANGELOG.md).

## Share your OSS coding agent sessions

If you use OMK or other coding agents for open source work, publish sanitized sessions from `.omk/agent/sessions`.

Public OSS session data helps improve coding agents with real-world tasks, tool use, failures, and fixes instead of toy benchmarks.

## All Packages

| Package | Description |
|---------|-------------|
| **[omk-ai](packages/ai)** | Unified multi-provider LLM API (OpenAI, Anthropic, Google, etc.) |
| **[omk-agent-core](packages/agent)** | Agent runtime with tool calling and state management |
| **[open-multi-agent-kit](packages/coding-agent)** | Interactive coding agent CLI |
| **[omk-tui](packages/tui)** | Terminal UI library with differential rendering |

For Slack/chat automation and workflow integrations, use OMK extensions and MCP servers.

## Adaptorch MCP integration

[AdaptOrch MCP](https://adaptorch.ai.kr) is a separate, proprietary reliability-kernel service (not part of
this monorepo) that OMK can route orchestration tasks through: topology-aware DAG routing, multi-model
synthesis, and consistency verification. It is versioned `0.1.0` — an MVP stage — with a public-ready free
Starter tier and paid Pro/Team tiers, and is backed by a published paper
([arXiv:2602.16873](https://arxiv.org/abs/2602.16873)).

The `adaptorch` and `adaptorch-prod` MCP servers plus the `adaptorch-route` and `adaptorch-synthesize` skills
ship in OMK's default `omk-core-verified` execution preset, so they are available from the first prompt of a
default session without extra setup. Actually invoking AdaptOrch (e.g. `adaptorch_run`) still requires an
`ADAPTORCH_CONTROL_PLANE_TOKEN` (a dev token is auto-set for a local control plane at `127.0.0.1:8000`) and
follows normal task-routing rules rather than firing on every message.

This is distinct from `packages/adaptorch-wpl` in this monorepo, an experimental, design-stage Work Packet
Loop package that is not yet wired into the `open-multi-agent-kit` CLI — see that package's own README for its
current status.

## Permissions & Containerization

OMK does not include a built-in permission system for restricting filesystem, process, network, or credential access. By default, it runs with the permissions of the user and process that launched it.

If you need stronger boundaries, containerize or sandbox OMK. See [packages/coding-agent/docs/containerization.md](packages/coding-agent/docs/containerization.md) for three patterns:

- **OpenShell**: run the whole `omk` process in a policy-controlled sandbox.
- **Gondolin extension**: keep `omk` and provider auth on the host while routing built-in tools and `!` commands into a local Linux micro-VM.
- **Plain Docker**: run the whole `omk` process in a local container for simple isolation.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and [AGENTS.md](AGENTS.md) for project-specific rules (for both humans and agents).

## Development

```bash
npm install --ignore-scripts  # Install all dependencies without running lifecycle scripts
npm run build        # Build all packages
npm run check        # Lint, format, and type check
./test.sh            # Run tests (skips LLM-dependent tests without API keys)
./omk-test.sh        # Run OMK from sources (can be run from any directory)
```

## Supply-chain hardening

We treat npm dependency changes as reviewed code changes.

- Direct external dependencies are pinned to exact versions. Internal workspace packages remain version-ranged.
- `.npmrc` sets `save-exact=true` and `min-release-age=2` to avoid same-day dependency releases during npm resolution.
- `package-lock.json` is the dependency ground truth. Pre-commit blocks accidental lockfile commits unless `OMK_ALLOW_LOCKFILE_CHANGE=1` is set.
- `npm run check` verifies pinned direct deps, native TypeScript import compatibility, and the generated coding-agent shrinkwrap.
- The published CLI package includes `packages/coding-agent/npm-shrinkwrap.json`, generated from the root lockfile, to pin transitive deps for npm users.
- Release smoke tests use `npm run release:local` to build, pack, and create isolated npm and Bun installs outside the repo before tagging a release.
- Local release installs, documented npm installs, and `omk update --self` use `--ignore-scripts` where supported.
- CI installs with `npm ci --ignore-scripts`, and a scheduled GitHub workflow runs `npm audit --omit=dev` plus `npm audit signatures --omit=dev`.
- Shrinkwrap generation has an explicit allowlist for dependency lifecycle scripts; new lifecycle-script deps fail checks until reviewed.

## License

MIT
