# coding-agent Development Guide

This document describes the architecture and development workflow for the coding-agent package.

## Architecture Overview

The coding-agent is structured into distinct layers:

```
┌─────────────────────────────────────────────────────────────┐
│                         CLI Layer                           │
│  cli.ts → main.ts → cli/args.ts, cli/file-processor.ts     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       Mode Layer                            │
│  modes/interactive-mode.ts   modes/print-mode.ts   modes/rpc/│
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       Core Layer                            │
│  session/agent-session.ts, sdk.ts (SDK wrapper)            │
│  session/session-manager.ts, config/model-resolver.ts, etc.│
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   External Dependencies                     │
│  @oh-my-pi/pi-agent-core (Agent core)                      │
│  @oh-my-pi/pi-ai (models, providers)                   │
│  @oh-my-pi/pi-tui (TUI components)                         │
└─────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
src/
├── cli.ts                    # CLI entry point (shebang, calls main)
├── main.ts                   # Main orchestration, argument handling, mode routing
├── index.ts                  # Public API exports (SDK)
├── config.ts                 # APP_NAME, VERSION, paths (getAgentDir, etc.)
├── migrations.ts             # Session/config migration logic
├── sdk.ts                    # SDK wrapper for programmatic usage
├── system-prompt.ts          # buildSystemPrompt(), loadProjectContextFiles()
├── cursor.ts                 # Cursor exec bridge (flattened from execution/cursor/)

├── cli/                      # CLI-specific utilities
│   ├── args.ts               # parseArgs(), printHelp(), Args interface
│   ├── file-processor.ts     # processFileArguments() for @file args
│   ├── list-models.ts        # --list-models implementation
│   ├── plugin-cli.ts         # Plugin management CLI
│   ├── session-picker.ts     # selectSession() TUI for --resume
│   └── update-cli.ts         # Self-update CLI

├── capability/               # Capability system (extension types)
│   ├── index.ts              # Main capability registry and discovery
│   ├── context-file.ts       # Context file capability
│   ├── extension.ts          # Extension capability
│   ├── hook.ts               # Hook capability
│   ├── instruction.ts        # Instruction capability
│   ├── mcp.ts                # MCP capability
│   ├── prompt.ts             # Prompt capability
│   ├── rule.ts               # Rulebook rule capability
│   ├── skill.ts              # Skill capability
│   ├── slash-command.ts      # Slash command capability
│   ├── system-prompt.ts      # System prompt capability
│   └── tool.ts               # Tool capability

├── config/                   # Configuration management
│   ├── keybindings.ts        # Keybinding configuration
│   ├── model-registry.ts     # Model registry and configuration
│   ├── model-resolver.ts     # resolveModelScope(), restoreModelFromSession()
│   ├── prompt-templates.ts   # Prompt template loading and rendering
│   └── settings-manager.ts   # SettingsManager class - user preferences

├── discovery/                # Extension discovery from multiple sources
│   ├── index.ts              # Main discovery orchestration
│   ├── builtin.ts            # Built-in extensions
│   ├── claude.ts             # Claude.md discovery
│   ├── cline.ts              # Cline .mcp.json discovery
│   ├── codex.ts              # .codex discovery
│   ├── cursor.ts             # Cursor .cursorrules discovery
│   ├── gemini.ts             # Gemini .config discovery
│   ├── github.ts             # GitHub extension discovery
│   ├── mcp-json.ts           # MCP JSON discovery
│   ├── vscode.ts             # VSCode extension discovery
│   ├── windsurf.ts           # Windsurf discovery
│   └── helpers.ts            # Discovery helper functions

├── exa/                      # Exa MCP tools (22 tools)
│   ├── index.ts              # Exa tools exports
│   ├── company.ts            # Company search
│   ├── linkedin.ts           # LinkedIn search
│   ├── mcp-client.ts         # MCP client for Exa
│   ├── render.ts             # Exa result rendering
│   ├── researcher.ts         # Research tools
│   ├── search.ts             # Search tools
│   ├── types.ts              # Exa types
│   └── websets.ts            # Websets tools

├── exec/                     # Bash/shell execution
│   ├── bash-executor.ts      # executeBash() with streaming, abort
│   └── exec.ts               # Process execution utilities

├── export/                   # Export functionality
│   ├── custom-share.ts       # Custom sharing
│   ├── ttsr.ts               # Text-to-speech/speech-to-text utilities
│   └── html/                 # Session export to HTML
│       └── index.ts          # HTML export logic

├── extensibility/            # Extension and customization systems
│   ├── skills.ts             # loadSkills(), skill discovery
│   ├── slash-commands.ts     # loadSlashCommands()
│   │
│   ├── custom-commands/      # Custom command loading system
│   │   └── types.ts          # CustomCommand types
│   │
│   ├── custom-tools/         # Custom tool loading system
│   │   ├── index.ts          # Custom tool exports
│   │   ├── types.ts          # CustomToolFactory, CustomToolDefinition
│   │   ├── loader.ts         # loadCustomTools()
│   │   └── wrapper.ts        # Tool wrapper utilities
│   │
│   ├── extensions/           # Extension system
│   │   ├── index.ts          # Extension exports
│   │   ├── types.ts          # Extension types
│   │   ├── loader.ts         # Extension loading
│   │   ├── runner.ts         # Extension event dispatch
│   │   └── wrapper.ts        # Extension wrappers
│   │
│   ├── hooks/                # Hook system
│   │   ├── index.ts          # Hook exports
│   │   ├── types.ts          # HookAPI, HookContext, event types
│   │   ├── loader.ts         # loadHooks()
│   │   └── runner.ts         # runHook() event dispatch
│   │
│   └── plugins/              # Plugin system
│       └── (plugin loading and management)

├── internal-urls/            # Internal URL protocol handlers
│   ├── index.ts              # Router and exports
│   ├── rule-protocol.ts      # Rule protocol handler
│   └── skill-protocol.ts     # Skill protocol handler

├── ipy/                      # Python/Jupyter execution
│   ├── executor.ts           # executePython(), kernel execution
│   ├── gateway-coordinator.ts # Gateway coordination
│   ├── kernel.ts             # PythonKernel class
│   ├── modules.ts            # Python module discovery
│   ├── prelude.ts            # Python prelude (TS bindings)
│   └── prelude.py            # Python prelude script

├── lsp/                      # LSP integration
│   ├── index.ts              # LSP exports
│   ├── client.ts             # LSP client
│   ├── config.ts             # LSP configuration
│   ├── render.ts             # LSP result rendering
│   ├── utils.ts              # LSP utilities
│   └── clients/              # Language-specific clients
│       ├── index.ts          # Client exports
│       ├── biome-client.ts   # Biome LSP
│       └── lsp-linter-client.ts # Generic linter

├── mcp/                      # MCP (Model Context Protocol) integration
│   ├── index.ts              # MCP exports
│   ├── config.ts             # MCP configuration
│   ├── loader.ts             # MCP server loading
│   ├── manager.ts            # MCPManager class
│   ├── tool-bridge.ts        # Tool bridging
│   ├── tool-cache.ts         # Tool caching
│   ├── types.ts              # MCP types
│   └── transports/           # MCP transports
│       ├── http.ts           # HTTP transport
│       └── stdio.ts          # Stdio transport

├── modes/                    # Run mode implementations
│   ├── index.ts              # Re-exports InteractiveMode, runPrintMode, runRpcMode
│   ├── interactive-mode.ts   # InteractiveMode class (main TUI)
│   ├── print-mode.ts         # Non-interactive mode
│   ├── types.ts              # Mode types
│   │
│   ├── components/           # TUI components
│   │   ├── index.ts          # Component exports
│   │   ├── assistant-message.ts    # Agent response rendering
│   │   ├── bash-execution.ts       # Bash output display
│   │   ├── custom-editor.ts        # Multi-line input editor
│   │   ├── dynamic-border.ts       # Adaptive border rendering
│   │   ├── footer.ts               # Status bar / footer
│   │   ├── hook-input.ts           # Hook input dialog
│   │   ├── hook-selector.ts        # Hook selection UI
│   │   ├── login-dialog.ts         # OAuth login dialog
│   │   ├── model-selector.ts       # Model picker
│   │   ├── session-selector.ts     # Session browser for --resume
│   │   ├── theme-selector.ts       # Theme picker
│   │   ├── thinking-selector.ts    # Thinking level picker
│   │   ├── tool-execution.ts       # Tool call/result rendering
│   │   ├── user-message.ts         # User message rendering
│   │   ├── status-line/            # Status line components
│   │   └── extensions/             # Extension UI components
│   │
│   ├── controllers/          # TUI controllers
│   │   ├── command-controller.ts   # Command handling
│   │   ├── event-controller.ts     # Event handling
│   │   ├── input-controller.ts     # Input handling
│   │   └── selector-controller.ts  # Selector handling
│   │
│   ├── theme/                # Theme system
│   │   ├── theme.ts          # Theme loading, getEditorTheme()
│   │   └── defaults/         # Default themes
│   │
│   ├── utils/                # Mode utilities
│   │   └── ui-helpers.ts     # UI helper functions
│   │
│   └── rpc/                  # RPC mode for programmatic control
│       ├── rpc-mode.ts       # runRpcMode() - JSON stdin/stdout protocol
│       ├── rpc-types.ts      # RpcCommand, RpcResponse types
│       └── rpc-client.ts     # RpcClient class

├── patch/                    # File patching/editing
│   ├── index.ts              # EditTool and exports
│   ├── applicator.ts         # Patch application
│   ├── diff.ts               # Diff utilities
│   ├── shared.ts             # Shared utilities
│   └── render.ts             # Patch rendering

├── prompts/                  # Prompt templates
│   ├── system/               # System prompts
│   ├── agents/               # Agent-specific prompts
│   ├── compaction/           # Compaction prompts
│   └── tools/                # Tool-specific prompts

├── session/                  # Session management
│   ├── agent-session.ts      # AgentSession class - THE central abstraction
│   ├── agent-storage.ts      # Agent storage utilities
│   ├── auth-storage.ts       # AuthStorage class - API keys and OAuth
│   ├── artifacts.ts          # Artifact management
│   ├── history-storage.ts    # History storage
│   ├── messages.ts           # Message types and transformers
│   ├── session-manager.ts    # SessionManager class - JSONL persistence
│   ├── session-storage.ts    # Session storage utilities
│   ├── storage-migration.ts  # Storage migration
│   ├── streaming-output.ts   # Streaming output handling
│   └── compaction/           # Context compaction system
│       └── index.ts          # Compaction logic, summary generation

├── ssh/                      # SSH execution
│   ├── connection-manager.ts # SSH connection management
│   ├── ssh-executor.ts       # executeSSH() with streaming
│   └── sshfs-mount.ts        # SSHFS mounting

├── task/                     # Task/subagent spawning
│   ├── index.ts              # TaskTool exports
│   ├── agents.ts             # Agent definitions
│   ├── commands.ts           # Task commands
│   ├── discovery.ts          # Task discovery
│   ├── executor.ts           # Task execution
│   ├── render.ts             # Task rendering
│   ├── subprocess-tool-registry.ts # Subprocess tool registry
│   ├── worker-protocol.ts    # Worker protocol
│   └── worker.ts             # Task worker

├── tools/                    # Built-in tool implementations
│   ├── index.ts              # Tool exports, BUILTIN_TOOLS, createTools
│   ├── ask.ts                # User input tool
│   ├── bash.ts               # Bash command execution
│   ├── bash-interceptor.ts   # Bash command interception
│   ├── calculator.ts         # Calculator tool
│   ├── complete.ts           # Completion tool
│   ├── context.ts            # Tool context utilities
│   ├── fetch.ts              # URL content fetching
│   ├── find.ts               # File search by glob
│   ├── gemini-image.ts       # Gemini image generation
│   ├── grep.ts               # Content search (regex/literal)
│   ├── ls.ts                 # Directory listing
│   ├── notebook.ts           # Jupyter notebook editing
│   ├── output-meta.ts        # Output metadata
│   ├── output-utils.ts       # Output utilities
│   ├── path-utils.ts         # Path resolution utilities
│   ├── python.ts             # Python tool (delegates to ipy/)
│   ├── read.ts               # File reading (text and images)
│   ├── renderers.ts          # Tool output renderers
│   ├── render-utils.ts       # Rendering utilities
│   ├── review.ts             # Code review tools
│   ├── ssh.ts                # SSH tool (delegates to ssh/)
│   ├── todo-write.ts         # Todo management
│   ├── tool-errors.ts        # Tool error types
│   ├── tool-result.ts        # Tool result utilities
│   ├── truncate.ts           # Output truncation utilities
│   └── write.ts              # File writing

├── utils/                    # Generic utilities
│   ├── changelog.ts          # parseChangelog(), getNewEntries()
│   ├── event-bus.ts          # Event bus for tool communication
│   ├── file-mentions.ts      # File mention detection
│   ├── frontmatter.ts        # Frontmatter parsing
│   ├── image-convert.ts      # Image format conversion
│   ├── image-resize.ts       # Image resizing utilities
│   ├── mime.ts               # MIME type detection
│   ├── shell.ts              # getShellConfig()
│   ├── terminal-notify.ts    # Terminal notification utilities
│   ├── timings.ts            # Performance timing utilities
│   ├── title-generator.ts    # Session title generation
│   ├── tools-manager.ts      # ensureTool() - download fd, etc.
│   └── utils.ts              # Generic utilities

├── vendor/                   # Vendored dependencies
│   └── photon/               # Photon image processing

└── web/                      # Web tools (merged web-scrapers + web-search)
    ├── scrapers/             # Web scraping
    │   ├── index.ts          # Scraper exports
    │   ├── types.ts          # Scraper types
    │   ├── utils.ts          # Scraper utilities
    │   └── (domain-specific scrapers)
    └── search/               # Web search
        ├── index.ts          # WebSearchTool exports
        ├── auth.ts           # Search auth
        ├── render.ts         # Search result rendering
        └── providers/        # Search providers
            ├── anthropic.ts  # Anthropic search
            ├── exa.ts        # Exa search
            └── perplexity.ts # Perplexity search
```

