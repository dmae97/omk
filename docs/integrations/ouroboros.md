# Ouroboros integration (embedded in OMK)

[Ouroboros](https://github.com/Q00/ouroboros) is a spec-first "Agent OS"
(PyPI `ouroboros-ai`). OMK embeds it through the documented runtime-adapter
surface that Ouroboros already supports for the `pi`-family CLI that OMK builds
on:

- an **MCP server** (`ouroboros mcp serve`, ~29 `ouroboros_*` tools) registered in OMK's MCP config,
- the official **`ooo` bridge extension** installed into OMK's agent extensions dir, so `ooo ...` works inside interactive OMK sessions, and
- the 20 Ouroboros **skills** (SKILL.md) installed namespaced as `ouroboros-*`.

Ouroboros owns its own workflow engine; the OMK runtime CLI is selected as its
`runtime_backend` (a `--mode json` subprocess). This follows the runtime guide
in the Ouroboros repository.

## Prerequisites

- Python `>=3.12`, `uv` (or `pipx`), and the OMK runtime CLI on `PATH`.
- OMK global agent dir at `~/.omk/agent` (extensions, skills, `mcp.json`).

## Install (reproducible)

```bash
# 0. Back up the global MCP config (mode 600, contains secrets) before merging.
ts=$(date +%Y%m%d-%H%M%S)
cp -a ~/.omk/agent/mcp.json ~/.omk/agent/mcp.json.bak-$ts

# 1. Install the package with MCP support.
uv tool install 'ouroboros-ai[mcp,claude]'      # or: pipx install 'ouroboros-ai[mcp,claude]'

# 2. Non-interactive runtime setup: writes ~/.ouroboros/config.yaml
#    (runtime_backend) and generates the ooo bridge extension.
ouroboros setup --runtime pi --non-interactive

# 3. Mirror the generated ooo bridge into OMK's extension dir.
#    (locate the file Ouroboros generated, regardless of upstream dir)
BRIDGE_SRC=$(find "$HOME" -maxdepth 4 -name ouroboros-ooo-bridge.ts -not -path '*/.omk/*' 2>/dev/null | head -1)
cp "$BRIDGE_SRC" ~/.omk/agent/extensions/ouroboros-ooo-bridge.ts

# 4. Register the MCP server in OMK (additive jq merge; keep mode 600).
OURO_BIN="$(command -v ouroboros)"
jq --arg bin "$OURO_BIN" '.mcpServers.ouroboros = {command:$bin, args:["mcp","serve"], env:{}}' \
  ~/.omk/agent/mcp.json > /tmp/omk-mcp.new \
  && python3 -m json.tool < /tmp/omk-mcp.new >/dev/null \
  && install -m600 /tmp/omk-mcp.new ~/.omk/agent/mcp.json && rm -f /tmp/omk-mcp.new

# 5. Install the 20 Ouroboros skills (namespaced).
git clone --depth 1 https://github.com/Q00/ouroboros.git /tmp/ouroboros-src
for d in /tmp/ouroboros-src/skills/*/; do b=$(basename "$d");
  mkdir -p ~/.omk/agent/skills/ouroboros-$b;
  cp "$d/SKILL.md" ~/.omk/agent/skills/ouroboros-$b/SKILL.md; done
```

> The MCP entry uses the absolute `ouroboros` binary path because OMK sanitizes
> the child environment; a bare `ouroboros`/`uvx` command may not resolve under
> the sanitized `PATH`.

## Verify

```bash
ouroboros --version
ouroboros mcp serve --help                  # MCP entrypoint
ouroboros dispatch --help                   # ooo bridge dispatch entrypoint
test -f ~/.omk/agent/extensions/ouroboros-ooo-bridge.ts && echo "omk bridge OK"
grep -q ouroboros ~/.omk/agent/mcp.json && echo "mcp registered"
ls -d ~/.omk/agent/skills/ouroboros-* | wc -l   # expect 20
grep runtime_backend ~/.ouroboros/config.yaml   # expect: pi
```

A successful MCP handshake reports `serverInfo: ouroboros-mcp` and ~29
`ouroboros_*` tools. In an interactive OMK session, after restart or `/reload`:

```text
ooo status
ooo auto build a small CLI
```

## Scope and safety notes

- The `ouroboros` MCP server is registered in the **global** `~/.omk/agent/mcp.json`,
  so it is available under all-scope MCP sessions. Default project-scope sessions
  (`omk-project` only) are unaffected, so OMK startup is not slowed by Ouroboros.
- `ouroboros setup` mutates `~/.ouroboros/config.yaml` and the upstream runtime's
  global extensions dir; it does not touch the OMK repo.
- First MCP cold start resolves the uv tool venv and can be slow; `omk mcp doctor
  ouroboros` may need a longer timeout on first run.

## Rollback

```bash
ts=<backup timestamp>
rm -f ~/.omk/agent/extensions/ouroboros-ooo-bridge.ts
[ -f ~/.omk/agent/mcp.json.bak-$ts ] && install -m600 ~/.omk/agent/mcp.json.bak-$ts ~/.omk/agent/mcp.json
rm -rf ~/.omk/agent/skills/ouroboros-*
uv tool uninstall ouroboros-ai                # or: pipx uninstall ouroboros-ai
```
