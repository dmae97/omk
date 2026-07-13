# Upstream source lock

Checked 2026-07-11. Re-verify before relying on exact versions, tool names, setup commands, or platform support.

## CUA

- Repository: https://github.com/trycua/cua
- Inspected commit: `688f10767a2d0032a7e3b94e7371c85372e32ac9`
- License: MIT
- Host-driver generated tool reference version: `0.7.1`
- Host-driver MCP: 38 snake_case tools over stdio
- Platform statement: macOS and Windows supported; Linux pre-release, with X11/XWayland preferred and native Wayland still maturing
- Primary source paths:
  - `README.md`
  - `libs/cua-driver/README.md`
  - `docs/content/docs/reference/cua-driver/mcp-tools.mdx`
  - `docs/content/docs/how-to-guides/driver/connect-your-agent.mdx`
  - `docs/content/docs/how-to-guides/driver/windows-ssh.mdx`
- Current risk evidence:
  - WSL path not yet validated: https://github.com/trycua/cua/issues/2099
  - Windows enumeration can hang after healthy MCP initialization: https://github.com/trycua/cua/issues/2110
  - Upgrade may leave a stale Windows daemon/task: https://github.com/trycua/cua/issues/2137

## Stagehand core

- Repository: https://github.com/browserbase/stagehand
- Inspected commit: `b07de539116521c72b8a36726fb7c95d755a475f`
- Core package version: `3.6.0`
- License: MIT
- Primary source paths:
  - `README.md`
  - `packages/core/package.json`
  - `packages/core/lib/v3/types/public/options.ts`
  - `packages/core/lib/v3/mcp/connection.ts`
- Verified capabilities: local Chromium/CDP, `act`, `observe`, `extract`, `agent`, and MCP-client integrations

## Official Browserbase MCP

- Repository: https://github.com/browserbase/mcp-server-browserbase
- Inspected commit: `1e196b3d3c4dc70944e0d19038dd9eb3608b207a`
- Release: `v3.0.0`, published 2026-03-31
- License: Apache-2.0
- Tools: `start`, `end`, `navigate`, `act`, `observe`, `extract`
- Primary source paths:
  - `README.md`
  - `package.json`
  - `src/tools/`
- Current risk evidence:
  - Prompt-injection boundary discussion: https://github.com/browserbase/mcp-server-browserbase/issues/159
  - HTTP disconnect session cleanup gap: https://github.com/browserbase/mcp-server-browserbase/issues/187

## Drift check

Before setup or API implementation:

1. Inspect the latest release and default-branch commit.
2. Compare the live generated Cua Driver tool roster or MCP `tools/list`.
3. Compare Stagehand's exported types and package version.
4. Compare Browserbase MCP's `src/tools/` roster and credential requirements.
5. Update this file only with cited upstream evidence.