## Key Abstractions

### AgentSession (session/agent-session.ts)

The central abstraction that wraps the SDK Agent with:

- Session persistence (via SessionManager)
- Settings persistence (via SettingsManager)
- Model cycling with scoped models
- Context compaction
- Bash command execution
- Message queuing
- Hook integration
- Custom tool loading
- Extension/capability system integration

All three modes (interactive, print, rpc) use AgentSession.

### SDK (sdk.ts)

Wrapper around `@oh-my-pi/pi-agent-core` that provides a simplified interface for creating and managing agents programmatically. Used by AgentSession and available as a public API through index.ts exports.

### InteractiveMode (modes/interactive-mode.ts)

Handles TUI rendering and user interaction:

- Subscribes to AgentSession events
- Renders messages, tool executions, streaming
- Manages editor, selectors, key handlers
- Delegates all business logic to AgentSession

### RPC Mode (modes/rpc/)

Headless operation via JSON protocol over stdin/stdout:

- **rpc-mode.ts**: `runRpcMode()` function that listens for JSON commands on stdin and emits responses/events on stdout
- **rpc-types.ts**: Typed protocol definitions (`RpcCommand`, `RpcResponse`, `RpcSessionState`)
- **rpc-client.ts**: `RpcClient` class for spawning the agent as a subprocess and controlling it programmatically

