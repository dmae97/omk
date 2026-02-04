# Config Module Usage Map

This document shows how each file uses the config module and what subpaths they access.

## Overview Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              config.ts exports                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│ Constants:        APP_NAME, CONFIG_DIR_NAME, VERSION                            │
│ Single paths:     getAgentDir, getAuthPath, getModelsPath, getModelsYamlPath,   │
│                   getAgentDbPath, getToolsDir, getCommandsDir, getPromptsDir,   │
│                   getSessionsDir, getDebugLogPath, getCustomThemesDir,          │
│                   getChangelogPath, getPackageDir                               │
│ Multi-config:     getConfigDirs, getConfigDirPaths, findConfigFile,             │
│                   findConfigFileWithMeta, readConfigFile, readAllConfigFiles,   │
│                   findNearestProjectConfigDir, findAllNearestProjectConfigDirs  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Architecture Note

Many modules now use the **capability/discovery system** (`discovery/builtin.ts`) to load configuration files (skills, hooks, tools, MCP servers, etc.) rather than importing config helpers directly. The capability system provides a unified way to load resources from multiple sources (.omp, .pi, .claude, .codex, .gemini) with proper priority ordering.

## Usage by Category

### 1. Display/Branding Only (no file I/O)

| File                         | Imports                       | Purpose                  |
| ---------------------------- | ----------------------------- | ------------------------ |
| `cli/args.ts`                | `APP_NAME`, `CONFIG_DIR_NAME` | Help text, env var names |
| `cli/grep-cli.ts`            | `APP_NAME`                    | Grep command output      |
| `cli/jupyter-cli.ts`         | `APP_NAME`                    | Jupyter command output   |
| `cli/plugin-cli.ts`          | `APP_NAME`                    | Plugin command output    |
| `cli/setup-cli.ts`           | `APP_NAME`                    | Setup command output     |
| `cli/shell-cli.ts`           | `APP_NAME`                    | Shell command output     |
| `cli/stats-cli.ts`           | `APP_NAME`                    | Stats command output     |
| `cli/update-cli.ts`          | `APP_NAME`, `VERSION`         | Update messages          |
| `cli.ts`                     | `APP_NAME`                    | Process title            |
| `export/html/index.ts`       | `APP_NAME`                    | HTML export title        |
| `modes/components/welcome.ts`| `APP_NAME`                    | Welcome banner           |
| `debug/system-info.ts`       | `VERSION`                     | System info display      |

### 2. Single Fixed Paths (user-level only)

| File                                  | Imports                          | Path                        | Purpose                   |
| ------------------------------------- | -------------------------------- | --------------------------- | ------------------------- |
| `cli/config-cli.ts`                   | `APP_NAME`, `getAgentDir`        | `~/.omp/agent/`             | Prints config path        |
| `session/agent-session.ts`            | `getAgentDbPath`                 | `~/.omp/agent/agent.db`     | Database path             |
| `session/session-manager.ts`          | `getAgentDir`                    | `~/.omp/agent/sessions/`    | Session storage           |
| `session/agent-storage.ts`            | `getAgentDbPath`                 | `~/.omp/agent/agent.db`     | Settings/auth storage     |
| `session/auth-storage.ts`             | `getAgentDbPath`, `getAuthPath`  | agent.db, auth.json         | Auth credential storage   |
| `session/history-storage.ts`          | `getAgentDir`                    | `~/.omp/agent/`             | Command history           |
| `session/storage-migration.ts`        | `getAgentDbPath`                 | `~/.omp/agent/agent.db`     | JSON→SQLite migration     |
| `modes/theme/theme.ts`                | `getCustomThemesDir`             | `~/.omp/agent/themes/`      | Custom themes             |
| `modes/controllers/selector-controller.ts` | `getAgentDbPath`            | `~/.omp/agent/agent.db`     | Model selector state      |
| `utils/changelog.ts`                  | `getChangelogPath`               | Package CHANGELOG.md        | Re-exports path           |
| `migrations.ts`                       | `getAgentDir`, `getAgentDbPath`  | `~/.omp/agent/`             | Auth/session migration    |
| `extensibility/plugins/installer.ts`  | `getAgentDir`                    | `~/.omp/agent/plugins/`     | Plugin installation       |
| `extensibility/plugins/paths.ts`      | `CONFIG_DIR_NAME`                | `~/.omp/plugins/`           | Plugin directories        |
| `config/keybindings.ts`               | `getAgentDir`                    | `~/.omp/agent/keybindings.json` | Keybinding config     |
| `config/settings.ts`                  | `getAgentDir`, `getAgentDbPath`  | agent.db, config.yml        | Settings management       |
| `config/prompt-templates.ts`          | `CONFIG_DIR_NAME`, `getPromptsDir` | `~/.omp/agent/prompts/`   | Prompt template loading   |
| `ipy/executor.ts`                     | `getAgentDir`                    | `~/.omp/agent/`             | Python executor paths     |
| `ipy/gateway-coordinator.ts`          | `getAgentDir`                    | `~/.omp/agent/`             | Jupyter gateway socket    |
| `export/custom-share.ts`              | `getAgentDir`                    | `~/.omp/agent/share/`       | Custom share scripts      |
| `debug/index.ts`                      | `getSessionsDir`                 | `~/.omp/agent/sessions/`    | Debug session browser     |
| `ssh/connection-manager.ts`           | `CONFIG_DIR_NAME`                | `~/.omp/ssh/`               | SSH control sockets       |
| `ssh/sshfs-mount.ts`                  | `CONFIG_DIR_NAME`                | `~/.omp/remote/`            | Remote mount points       |
| `tools/read.ts`                       | `CONFIG_DIR_NAME`                | Config dir name reference   | Internal URL resolution   |
| `utils/tools-manager.ts`              | `APP_NAME`, `getToolsDir`        | `~/.omp/agent/tools/`       | Tool binary management    |

