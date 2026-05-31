#!/usr/bin/env bash
set -euo pipefail
npm run build:clean
KIMI_BIN=/nonexistent/kimi OMK_LEGACY_CHAT=0 OMK_MCP_PREFLIGHT=off OMK_PROJECT_ROOT="$PWD" node dist/cli.js chat --provider codex --mode agent --execution ask --layout plain --mcp-scope none --smoke --json