The RPC mode exposes the full AgentSession API via JSON commands. See [docs/rpc.md](docs/rpc.md) for protocol documentation.

### SessionManager (session/session-manager.ts)

Handles session persistence:

- JSONL format for append-only writes
- Session file location management
- Message loading/saving
- Model/thinking level persistence

### SettingsManager (config/settings-manager.ts)

Handles user preferences:

- Default model/provider
- Theme selection
- Queue mode
- Thinking block visibility
- Compaction settings
- Hook/custom tool paths
- Thinking budgets (`thinkingBudgets` setting for custom token budgets per level)
- Image blocking (`blockImages` setting to prevent images from being sent to LLM)

### Hook System (extensibility/hooks/)

Extensibility layer for intercepting agent behavior:

- **loader.ts**: Discovers and loads hooks from `~/.omp/agent/hooks/`, `.omp/hooks/`, and CLI
- **runner.ts**: Dispatches events to registered hooks
- **types.ts**: Event types (`session`, `tool_call`, `tool_result`, `message`, `error`, `user_bash`)

See [docs/hooks.md](docs/hooks.md) for full documentation.

### Extension System Architecture

The extension system uses a shared runtime pattern:

1. **ExtensionRuntime** (`extensibility/extensions/types.ts`): Shared state and action handlers for all extensions
2. **Extension**: Per-extension registration data (handlers, tools, commands, shortcuts)
3. **ExtensionAPI**: Per-extension API that writes registrations to Extension and delegates actions to runtime
4. **ExtensionRunner**: Orchestrates event dispatch and provides context to handlers

