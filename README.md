# OMK — Open Multi-Agent Kit

**Interactive coding-agent CLI with skills, hooks, MCP integration, session management, and a terminal control surface.**

This repository now publishes the same OMK coding-agent surface used by the maintainer: the `omk` binary from `packages/coding-agent`. The accidental foundation/control-plane CLI builds published as `0.78.x`, `0.79.3`, `0.80.0`, and `0.80.2` are deprecated on npm.

## Install

```bash
npm install -g open-multi-agent-kit
omk --version
omk
```

## Packages

| Package | Description |
| --- | --- |
| `open-multi-agent-kit` | Interactive OMK coding-agent CLI. |
| `packages/coding-agent` | CLI source, tools, skills/hooks runtime, themes, sessions. |
| `packages/ai` | Unified LLM provider API used by the CLI. |
| `packages/agent` | Agent runtime core. |
| `packages/tui` | Terminal UI library. |

## Development

```bash
npm install --ignore-scripts
npm run check
./test.sh
```

## Security

OMK runs with the permissions of the launching user/process. Use OS sandboxing, containers, or a restricted environment when running untrusted tasks.

## License

MIT
