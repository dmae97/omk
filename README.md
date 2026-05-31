# OMK

Project-aware AI coding runtime.

Install once. Resume every project. Route work through OMK-owned provider adapters.

Current source target: `1.2.0-rc.0` package RC for the `v1.2` runtime contract family. This is not a GA claim; see [versioning](docs/versioning.md) and [provider maturity](docs/provider-maturity.md).

Proof status: `omk.proof-bundle.v1` schema and `npm run proof:check` gate are available; public proof bundles are indexed at `proof/PROOF_INDEX.md` in the source tree. Current proof count: 8 scoped RC hardening bundles.

## Install

```bash
curl -fsSL https://get.omk.dev | sh
```

Inspect before running:
```bash
curl -fsSL https://get.omk.dev/install.sh
```

## Website

[omk.dev](https://omk.dev) — docs, model lanes, privacy, enterprise relay

## What it does

- **Project memory** — resumes context across sessions
- **Provider routing** — routes work across Kimi, MiMo, DeepSeek, Codex, OpenCode, OpenRouter, Qwen, and local adapters when configured
- **MCP orchestration** — auto-connects project MCP servers, skills, hooks
- **Consent & governance** — granular opt-in levels (L0-L4), never auto-opt-in

## Quick start

```bash
omk init          # detect project, choose runtime mode
omk               # start coding
omk consent       # privacy settings
```

## Security

- Safe by default: child env is sanitized, ambient secrets are dropped, and workspace-write routes require approval.
- OS-level sandboxing is planned, not claimed; see [SECURITY.md](SECURITY.md).
- Install script: [get.omk.dev/install.sh](https://get.omk.dev/install.sh)
- Checksums: [GitHub Releases](https://github.com/dmae97/open_multi-agent_kit/releases)
- Security policy: [SECURITY.md](SECURITY.md)

## License

[MIT](LICENSE)