Key extension events:

- `before_agent_start`: Receives `systemPrompt` and can return full replacement (not just append)
- `user_bash`: Intercept `!`/`!!` commands for custom execution (e.g., remote SSH)
- `session_shutdown`: Cleanup notification before exit

### Custom Tools (extensibility/custom-tools/)

System for adding LLM-callable tools:

- **loader.ts**: Discovers and loads tools from `~/.omp/agent/tools/`, `.omp/tools/`, and CLI
- **types.ts**: `CustomToolFactory`, `CustomToolDefinition`, `CustomToolResult`

See [docs/custom-tools.md](docs/custom-tools.md) for full documentation.

### Skills (extensibility/skills.ts)

On-demand capability packages:

- Discovers SKILL.md files from multiple locations
- Provides specialized workflows and instructions
- Loaded when task matches description

See [docs/skills.md](docs/skills.md) for full documentation.

### Capability System (capability/)

Unified extension system that discovers and loads capabilities from multiple sources:

- **Extension Discovery** (discovery/): Discovers extensions from Claude.md, .cursorrules, .codex, MCP servers, etc.
- **Capability Types**: Hooks, tools, context files, rules, skills, slash commands, system prompts, etc.
- **Multi-source**: Global (~/.omp/), project (.omp/), and built-in capabilities

