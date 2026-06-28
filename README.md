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
  <a href="https://github.com/dmae97/open-multi-agent-kit/releases/tag/v0.90.1"><img alt="Release" src="https://img.shields.io/badge/release-v0.90.1-00d7ff?style=flat-square" /></a>
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

`v0.90.1` ships the OMK//CONTROL startup surface as the default operator view. The header reads `omk v0.90.1 · OMK//CONTROL`, using the published `open-multi-agent-kit` package version as the single source of truth.

The default dark TUI theme uses the `omk-control-grid-dark` Night City palette and keeps the control sidebar focused on route, evidence, loop, MCP, runtime, skills, and context budget state.

## Release v0.90.1

This release keeps the OMK hard-fork surface current with the standalone package line, autopilot automation, and high-reuse context cache work.

| Area | What changed |
|------|--------------|
| OMK identity | Standalone `open-multi-agent-kit`, `omk-ai`, `omk-agent-core`, and `omk-tui` packages stay lockstep across release docs, changelogs, and npm publishing. |
| TUI | OMK//CONTROL shows the package-backed `v0.90.1` startup header and Night City Ops control dashboard. |
| Autopilot | Browser-use automation is exposed through a local automation profile for repeatable operator workflows. |
| Context budget | Materialized context-budget v2 cache reuse raises optimizer-cache hit rates while preserving validation and telemetry boundaries. |
| Release | Local smoke tests, shrinkwrap gates, package lockstep, GitHub release notes, CI/CD, and npm publish checks remain part of the release path. |

GitHub-focused release notes live in [.github/RELEASE_NOTES_v0.90.1.md](.github/RELEASE_NOTES_v0.90.1.md). The GitHub release workflow also extracts the canonical release body from [packages/coding-agent/CHANGELOG.md](packages/coding-agent/CHANGELOG.md).

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