### 3. Multi-Config Discovery (with fallbacks)

These use helpers to check `.omp`, `.pi`, `.claude`, `.codex`, `.gemini` directories:

| File                                     | Helper Used                                            | Subpath(s)                  | Levels       |
| ---------------------------------------- | ------------------------------------------------------ | --------------------------- | ------------ |
| `main.ts`                                | `findConfigFile`                                       | `SYSTEM.md`, `APPEND_SYSTEM.md` | user+project |
| `sdk.ts`                                 | `getConfigDirPaths`                                    | `auth.json`, `models.yml`, `models.json` | user |
| `lsp/config.ts`                          | `getConfigDirPaths`                                    | `lsp.json`, `.lsp.json`     | user+project |
| `task/discovery.ts`                      | `getConfigDirs`, `findAllNearestProjectConfigDirs`     | `agents/`                   | user+project |
| `extensibility/plugins/paths.ts`         | `getConfigDirPaths`                                    | `plugin-overrides.json`     | project      |
| `extensibility/custom-commands/loader.ts`| `getConfigDirs`                                        | `commands/`                 | user+project |
| `web/search/auth.ts`                     | `getConfigDirPaths`, `getAgentDbPath`                  | auth.json, agent.db         | user         |
| `web/search/providers/codex.ts`          | `getConfigDirPaths`, `getAgentDbPath`                  | auth config                 | user         |
| `web/search/providers/gemini.ts`         | `getConfigDirPaths`, `getAgentDbPath`                  | auth config                 | user         |

### 4. Via Capability/Discovery System

These modules use `discovery/builtin.ts` which has its own config directory resolution:

| Capability      | Config Subpaths                    | Loaded Via                  |
| --------------- | ---------------------------------- | --------------------------- |
| skills          | `skills/`                          | `skillCapability`           |
| slash-commands  | `commands/`                        | `slashCommandCapability`    |
| rules           | `rules/`                           | `ruleCapability`            |
| prompts         | `prompts/`                         | `promptCapability`          |
| instructions    | `instructions/`                    | `instructionCapability`     |
| hooks           | `hooks/pre/`, `hooks/post/`        | `hookCapability`            |
| tools           | `tools/`                           | `toolCapability`            |
| extensions      | `extensions/`                      | `extensionCapability`       |
| mcp             | `mcp.json`, `.mcp.json`            | `mcpCapability`             |
| settings        | `settings.json`                    | `settingsCapability`        |
| system-prompt   | `SYSTEM.md`                        | `systemPromptCapability`    |

## Subpath Summary

```
User-level (~/.omp/agent/, ~/.pi/agent/, ~/.claude/, ~/.codex/, ~/.gemini/):
├── agent.db           ← SQLite storage (settings, auth)
├── auth.json          ← Legacy auth (migrated to agent.db)
├── models.yml         ← Model configuration (preferred)
├── models.json        ← Model configuration (legacy)
├── config.yml         ← Settings (alternative to agent.db)
├── keybindings.json   ← Custom keybindings
├── commands/          ← Slash commands (via capability)
├── hooks/             ← Pre/post hooks (via capability)
│   ├── pre/
│   └── post/
├── tools/             ← Custom tools (via capability)
├── skills/            ← Skills (via capability)
├── prompts/           ← Prompt templates
├── themes/            ← Custom themes
├── sessions/          ← Session storage
├── agents/            ← Custom task agents
├── plugins/           ← Installed plugins
├── extensions/        ← Extension modules
├── rules/             ← Rules (via capability)
├── instructions/      ← Instructions (via capability)
├── share/             ← Custom share scripts
└── AGENTS.md          ← User-level agent instructions

User-level root (~/.omp/, ~/.pi/, ~/.claude/) - not under agent/:
├── mcp.json           ← MCP server config (via capability)
├── plugins/           ← Plugin storage (primary only)
├── logs/              ← Log files (primary only, via pi-utils)
├── ssh/               ← SSH control sockets
└── remote/            ← SSHFS mount points

Project-level (.omp/, .pi/, .claude/, .codex/, .gemini/):
├── SYSTEM.md          ← Project system prompt
├── APPEND_SYSTEM.md   ← Appended to system prompt
├── settings.json      ← Project settings (via capability)
├── commands/          ← Slash commands (via capability)
├── hooks/             ← Pre/post hooks (via capability)
├── tools/             ← Custom tools (via capability)
├── skills/            ← Skills (via capability)
├── agents/            ← Custom task agents
├── extensions/        ← Extension modules (via capability)
├── rules/             ← Rules (via capability)
├── instructions/      ← Instructions (via capability)
├── prompts/           ← Prompt templates (via capability)
├── plugin-overrides.json ← Plugin config overrides
├── lsp.json           ← LSP server config
├── .lsp.json          ← LSP server config (dotfile)
└── .mcp.json          ← MCP server config (via capability)
```

## Notes

### Logger

Logging is handled by `@oh-my-pi/pi-utils`, not by this package. Logs go to `~/.omp/logs/omp.YYYY-MM-DD.log` with automatic rotation.

### Config Priority

When multiple config directories exist, priority order is:
1. `.omp` (highest)
2. `.pi`
3. `.claude`
4. `.codex`
5. `.gemini` (lowest)

For user-level paths, `.omp/agent` and `.pi/agent` have an "agent" subdirectory; others use the root directly (e.g., `~/.claude/` not `~/.claude/agent/`).