See [docs/extensions.md](docs/extensions.md) for full documentation.

## Development Workflow

### Running in Development

Run the CLI directly with bun (this is a bun-based project):

```bash
# From monorepo root
bun run dev

# Or run directly
bun packages/coding-agent/src/cli.ts

# With arguments
bun packages/coding-agent/src/cli.ts --help
bun packages/coding-agent/src/cli.ts -p "Hello"

# RPC mode
bun packages/coding-agent/src/cli.ts --mode rpc --no-session
```

### Type Checking

```bash
# From monorepo root (runs biome + tsgo type check)
bun run check

# From packages/coding-agent
bun run check
```

### Building

```bash
# Type check and build (from packages/coding-agent)
bun run build

# Build standalone binary
bun run build:binary
```

### Testing

```bash
# Run tests (from packages/coding-agent)
bun test

# Run specific test pattern
bun test --testNamePattern="RPC"

# Run RPC example interactively
bun test/rpc-example.ts
```

### Managed Binaries

Tools like `fd` and `rg` are auto-downloaded to `~/.omp/bin/` (migrated from `~/.omp/agent/tools/`).

## Adding New Features

### Adding a New Slash Command

1. If it's a UI-only command (e.g., `/theme`), add handler in `interactive-mode.ts` `setupEditorSubmitHandler()`
2. If it needs session logic, add method to `AgentSession` and call from mode

### Adding a New Tool

1. Create tool factory in `tools/` following existing patterns (e.g., `createMyTool(session: ToolSession)`)
2. Export factory and types from `tools/index.ts`
3. Add to `BUILTIN_TOOLS` map in `tools/index.ts`
4. Add tool prompt template to `prompts/tools/` if needed
5. Tool will automatically be included in system prompt

