---
name: mcp-install
description: Install, validate, and manage MCP servers for OMK using the curated catalog and parallel processing.
---

# MCP Server Installation Skill

Guide for adding MCP servers to an OMK project using the built-in catalog and parallel orchestration.

## Commands

```bash
# List configured MCP servers
omk mcp list

# Diagnose all MCP servers
omk mcp doctor

# Diagnose a specific server
omk mcp doctor <server-name>

# Install a single MCP server
omk mcp install <name> <command> [args...]

# Remove a server from project-local config
omk mcp remove <name>

# Sync global MCP servers into project
omk mcp sync-global
```

## Curated Catalog

OMK ships with a verified catalog in `src/mcp/server-catalog.ts` (or accessible via the runtime).
Recommended categories:

- **reasoning**: `sequential-thinking` — structured problem solving
- **memory**: `memory` — persistent knowledge graph
- **docs**: `pdf` — PDF text extraction
- **web**: `puppeteer` — browser automation
- **devtools**: `filesystem`, `sqlite` — file and database access
- **ops**: `railway` — remote Railway MCP; `supabase` — database management and edge functions

## Parallel Installation

When installing multiple servers (e.g., during `omk init`), OMK uses `Promise.all` for parallel setup.
Agents and hooks can also trigger bulk installs:

1. **Agent lane**: explorer validates which servers are needed
2. **Coder lane**: writes the MCP JSON entries
3. **QA lane**: runs `omk mcp doctor` to verify each server
4. **Hook**: `post-init-mcp.sh` runs non-blocking validation after init

## Rules

1. Prefer `npx -y <package>` so no global install is required.
2. Use `${PROJECT_ROOT}` and `${DB_PATH}` placeholders in catalog entries; they are resolved at install time.
3. Do not commit secrets in `mcp.json` env values.
4. Run `omk mcp doctor` after adding servers to confirm they start.
5. If a server fails to start, check `startup_timeout_sec` and network access.

## When to Use

- During `omk init` when selecting additional MCP servers.
- When a task requires a new capability (browser, PDF, database).
- Before reporting an MCP issue, run `omk mcp doctor --json` for structured evidence.