### Adding a New Hook Event

1. Add event type to hook event types in `extensibility/hooks/types.ts`
2. Add emission point in relevant code (AgentSession, tool wrapper, etc.)
3. Update `docs/hooks.md` with the new event type

### Adding a New RPC Command

1. Add command type to `RpcCommand` union in `modes/rpc/rpc-types.ts`
2. Add response type to `RpcResponse` union in `modes/rpc/rpc-types.ts`
3. Add handler case in `handleCommand()` switch in `modes/rpc/rpc-mode.ts`
4. Add client method in `RpcClient` class in `modes/rpc/rpc-client.ts`
5. Update `docs/rpc.md` with the new command

### Adding a New Selector

1. Create component in `modes/components/`
2. Use `showSelector()` helper in `interactive-mode.ts`:

```typescript
private showMySelector(): void {
    this.showSelector((done) => {
        const selector = new MySelectorComponent(
            // ... params
            (result) => {
                // Handle selection
                done();
                this.showStatus(`Selected: ${result}`);
            },
            () => {
                done();
                this.ui.requestRender();
            },
        );
        return { component: selector, focus: selector.getSelectList() };
    });
}
```

### Adding a New Extension Source

1. Create discovery module in `discovery/` (e.g., `my-source.ts`)
2. Implement discovery functions that return capability objects
3. Add to discovery chain in `discovery/index.ts`
4. Update `docs/extension-loading.md` with the new source

### Adding a New Capability Type

1. Create capability module in `capability/` (e.g., `my-capability.ts`)
2. Define capability type and schema
3. Add to capability registry in `capability/index.ts`
4. Add loader/handler in relevant core module
5. Update `docs/extensions.md` with the new capability type

### Adding a New Keybinding

1. Add the action name to `AppAction` type in `config/keybindings.ts`
2. Add default binding to `DEFAULT_APP_KEYBINDINGS`
3. Add to `APP_ACTIONS` array
4. Handle the action in `CustomEditor` or `InteractiveMode`

Example: The `dequeue` action (`Alt+Up`) restores queued messages to the editor.

## Code Style

- TypeScript with strict type checking (tsgo)
- No `any` types unless absolutely necessary
- No inline dynamic imports
- Formatting via Biome (`bun run check` or `bun run fix`)
- Keep InteractiveMode focused on UI, delegate logic to AgentSession
- Use event bus for tool/extension communication
- Components should override `invalidate()` to rebuild on theme changes

## Package Structure

This is part of a monorepo with the following packages:

- `@oh-my-pi/pi-coding-agent` (this package) - Main CLI and TUI
- `@oh-my-pi/pi-agent-core` - Core agent implementation
- `@oh-my-pi/pi-tui` - TUI components
- `@oh-my-pi/pi-ai` - External AI provider library

## CLI Flags

Key CLI flags for development:

- `--no-tools`: Disable all built-in tools (extension-only setups)
- `--no-extensions`: Disable extension discovery (explicit `-e` paths still work)
- `--no-skills`: Disable skill discovery
- `--session <id>`: Resume by session ID prefix (UUID match) or path

## SDK Exports

The SDK (`src/index.ts`) exports run modes for programmatic usage:

- `InteractiveMode`: Full TUI mode
- `runPrintMode()`: Non-interactive, process messages and exit
- `runRpcMode()`: JSON stdin/stdout protocol

Extension types and utilities are also exported for building custom extensions.

## Documentation

See the `docs/` directory for detailed documentation:

- `docs/sdk.md` - SDK usage and examples
- `docs/rpc.md` - RPC protocol documentation
- `docs/hooks.md` - Hook system documentation
- `docs/extensions.md` - Extension system documentation
- `docs/custom-tools.md` - Custom tool development
- `docs/skills.md` - Skill system documentation
- `docs/compaction.md` - Context compaction system
- `docs/session.md` - Session management
- `docs/theme.md` - Theme customization
- `docs/tui.md` - TUI architecture
