# Changelog

## [Unreleased]
### Added

- Added `abort_and_prompt` RPC command for atomic abort-and-reprompt without race conditions ([#357](https://github.com/can1357/oh-my-pi/pull/357))

### Fixed

- Fixed `session.abort()` not clearing `promptInFlight` flag due to microtask ordering, which blocked subsequent prompts

### Added
- Added interactive debug log viewer with selection, copy, and expand/collapse controls
- Added inline filtering and count display to the debug log viewer
- Added pid filter toggle and load-older pagination controls to the debug log viewer
- Enabled loading older debug logs from archived files in viewer
- Added file hyperlinks for debug report paths in viewer

### Fixed
- Sanitized debug log display to strip control codes, normalize tabs, and trim width

## [12.4.0] - 2026-02-14
### Changed

- Moved `sanitizeText` function from `@oh-my-pi/pi-utils` to `@oh-my-pi/pi-natives` for better code organization
- Replaced internal `#normalizeOutput` methods with `sanitizeText` utility function in bash and Python execution components
- Added line length clamping (4000 characters) to bash and Python execution output to prevent display of excessively long lines
- Modified memory storage to isolate memories by project working directory, preventing cross-project memory contamination

### Fixed

- Fixed bash interactive tool to gracefully handle malformed output chunks by normalizing them before display
- Fixed fetch tool incorrectly treating HTML content as plain text or markdown
- Fixed output truncation notice displaying incorrect byte limit when maxBytes differs from outputBytes
- Fixed Cloudflare returning corrupted bytes when compression is negotiated in web scraper requests

## [12.3.0] - 2026-02-14
### Added

- Added autonomous memory extraction and consolidation system with configurable settings
- Added `/memory` slash command with subcommands: `view`, `clear`, `reset`, `enqueue`, `rebuild`
- Added memory injection payload that automatically includes learned context in system prompts
- Added two-phase memory pipeline: Stage 1 extracts durable knowledge from session history, Phase 2 consolidates into reusable skills and guidance
- Added memory storage layer with SQLite-backed job queue for distributed memory processing
- Added configurable memory settings: concurrency limits, lease timeouts, token budgets, and rollout age constraints

### Changed

- Modified system prompt building to inject memory guidance when memories are enabled
- Changed `resolvePromptInput` to handle multiline input and improve error handling for file reads

## [12.2.0] - 2026-02-13

### Added

- Added `providerSessionState` property to AgentSession for managing provider-scoped transport and session caches
- Added automatic cleanup of provider session state resources on session disposal
- Added `providers.openaiWebsockets` setting to prefer websocket transport for OpenAI Codex models
- Added provider details display in session info showing authentication mode, transport, and connection settings
- Added automatic prewarm of OpenAI Codex websocket connections on session creation for improved performance
- Added real-time authentication validation in OAuth provider selector with visual status indicators (checking, valid, invalid)
- Added `validateAuth` and `requestRender` options to OAuthSelectorComponent for custom authentication validation and UI refresh callbacks

### Changed

- Changed `providers.openaiWebsockets` setting from boolean to enum with values "auto", "off", "on" for more granular websocket policy control (auto uses model defaults, on forces websocket, off disables it)
- Enhanced provider details display to include live provider session state information
- Enhanced session info output to display active provider configuration and authentication details
- Replaced `process.cwd()` with `getProjectDir()` throughout codebase for improved project directory detection and handling
- Made `SessionManager.list()` async to support asynchronous session discovery operations
- Preserved internal whitespace and indentation in bash command normalization to support heredocs and indentation-sensitive scripts
- Improved git context loading performance with configurable timeouts and parallel status/commit queries
- Enhanced git context reliability with better error handling for timeout and command failures
- Changed OAuth provider selector to display live authentication status instead of static login state
- Changed logout flow to refresh OAuth provider authentication state before showing selector

### Fixed

- Improved error reporting in fetch tool to include HTTP status codes when URL fetching fails
- Fixed fetch tool to preserve actual response metadata (finalUrl, contentType) instead of defaults when requests fail

||||||| parent of a70a34c8b (fix(coding-agent/debug): Sanitized debug log rendering)
## [12.1.0] - 2026-02-13

### Added

- Filesystem scan cache invalidation helpers (`invalidateFsScanAfterWrite`, `invalidateFsScanAfterDelete`, `invalidateFsScanAfterRename`) to properly invalidate shared caches after file mutations
- Named discovery profile for file mention candidates to standardize cache visibility and ignore semantics across callers
- Comprehensive `models.yml` provider integration guide documenting custom model registration, provider overrides, API adapters, merge behavior, and practical integration patterns for Ollama, vLLM, LM Studio, and proxy endpoints
- Claude Code marketplace plugin discovery: automatically loads skills, commands, hooks, tools, and agents from `~/.claude/plugins/cache/` based on `installed_plugins.json` registry ([#48](https://github.com/can1357/oh-my-pi/issues/48))

### Changed

- Moved directory path utilities from `src/config.ts` to `@oh-my-pi/pi-utils/dirs` for shared use across packages
- Updated imports throughout codebase to use centralized directory path functions from `@oh-my-pi/pi-utils/dirs`
- Updated interactive bash terminal UI label from 'InteractiveTerm' to 'Console' for clarity
- Enhanced bash execution environment with comprehensive non-interactive defaults for pagers, editors, and package managers to prevent command blocking and interactive prompts
- Updated custom models configuration to use `~/.omp/agent/models.yml` (YAML format) while maintaining backward compatibility with legacy `models.json`

## [12.0.0] - 2026-02-12

### Added

- Added `getAllServerNames()` method to MCPManager for enumerating all known servers

### Changed

- Changed default edit mode from `patch` to `hashline` for more precise code modifications
- Changed `readHashLines` setting default from false to true to enable hash line reading by default

### Fixed

- Fixed `omp setup` crashing with uncaught exception when no component argument provided; now shows help ([#35](https://github.com/can1357/oh-my-pi/issues/35))
- Fixed `/mcp list` showing "No MCP servers configured" when servers are loaded from discovery sources like `.claude.json`, `.cursor/mcp.json`, `.vscode/mcp.json` ([#34](https://github.com/can1357/oh-my-pi/issues/34))
- Fixed model selector sorting to show newest models first within each provider instead of alphabetical; `-latest` aliases now appear before dated versions ([#37](https://github.com/can1357/oh-my-pi/issues/37))

## [11.14.4] - 2026-02-12

### Added

- Exported `renderPromptTemplate` function for programmatic prompt template rendering
- Exported `computeLineHash` function from patch utilities
- Added `./cli` export path for direct CLI module access

### Changed

- Replaced jsdom with linkedom for improved HTML parsing performance and reduced memory footprint

### Removed

- Removed @types/jsdom dependency

## [11.14.1] - 2026-02-12
### Changed

- Improved Bun binary detection to check `Bun.env.PI_COMPILED` environment variable
- Enhanced Bun package manager update to install specific version instead of latest
- Added post-update verification for Bun installations to warn if expected version was not installed

### Fixed

- Fixed Bun update process to properly handle version pinning and report installation mismatches

## [11.14.0] - 2026-02-12
### Added

- Added SwiftLint linter client with JSON reporter support for Swift file linting
- Added `--no-pty` flag to disable PTY-based interactive bash execution
- Added `PI_NO_PTY` environment variable to disable PTY-based interactive bash execution
- Added `bash.virtualTerminal` setting to control PTY-backed interactive execution for bash commands
- Added interactive PTY-based bash execution with real-time terminal rendering and input forwarding
- Added sourcekit-lsp language server support for Swift files

### Changed

- Changed `bash.virtualTerminal` default from `on` to `off` for standard non-interactive bash execution
- Changed SwiftLint configuration to use `lint` command with JSON reporter instead of `analyze` for improved diagnostic parsing
- Changed diff line format from space-separated (`+123 content`) to pipe-delimited (`+123|content`) for improved parsing reliability
- Changed bash tool to use interactive PTY execution by default when UI is available, falling back to standard execution when disabled

## [11.13.1] - 2026-02-12

### Added

- Added `/move` slash command to move session to a different working directory
- Added `moveTo()` method to SessionManager for relocating sessions with file migration and header updates
- Added `refreshSlashCommandState()` method to reload slash commands and autocomplete when working directory changes
- Added `setSlashCommands()` method to AgentSession for updating file-based slash commands
- Added OAuth authentication support for Perplexity web search via `www.perplexity.ai/rest/sse/perplexity_ask` endpoint
- Added automatic OAuth token refresh with 5-minute expiry buffer for Perplexity authentication
- Added `authMode` field to search responses to indicate authentication method used (oauth or api_key)
- Added display of authentication mode in search result output
- Added support for streaming SSE responses from Perplexity OAuth API with proper event merging

### Changed

- Changed Perplexity provider to support both API key and OAuth authentication methods
- Changed `isAvailable()` method to async to check for both API key and OAuth token availability
- Changed error message to guide users to set PERPLEXITY_API_KEY or login via OAuth
- Changed `callPerplexity` to `callPerplexityApi` to clarify it uses the API key endpoint

## [11.13.0] - 2026-02-12

### Breaking Changes

- Removed support for `.pi` configuration directory alias; use `.omp` instead

### Added

- Added `openPath` utility function to centralize cross-platform URL and file path opening

### Changed

- Refactored browser/file opening across multiple modules to use unified `openPath` utility for improved maintainability

## [11.12.0] - 2026-02-11
### Added

- Added `resolveFileDisplayMode` utility to centralize file display mode resolution across tools (read, grep, file mentions)
- Added automatic hashline formatting to @file mentions when hashline mode is active
- Added `replace` hashline edit operation for substr-style fuzzy text replacement without line references, with optional `all` flag for replace-all behavior
- Added `noopEdits` array to `applyHashlineEdits` return value to report edits that produced no changes, including edit index, location, and current content for diagnostics
- Added validation to detect and reject hashline edits using wrong-format fields (`old_text`/`new_text` from replace mode, `diff` from patch mode) with helpful error messages
- Added `additionalProperties: true` to all hashline edit schemas (`single`, `range`, `insertAfter`, and root) to tolerate extra fields from models
- Added whitespace normalization in line reference parsing to tolerate spaces around colons (e.g., `5 : ab` now parses as `5:ab`)
- Added `remaps` property to `HashlineMismatchError` providing quick-fix mapping of stale line references to corrected hashes
- Added warnings detection in `applyHashlineEdits` to alert users when edits affect significantly more lines than expected, indicating possible unintended reformatting
- Added diagnostic output showing target line content when an edit produces no changes, helping users identify hash mismatches or incorrect replacement content
- Added `{{hashline}}` Handlebars helper to compute accurate `LINE:HASH` references for prompt examples and documentation
- Added deduplication of identical hashline edits targeting the same line(s) in a single call
- Added `replacement` as accepted alias for `content` in `insertAfter` operations
- Added graceful degradation of `range` edits with missing `end` field to single-line edits
- Added `additionalProperties: true` to hashline edit schemas to tolerate extra fields from models

### Changed

- Reverted hashline display format from `LINE:HASH  content` (two spaces) back to `LINE:HASH|content` (pipe separator) for consistency with legacy format
- Changed hashline display format from `LINE:HASH| content` to `LINE:HASH  content` (two spaces instead of pipe separator) for improved readability
- Removed `lines` and `hashes` parameters from `read` tool—file display mode (line numbers, hashlines) now determined automatically by settings and edit mode
- Simplified `read` tool prompt to reflect automatic display mode detection based on configuration
- Updated `grep` tool to respect file display mode settings, showing hashline-prefixed output when hashline mode is active
- Renamed hashline edit operation keys from `single`/`range`/`insertAfter` to `set_line`/`replace_lines`/`insert_after` for clearer semantics
- Renamed hashline edit fields: `loc` → `anchor`, `replacement` → `new_text`, `content` → `text` for consistency across all operation types
- Separated hashline anchor-based edits (`set_line`, `replace_lines`, `insert_after`) from content-replace edits (`replace`) in application pipeline
- Improved no-op edit diagnostics to use `noopEdits` array from `applyHashlineEdits`, providing precise line-by-line comparison when replacements match current content
- Enhanced error messages for wrong-format hashline edits to guide users toward correct operation syntax
- Strengthened hashline prompt guidance to emphasize that `replacement` must differ from current line content and clarify no-op error recovery procedures
- Improved hashline prompt to clarify atomicity: all edits in one call are validated against the original file state, with line numbers and hashes referring to the pre-edit state
- Added explicit instruction in hashline prompt to preserve exact whitespace and formatting when replacing lines, changing only the targeted token/expression
- Added guidance in hashline prompt for swap operations: use two `single` operations in one call rather than attempting to account for line number shifts
- Strengthened anti-reformatting instructions in hashline prompt to reduce formatting-only failures
- Improved no-op error recovery guidance in hashline prompt to prevent infinite retry loops
- Renamed hashline edit operation keys from `replaceLine`/`replaceLines` to `single`/`range` for clearer semantics
- Renamed hashline edit field `content` to `replacement` in `single` and `range` operations to distinguish from `insertAfter.content`
- Improved no-op edit diagnostics to show specific line-by-line comparisons when replacements match current content, helping users identify hash mismatches or formatting issues
- Enhanced no-op error messages to distinguish between literally identical replacements and content normalized back by heuristics
- Reverted hash algorithm from 3-character base-36 back to 2-character hexadecimal for line references
- Enhanced range validation during hashline edits to detect and reject relocations that change the scope of affected lines
- Improved wrapped-line restoration logic to only attempt merging when source lines exhibit continuation patterns
- Updated hashline tool documentation to emphasize direction-locking mutations and clarify recovery procedures for hash mismatches
- Changed `applyHashlineEdits` return type to include optional `warnings` array for reporting suspicious edit patterns
- Improved hash relocation logic to recompute touched lines after hash-based line number adjustments, preventing incorrect merge heuristics
- Enhanced error messages for no-op edits to include preview of target lines with their current hashes and content
- Changed hashline edit format from `src`/`dst` object structure to direct operation schemas (`replaceLine`, `replaceLines`, `insertAfter`)
- Changed hash algorithm from 2-character hexadecimal to 3-character base-36 alphanumeric for improved readability and collision resistance
- Improved hash mismatch handling to automatically relocate stale line references when the hash uniquely identifies a moved line
- Changed `HashlineEdit` from `src`/`dst` format to direct operation schemas: `replaceLine`, `replaceLines`, `insertAfter`
- Changed hash algorithm from hexadecimal (base-16) to base-36 alphanumeric for shorter, more readable line references
- Increased maximum wrapped-line restoration from 6 to 10 lines to handle longer reflowed statements
- Updated prompt examples to use `{{hashline}}` Handlebars helper for generating correct line references in tool instructions

### Removed

- Removed `insertBefore` hashline edit operation for inserting content before a line
- Removed `substr` hashline edit operation for substring-based line replacement
- Removed `insertBefore` and `substr` hashline edit variants

### Fixed

- Fixed `parseLineRef` to handle both legacy pipe-separator format (`LINE:HASH| content`) and new two-space format (`LINE:HASH  content`) for backward compatibility
- Fixed resource leak in browser query handler by properly disposing owned proxy elements for non-winning candidates
- Fixed script evaluation to support async functions and await expressions in browser evaluate operations
- Fixed `range` edits with missing `end` field to gracefully degrade to single-line edits instead of crashing
- Fixed `insertAfter` operations to accept both `content` and `replacement` field names for consistency with other edit types
- Fixed deduplication logic to correctly identify and remove identical hashline edits targeting the same line(s) in a single call
- Fixed range-based edits to prevent invalid mutations when hash relocation changes the number of lines in the target range
- Fixed multi-edit application to use original file state for all anchor references, preventing incorrect line numbers when earlier edits change file length

## [11.10.4] - 2026-02-10

### Added

- Hashline diff computation with `computeHashlineDiff` function for preview rendering of hashline-mode edits
- Streaming preview display for hashline edits in tool execution UI showing edit sources and destinations
- Streaming hash line computation with progress updates via `onUpdate` callback in read tool
- Optional `onCollectedLine` callback parameter to `streamLinesFromFile` for line collection tracking

### Changed

- Edit tool renderer now displays computed preview diffs for hashline operations before execution
- Read tool now streams hash lines incrementally instead of computing them all at once, improving responsiveness for large files
- Refactored hash line formatting to use async `streamHashLinesFromLines` for better performance

## [11.10.3] - 2026-02-10
### Added

- Exported `./patch/*` subpath for direct access to patch utilities

## [11.10.2] - 2026-02-10

### Added

- Exported `streamHashLinesFromUtf8` and `streamHashLinesFromLines` functions for streaming hashline-formatted output with configurable chunking
- Added `HashlineStreamOptions` interface to control streaming behavior (startLine, maxChunkLines, maxChunkBytes)
- Added `streamHashLinesFromUtf8` function to incrementally format content with hash lines from a UTF-8 byte stream
- Added `streamHashLinesFromLines` function to incrementally format content with hash lines from an iterable of lines

### Changed

- Updated hashline format to use 2-character hex hashes instead of 4-character hashes for more compact line references
- Modified `computeLineHash` to normalize whitespace in line content and removed line number from hash seed for consistency
- Improved CLI argument parsing to explicitly handle `--help`, `--version`, and subcommand detection instead of prefix-based routing

### Removed

- Removed `@types/diff` dev dependency
- Removed AggregateError unwrapping from console.warn in CLI initialization

## [11.10.1] - 2026-02-10
### Changed

- Migrated CLI framework from oclif to lightweight pi-utils CLI runner
- Replaced oclif command registration with explicit command entries in cli.ts
- Changed default root command name from 'index' to 'launch'
- Updated all command imports to use @oh-my-pi/pi-utils/cli instead of @oclif/core

### Removed

- Removed @oclif/core and @oclif/plugin-autocomplete dependencies
- Removed oclif configuration from package.json
- Removed custom oclif help renderer (oclif-help.ts)

## [11.10.0] - 2026-02-10
### Breaking Changes

- Changed `HashlineEdit.src` from string format (e.g., `"5:ab"`, `"5:ab..9:ef"`) to structured `SrcSpec` object with discriminated union types (`{ kind: "single", ref: "..." }`, `{ kind: "range", start: "...", end: "..." }`, etc.)
- Changed `HashlineEdit` API from `old: string | string[]` / `new: string | string[]` to `src: string` / `dst: string`; src uses range syntax `"5:ab"` (single), `"5:ab..9:ef"` (range), `"5:ab.."` (insert after), or `"..5:ab"` (insert before)
- Removed support for comma and newline-separated line reference lists in hashline edits; use range syntax instead
- Removed `after` field from `HashlineEdit`; insert-after is now expressed via open range syntax `src: "5:ab.."`
- Changed `HashlineEdit` API from `old: string | string[]` / `new: string | string[]` to `src: string` / `dst: string`; multi-line content uses `\n`-separated strings, empty string `""` for insert/delete operations
- Replaced `edit.patchMode` boolean setting with `edit.mode` enum; existing `edit.patchMode: true` configurations should use `edit.mode: patch`
- Changed `getEditModelVariants()` return type from `Record<string, "patch" | "replace">` to `Record<string, EditMode | null>`
- Removed `after` field from `HashlineEdit`; insert-after is now expressed via open range syntax `src: "5:ab.."`
- Changed `HashlineEdit.src` from newline-separated line ref lists to range syntax: `"5:ab"` (single), `"5:ab..9:ef"` (range), `"5:ab.."` (insert after); comma and newline-separated lists are no longer supported

### Added

- Added substring-based source matching for hashline edits when line reference format is invalid, allowing fallback to unique substring search within the file
- Added automatic detection and repair of single-line merges where models absorb adjacent lines, preventing content duplication
- Added normalization of unicode-confusable hyphens (en-dash, em-dash, etc.) to ASCII hyphens when edits would otherwise be no-ops
- Added heuristics to restore original indentation and preserve wrapped line formatting in hashline edits
- Added abort signal support to MCP server connection and tool listing operations, allowing requests to be cancelled via Escape key during testing
- Added `MCPRequestOptions` interface with `signal` property to support request cancellation via AbortSignal
- Added abort signal support to MCP tool execution, allowing requests to be cancelled via Escape-to-interrupt or other abort mechanisms
- Added `HashlineMismatchError` class that displays grep-style output with `>>>` markers showing correct `LINE:HASH` references when hash validation fails
- Added `HashMismatch` type to represent individual hash mismatches with line number, expected hash, and actual hash
- Added hashline edit mode for line-addressed edits using content hashes (LINE:HASH format) with integrity verification
- Added `readHashLines` setting to include line hashes in read output for hashline edit mode
- Added `edit.mode` setting (enum: replace, patch, hashline) to select edit tool variant, replacing `edit.patchMode` boolean
- Added `hashes` parameter to read tool to output line hashes in format `LINE:HASH| content`
- Added automatic hash line output when using hashline edit mode or `readHashLines` setting is enabled
- Added `computeLineHash`, `formatHashLines`, `parseLineRef`, `validateLineRef`, and `applyHashlineEdits` functions for hashline operations
- Added `HashlineEdit` and `HashlineInput` types for structured hashline edit operations
- Added `normalizeEditMode` function to validate and normalize edit mode strings
- Added subcommand definitions for `/mcp` command with 10 subcommands (add, list, remove, test, reauth, unauth, enable, disable, reload, help) including usage hints for argument completion
- Added inline hint support for slash commands with simple arguments (`/export [path]`, `/compact [focus instructions]`, `/handoff [focus instructions]`)
- Added subcommand dropdown completion for `/browser` command (headless, visible modes)
- Added `SubcommandDef` interface for declarative subcommand definitions with name, description, and usage hints
- Added `subcommands` and `inlineHint` properties to `BuiltinSlashCommand` interface for enhanced command metadata
- Added `getArgumentCompletions` and `getInlineHint` functions to materialized slash commands for autocomplete and ghost text hints
- Added `temperature` setting to control sampling temperature (0 = deterministic, 1 = creative, -1 = provider default)
- Added temperature option selector in settings UI with preset values (Default, 0, 0.2, 0.5, 0.7, 1)

### Changed

- Relaxed comma validation in `src` to allow trailing content after line references (e.g., `14:abexport function foo()`), while still rejecting inputs that appear to contain multiple line refs
- Improved `parseLineRef` to accept hash prefixes shorter than the full hash length, allowing partial hash matches
- Enhanced error message for hash mismatches to guide users toward re-reading the file and using updated LINE:HASH references
- Updated hashline tool documentation to clarify that accidental trailing text after LINE:HASH will be extracted, and to discourage merging multiple lines into single-line replacements
- Treated same-line ranges (e.g., `5:ab..5:cd`) as single-line replacements instead of range operations
- Enhanced hashline edit robustness with heuristics to strip anchor line echoes and range boundary echoes that models may copy into replacement content
- Improved whitespace preservation in hashline edits to handle mismatched line counts using loose matching strategy
- Strengthened hashline edit validation to reject malformed src specs (embedded newlines, commas, invalid ranges)
- Enhanced MCP connection timeout handling to properly respect abort signals and distinguish between timeout and user-initiated cancellation
- Improved MCP test command UI to show cancellation hint (esc to cancel) and handle graceful cancellation without blocking cleanup
- Updated HTTP transport session termination to use AbortSignal.timeout() for reliable cleanup with timeout protection
- Enhanced bash executor to properly handle abort signals by registering abort event listeners and cleaning up resources in finally block
- Improved bash tool error handling to distinguish between user-initiated aborts (via AbortSignal) and other cancellations, throwing ToolAbortError for aborted requests
- Enhanced MCP request handling to propagate abort signals through HTTP, SSE, and stdio transports with proper cleanup
- Improved stdio transport request handling to use Promise.withResolvers for cleaner async flow and better abort signal integration
- Updated HTTP transport to combine operation abort signals with timeout signals using AbortSignal.any() for unified cancellation
- Modified SSE response parsing to support abort signals and distinguish between timeout and user-initiated cancellation
- Improved hashline edit robustness by automatically stripping `LINE:HASH|` display prefixes and unified-diff `+` markers that models may copy into replacement content
- Enhanced replace edits to preserve original whitespace on lines where only whitespace differs, preventing spurious formatting diffs when models reformat code
- Enhanced system prompt to display tool descriptions alongside tool names for improved clarity on available capabilities
- Reduced hash length from 4 to 2 hex characters (16-bit hashes) for more concise line references
- Updated `HashlineEdit` type to accept `string | string[]` for `old` and `new` fields, allowing single-line edits without array wrapping
- Enhanced `parseLineRef` to strip display-format suffix (e.g., `5:ab| content` → `5:ab`), allowing models to copy full read output format
- Improved `validateLineRef` to throw `HashlineMismatchError` with context lines instead of generic error, providing grep-style output with correct hashes
- Modified hash computation to strip trailing carriage returns before hashing for consistent line hash values
- Renamed `HashlineEdit` fields from `src`/`dst` to `old`/`new` for clarity in replace, delete, and insert operations
- Enhanced hash validation in `applyHashlineEdits` to collect all mismatches before throwing, providing comprehensive error reporting with context lines
- Changed `edit.patchMode` boolean setting to `edit.mode` enum (replace, patch, hashline) with default value patch
- Changed edit tool to support three modes (replace, patch, hashline) instead of two, with dynamic mode selection based on model and settings
- Changed read tool to prioritize hash lines over line numbers when both are requested
- Changed `getEditVariantForModel` to return `EditMode | null` and removed hardcoded Kimi model detection
- Renamed `settingsInstance` parameter to `settings` in `CreateAgentSessionOptions` for consistency
- Updated all internal references from `settingsInstance` to `settings` throughout SDK and components

### Fixed

- Fixed substring source matching to reject ambiguous matches and provide helpful error messages showing all occurrences
- Fixed substring source matching to require exactly one matching line in the file
- Fixed MCP test command to properly clean up connections even when cancelled or aborted, preventing resource leaks

## [11.9.0] - 2026-02-10

### Added

- Added `/mcp` slash command for runtime MCP server management (add, list, remove, enable, disable, test, reauth)
- Added interactive multi-step wizard for adding MCP servers with transport auto-detection
- Added OAuth auto-discovery and authentication flow for MCP servers requiring authorization
- Added MCP config file writer for persisting server configurations at user and project level
- Added `enabled` and `timeout` fields to MCP server configuration
- Added runtime MCP manager reload and active tool registry rebind without restart
- Added MCP command guide documentation

### Changed

- Replaced `setTimeout` with `Bun.sleep()` for improved performance in file lock retry logic
- Refactored component invalidation handling to use dedicated helper function for cleaner code
- Improved error handling in worktree baseline application to use `isEnoent()` utility instead of file existence checks
- Updated bash tool to use standard Node.js `fs.promises.stat()` with `isEnoent()` error handling
- Replaced `tmpdir()` named import with `os` namespace import for consistency
- Migrated logging from `chalk` and `console.error` to structured logger from `@oh-my-pi/pi-utils`

### Fixed

- Improved browser script evaluation to handle both expression and statement forms, fixing evaluation failures for certain script types
- Fixed unsafe OAuth endpoint extraction that could redirect token exchange to attacker-controlled URLs
- Fixed PKCE code verifier stored via untyped property; now uses typed private field
- Fixed refresh token fallback incorrectly using access token when no refresh token provided
- Fixed MCP config files written with default permissions; now enforces 0o700/0o600 for secret protection
- Fixed add wizard ignoring user-chosen environment variable name and auth header name
- Fixed reauth endpoint discovery misclassifying non-OAuth servers as discovery failures
- Fixed resolved OAuth tokens leaking into connection config, causing cache churn on token rotation
- Fixed unvalidated type assertions for `enabled`/`timeout` config fields from user-controlled JSON
- Fixed uncaught exceptions in `/mcp add` quick-add flow crashing the interactive loop
- Fixed greedy `/mcp` prefix match routing `/mcpfoo` to MCP controller
- Fixed stdio transport timeout timer leak keeping process alive after request completion

### Removed

- Removed `GrepOperations` interface from public API exports
- Removed `GrepToolOptions` interface from public API exports
- Removed unused `_options` parameter from `GrepTool` constructor

## [11.8.1] - 2026-02-10

### Added

- Added current date to system prompt context in YYYY-MM-DD format for date-aware agent reasoning
- Added file size display in UI when files are skipped due to size limits
- Added support for gigabyte (GB) file size formatting in truncate utility

### Changed

- Changed skipped file messages to include file size information for better visibility into why files were excluded
- Changed file processing to skip reading files exceeding 5MB (text) or 25MB (images) and include them as path-only references instead
- Changed @mention auto-reading to skip files exceeding 5MB (text) or 25MB (images) to prevent out-of-memory issues with large files
- Clarified that subagents automatically inherit full system prompt including AGENTS.md, context files, and skills — do not repeat project rules or conventions in task context
- Updated task context guidance to focus on session-specific information subagents lack, eliminating redundant documentation of project constraints already available to them
- Refined constraints template to emphasize task-specific rules and session decisions rather than global project conventions
- Expanded anti-patterns section to explicitly flag redundant context that wastes tokens by repeating AGENTS.md rules, project constraints, and tool preferences

### Fixed

- Fixed bash tool hanging when commands spawn background jobs by properly detecting foreground process completion
- Fixed bash tool occasionally hanging after command completion when background jobs keep stdout/stderr open
- Fixed crash when auto-reading @mentions for very large files by skipping content injection with an explicit "skipped" note
- Improved bash tool output draining after foreground completion to reduce tail output truncation

## [11.8.0] - 2026-02-10
### Added

- Added `ctx.reload()` method to extension command context to reload extensions, skills, prompts, and themes from disk
- Added `ctx.ui.pasteToEditor()` method to paste text into the editor with proper handling (e.g., large paste markers in interactive mode)
- Added extension UI sub-protocol for RPC mode enabling dialog methods (`select`, `confirm`, `input`, `editor`) and fire-and-forget UI methods via client communication
- Added support for tilde (`~`) expansion in custom skill directory paths
- Added example extension demonstrating `ctx.reload()` usage with both command and LLM-callable tool patterns

### Changed

- Changed `ctx.hasUI` behavior: now `true` in RPC mode (previously `false`), with dialog methods working via extension UI sub-protocol
- Changed warning output for invalid CLI arguments to use structured logging instead of console.error
- Changed help text to indicate command-specific help is available via `<command> --help`
- Changed tool result event handlers to chain like middleware, allowing each handler to see and modify results from previous handlers with partial patch support

### Fixed

- Fixed archive extraction security vulnerability by validating that extracted paths do not escape the extraction directory
- Fixed archive format validation to reject unsupported formats before extraction attempt
- Fixed archive extraction error handling to provide clear error messages on failure

## [11.7.0] - 2026-02-07
### Changed

- Enhanced error messages for failed Python cells to include full combined output context instead of just the error message
- Updated error cell output styling to use error color theme instead of standard tool output color for better visual distinction

### Fixed

- Improved error handling in Python cell execution to preserve and display combined output from previous cells when an error occurs
- Fixed tab character rendering in Python tool output display to properly format whitespace in cell output and status events

## [11.6.1] - 2026-02-07
### Fixed

- Fixed potential crash when rendering results with undefined details.results

## [11.6.0] - 2026-02-07

### Fixed

- Fixed task tool renderer not sanitizing tabs, causing visual holes in TUI output
- Fixed task tool expanded view showing redundant `<swarm_context>` block that is shared across all tasks
- Fixed assistant message spacer appearing before tool executions when no visible content follows thinking block
- Fixed extension runner `emit()` type safety with narrowed event/result types
- Fixed extension runner `tool_result` event chaining across multiple extensions via dedicated `emitToolResult()`
- Fixed queued messages not delivered after auto-compaction completes

### Added

- Added `/quit` slash command as alias for `/exit`
- Added per-model overrides (`modelOverrides`) in `models.json` for customizing built-in model properties
- Added `mergeCustomModels` to merge custom models with built-ins by provider+id instead of replacing

## [11.5.2] - 2026-02-07

### Fixed

- Fixed TUI crash when ask tool renders long user input exceeding terminal width by using Text component for word wrapping instead of raw line output
- Fixed TUI crash when todo_write tool renders long todo content exceeding terminal width by using Text component for word wrapping instead of truncation

## [11.5.0] - 2026-02-06

### Added

- Added terminal breadcrumb tracking to remember the last session per terminal, enabling `--continue` to work correctly with concurrent sessions in different terminals

### Changed

- Changed screenshot format to always use PNG instead of supporting JPEG with quality parameter
- Changed default extract_readable format from text to markdown
- Changed screenshot storage to use temporary directory with Snowflake IDs instead of artifacts directory
- Changed ResizedImage interface to return buffer as Uint8Array with lazy-loaded base64 data getter for improved memory efficiency

### Removed

- Removed JPEG quality parameter from screenshot options
- Removed format selection for screenshots (now PNG only)
- Removed ability to save screenshots to custom paths or artifacts directory

## [11.4.1] - 2026-02-06
### Fixed

- Fixed tab character display in error messages and bash tool output by properly replacing tabs with spaces

## [11.4.0] - 2026-02-06

### Added

- Visualize leading whitespace (indentation) in diff output with dim glyphs—tabs display as `→` and spaces as `·` for improved readability

### Fixed

- Fixed patch applicator to correctly handle context-only hunks (pure context lines between @@ markers) without altering indentation in tab-indented files
- Fixed indentation conversion logic to infer tab width from space-to-tab patterns using linear regression (ax+b model) when pattern uses spaces and actual file uses tabs
- Fixed tab character rendering in tool output previews and code cell displays, ensuring tabs are properly converted to spaces for consistent terminal display
- Fixed `newSession()` to properly await session manager operations, ensuring new session is fully initialized before returning
- Fixed session formatting to use XML structure for tools and tool invocations instead of YAML, improving compatibility with structured output parsing

## [11.3.0] - 2026-02-06

### Added

- Added resumption hint printed to stderr on session exit showing command to resume the session (e.g., `Resume this session with claude --resume <session-id>`)
- New `BlobStore` class for content-addressed storage of large binary data (images) externalized from session files
- New `getBlobsDir()` function to get path to blob store directory
- Support for externalizing large images to blob store during session persistence, reducing JSONL file size
- New blob reference format (`blob:sha256:<hash>`) for tracking externalized image data in sessions
- Exported `ModeChangeEntry` type for tracking agent mode transitions
- Support for restoring plan mode state when resuming sessions
- New `appendModeChange()` method in SessionManager to record mode transitions
- New `mode` and `modeData` fields in SessionContext to track active agent mode
- Support for `PI_PACKAGE_DIR` environment variable to override package directory (useful for Nix/Guix store paths)
- New keybindings for session management: `toggleSessionNamedFilter` (Ctrl+N), `newSession`, `tree`, `fork`, and `resume` actions
- Support for shell command execution in configuration values (API keys, headers) using `!` prefix, with result caching
- New `clearOnShrink` display setting to control whether empty rows are cleared when content shrinks
- New `SlashCommandInfo`, `SlashCommandLocation`, and `SlashCommandSource` types for extension slash command discovery
- New `getCommands()` method in ExtensionAPI to retrieve available slash commands
- New `switchSession()` action in ExtensionCommandContext to switch between sessions
- New `SwitchSessionHandler` type for extension session switching handlers
- New `getSystemPrompt()` method in ExtensionUIContext to access current system prompt
- New `getToolsExpanded()` and `setToolsExpanded()` methods in ExtensionUIContext for tool output expansion control
- New `WriteToolCallEvent` type for write tool call events
- New `isToolCallEventType()` type guard for tool call events
- Support for image content in RPC `steer` and `followUp` commands
- New `GitSource` type and `parseGitUrl()` function for parsing git URLs in plugin system
- Tool input types exported: `BashToolInput`, `FindToolInput`, `GrepToolInput`, `ReadToolInput`, `WriteToolInput`
- Support for `@` prefix normalization in file paths (strips leading `@` character)
- New `parentSessionPath` field in SessionInfo to track forked session origins
- Skill file relative path resolution against skill directory in system prompt
- Support for Termux/Android package installation guidance for missing tools
- Support for puppeteer query handlers (aria/, text/, xpath/, pierce/) in selector parameters across all browser actions
- Automatic normalization of legacy p- prefixed selectors (p-aria/, p-text/, p-xpath/, p-pierce/) to modern puppeteer query handler syntax
- Improved click action with intelligent element selection that prioritizes visible, actionable candidates and retries until timeout
- Enhanced actionability checking for click operations, validating visibility, pointer events, opacity, viewport intersection, and element occlusion

### Changed

- Modified `--resume` flag to accept optional session ID or path (e.g., `--resume abc123` or `--resume /path/to/session.jsonl`), with session picker shown when no value provided
- Consolidated `--session` flag as an alias for `--resume` with value for improved CLI consistency
- Removed read tool grouping reset logic that was breaking grouping when text or thinking blocks appeared between tool calls
- Image persistence now externalizes images ≥1KB to content-addressed blob store instead of compressing inline
- Session loading now automatically resolves blob references back to base64 image data
- Session forking now resolves blob references in copied entries to ensure data integrity
- Screenshot tool now automatically compresses images for API content using the same resizing logic as pasted images, reducing payload size while maintaining quality
- Improved text truncation across tool renderers to respect terminal width constraints and prevent output overflow
- Enhanced render caching to include width parameter for accurate cache invalidation when terminal width changes
- HTML export filter now treats `mode_change` entries as settings entries alongside model changes and thinking level changes
- Replaced ellipsis string (`...`) with Unicode ellipsis character (`…`) throughout UI text and truncation logic for improved typography
- Improved render performance by introducing caching for tool output blocks and search results to avoid redundant text width and padding computations
- Enhanced read tool grouping to reset when non-tool content (text/thinking blocks) appears between read calls, preventing unintended coalescing
- Improved string preview formatting in scalar values to show line counts and truncation indicators for multi-line strings
- Refactored tool execution component to use shared mutable render state for spinner frames and expansion state, reducing closure overhead
- Enhanced error handling in tool renderers with logging for renderer failures instead of silent fallbacks
- Made shell command execution in configuration values asynchronous to prevent blocking the TUI
- Improved `@` prefix normalization to only strip leading `@` for well-known path syntaxes (absolute paths, home directory, internal URL shorthands) to avoid mangling literal paths
- Enhanced git URL parsing to strip credentials from repository URLs and validate URL-encoded hash fragments
- Improved null data handling in task submission to preserve agent output when `submit_result` is called with null/undefined data, enabling fallback text extraction instead of discarding output
- Updated default model IDs across providers: Claude Sonnet 4.5 → Claude Opus 4.6, Gemini 2.5 Pro → Gemini 3 Pro variants, and others
- Made model definition fields optional with sensible defaults for local models (Ollama, LM Studio, etc.)
- Modified custom tool execute signature to reorder parameters: `(toolCallId, params, signal, onUpdate, ctx)` instead of `(toolCallId, params, onUpdate, ctx, signal)`
- Changed `--version` and `--list-models` flags to exit with `process.exit(0)` instead of returning
- Improved `--export` flag to exit with `process.exit(0)` on success
- Enhanced tree selector to preserve last selected ID across filter changes
- Modified tree navigation to use real leaf ID instead of skipping metadata entries
- Improved footer path truncation logic to prevent invalid truncation at boundary
- Enhanced model selector to display selected model name when no matches found
- Improved RPC client `steer()` and `followUp()` methods to accept optional image content
- Updated extension loader to check for explicit extension entries in root directory before discovering subdirectories
- Removed line limiting in custom message component when collapsed
- Improved API key resolution to support shell command execution via `resolveConfigValue()`
- Enhanced session branching to preserve parent session path reference
- Updated selector parameter descriptions to document support for CSS selectors and puppeteer query handlers
- Modified viewport handling in headless mode to respect custom viewport parameters while disabling viewport in headed mode for better window management
- Improved click action to use specialized text query handler logic with retry mechanism for better reliability with dynamic content

### Fixed

- Fixed background color stability in output blocks when inner content contains SGR reset sequences, preventing background color from being cleared mid-line
- Fixed spurious ellipsis appended to output lines that were already padded to terminal width by trimming trailing spaces before truncation check
- Fixed config file parsing to properly handle missing files instead of treating them as errors
- Fixed truncation indicator in truncate tool to use ellipsis character (…) instead of verbose '[truncated]' suffix
- Fixed concurrent shell command execution by de-duplicating in-flight requests for the same command
- Fixed git URL parsing to properly handle URL-encoded characters in hash fragments and reject invalid encodings
- Fixed task executor to properly handle agents calling `submit_result` with null data by treating it as missing and attempting to extract output from conversation text rather than silently failing
- Fixed HTML export template to safely handle invalid argument types in tool rendering
- Fixed path shortening in HTML export to handle non-string paths
- Fixed custom message rendering to properly display full content without artificial line limits
- Fixed tree navigation to only restore editor text when editor is empty
- Fixed session creation to properly track parent session when forking
- Fixed thinking level initialization to only append change entry for new sessions without existing thinking entries
- Fixed tool expansion state management to properly propagate through UI context
- Fixed click action to properly handle text/ query handlers with timeout and retry logic instead of failing immediately
- Fixed viewport application to only apply when in headless mode or when explicitly requested, preventing conflicts in headed browser mode

### Security

- Added support for shell command execution in configuration values with caching to enable secure credential resolution patterns

## [11.2.1] - 2026-02-05

### Fixed

- Fixed CLI invocation with flags only (e.g. `pi --model=codex`) to route to the default command instead of erroring

## [11.2.0] - 2026-02-05

### Added

- Added `omp commit` command to generate commit messages and update changelogs with `--push`, `--dry-run`, `--no-changelog`, and model override flags
- Added `omp config` command to manage configuration settings with actions: list, get, set, reset, path
- Added `omp grep` command to test grep tool with pattern matching, glob filtering, context lines, and output modes
- Added `omp jupyter` command to manage the shared Jupyter gateway with status and kill actions
- Added `omp plugin` command to manage plugins with install, uninstall, list, link, doctor, features, config, enable, and disable actions
- Added `omp setup` command to install dependencies for optional features like Python
- Added `omp shell` command for interactive shell console with working directory and timeout configuration
- Added `omp stats` command to view usage statistics with dashboard server, JSON output, and summary options
- Added `omp update` command to check for and install updates with force and check-only modes
- Added `omp web-search` command (alias `omp q`) to test web search providers with provider selection, recency filtering, and result limits
- Migrated CLI from custom argument parser to oclif framework for improved command structure and help system
- Added `omp q` CLI subcommand for testing web search providers with query, provider, recency, and limit options
- Added web search provider information API with authentication requirements and provider metadata
- Added support for `hour` recency filter option in Perplexity web search
- Support for image file mentions—images are now automatically detected, resized, and attached when referenced with @filepath syntax
- Image dimension information displayed in file mention UI to show image properties alongside text files

### Changed

- Refactored web search provider system to use individual provider classes in separate files for improved maintainability
- Moved `SearchProvider` base class and `SearchParams` interface to dedicated `providers/base.ts` module
- Updated web search execution to pass `maxOutputTokens`, `numSearchResults`, and `temperature` parameters to providers
- Changed Perplexity search context size from 'high' to 'medium' and added search classifier, reasoning effort, and language preference settings
- Increased Perplexity default max tokens from 4096 to 8192 for more comprehensive responses
- Updated Anthropic and Gemini search providers to support `max_tokens` and `temperature` parameters for finer control over response generation
- Simplified `AuthStorage.create()` to accept direct agent.db path
- Renamed web search types and exports for consistency: `WebSearchProvider` → `SearchProviderId`, `WebSearchResponse` → `SearchResponse`, `WebSearchTool` → `SearchTool`, and related functions
- Refactored web search provider system to use centralized provider registry with `getSearchProvider()` and `resolveProviderChain()` for improved provider management
- Updated web search system prompt to emphasize comprehensive, detailed answers with concrete data and specific examples over brevity
- Simplified Exa API key discovery to check environment variables only, removing .env file fallback logic
- Refactored `ModelRegistry` instantiation to use direct constructor instead of `discoverModels()` helper function across codebase
- Refactored CLI entry point to use oclif command framework instead of custom subcommand routing
- Reorganized subcommands into individual command files under `src/commands/` directory for better maintainability
- Updated extension flag handling to parse raw arguments directly instead of using custom flag definitions
- Refactored web search provider definitions into centralized provider-info module for better maintainability
- Updated web search result rendering to support long-form answers with text wrapping in CLI mode
- Removed related questions section from web search result rendering
- Updated Perplexity API types to support extended message content formats including images, files, and PDFs
- Updated Perplexity search to use 'pro' search type for improved search quality and relevance
- File mention messages now support both text content and image attachments, with optional line count for text files
- Updated file mention processing to respect image auto-resize settings

### Removed

- Removed legacy auth.json file—credentials are stored exclusively in agent.db

### Fixed

- Fixed type handling in model selector error message display to properly convert error objects to strings
- Fixed web search to use search results when Perplexity API returns no citations, ensuring search results are always available to users
- Fixed model switches deferred during streaming to apply correctly when the stream completes, preventing model changes from being lost
- Fixed plan mode toggles during streaming to inject plan-mode context immediately, preventing file edits while in plan mode
- Fixed plan mode model switches during streaming to defer model changes until the current turn completes

## [11.1.0] - 2026-02-05

### Added

- Added `sortDiagnostics()` utility function to sort diagnostics by severity, location, and message for consistent output ordering
- Added `task.isolation.enabled` setting to control whether subagents run in isolated git worktrees
- Added dynamic task schema that conditionally includes `isolated` parameter based on isolation setting
- Added `openInEditor()` utility function to centralize external editor handling with support for custom file extensions and stdio configuration
- Added `getEditorCommand()` utility function to retrieve the user's preferred editor from $VISUAL or $EDITOR environment variables

### Changed

- Changed diagnostic output to sort results by severity (errors first), then by file location and message for improved readability
- Changed task tool to validate isolation setting and reject `isolated` parameter when isolation is disabled
- Changed task API to use `assignment` field instead of `args` for per-task instructions, with shared `context` prepended to every task
- Changed task template rendering to use structured context/assignment separation with `<swarm_context>` wrapper instead of placeholder-based substitution
- Changed task item schema to require `assignment` string (complete per-task instructions) instead of optional `args` object
- Changed `TaskItem` to remove `args` field and add `assignment` field for clearer per-task instruction semantics
- Changed agent frontmatter to use `thinking-level` field name instead of `thinkingLevel` for consistency
- Refactored task rendering to display full task text instead of args in progress and result views
- Changed `SubmenuSettingDef.getOptions()` method to `options` getter property for cleaner API access
- Converted static option providers from functions to direct array definitions for improved performance
- Added `createSubmenuSettingDef()` helper function to support both static and dynamic option providers
- Modified `setThinkingLevel()` API to accept optional `persist` parameter (defaults to false) for controlling whether thinking level changes are saved to settings
- Refactored hook editor and input controller to use shared external editor utilities, reducing code duplication

### Removed

- Removed `context` parameter from `ExecutorOptions` — context now prepended at template level before task execution
- Removed `args` field from `AgentProgress` and `SingleResult` interfaces
- Removed placeholder-based template rendering in favor of structured context/assignment model

## [11.0.3] - 2026-02-05

### Added

- Added new subcommands to help text: `commit` for AI-assisted git commits, `stats` for AI usage statistics dashboard, and `jupyter` for managing the shared Jupyter gateway
- Added `grep` subcommand to help text for testing the grep tool
- Added `browser` tool documentation for browser automation using Puppeteer
- Added `todo_write` tool documentation for managing todo and task lists
- Added documentation for additional LLM provider API keys (Groq, Cerebras, xAI, OpenRouter, Mistral, z.ai, MiniMax, OpenCode, Cursor, Vercel AI Gateway) in environment variables reference
- Added documentation for cloud provider configuration (AWS Bedrock, Google Vertex AI) in environment variables reference
- Added documentation for search provider API keys (Perplexity, Anthropic Search) in environment variables reference
- Added documentation for model override environment variables (`PI_SMOL_MODEL`, `PI_SLOW_MODEL`, `PI_PLAN_MODEL`) in CLI help text
- Added comprehensive environment variables reference documentation at `docs/environment-variables.md` covering API keys, configuration, debugging, and testing variables
- Added theme system with 44 customizable color tokens, two built-in themes (dark/light), and auto-detection based on terminal background
- Added `/theme` command to interactively select and switch between themes
- Added support for custom themes in `~/.pi/agent/themes/*.json` with live editing - changes apply immediately when files are saved
- Added `userMessageText` theme token for customizing user message text color
- Added `toolTitle` and `toolOutput` theme tokens for separate coloring of tool execution box titles and output

### Changed

- Updated help text to reflect expanded tool availability - default now enables all tools instead of just read, bash, edit, write
- Updated available tools list in help documentation to include python, notebook, task, fetch, web_search, browser, and ask
- Simplified main description in help text from 'AI coding assistant with read, bash, edit, write tools' to 'AI coding assistant'
- Updated `--tools` option documentation to clarify default behavior and list all available tools
- Changed all environment variable access from `process.env` to `Bun.env` throughout the codebase for Bun runtime compatibility
- Updated documentation to reference `Bun.env` instead of `process.env` in examples and comments

### Fixed

- Fixed `Text` component to properly implement `invalidate()` method, ensuring theme changes apply correctly to all UI elements
- Fixed `TruncatedText` component to properly pad all lines to exactly match the specified width, preventing rendering artifacts
- Fixed `TruncatedText` component to stop at the first newline and only display the first line
- Fixed invalid or malformed themes to fall back gracefully to dark theme instead of crashing the application

## [11.0.2] - 2026-02-05

### Fixed

- Fixed role model cycling to expand role aliases (e.g., roles pointing at `pi/plan`) so slow/default/smol cycles resolve correctly

## [11.0.0] - 2026-02-05

### Added

- Added UI dropdown options for `task.maxRecursion Depth` setting with presets (Unlimited, None, Single, Double, Triple)
- Added UI dropdown options for `grep.contextBefore` setting with presets (0-5 lines)
- Added UI dropdown options for `grep.contextAfter` setting with presets (0-10 lines)
- Added `task.maxRecursionDepth` setting to control how many levels deep subagents can spawn their own subagents (0=none, 1=one level, 2=two levels, -1=unlimited)
- Added support for nested task artifact naming with parent task prefixes (e.g., "0-Auth.1-Subtask") to organize hierarchical task outputs
- Added `taskDepth` and `parentTaskPrefix` options to `CreateAgentSessionOptions` for tracking subagent recursion depth and organizing nested artifacts
- Added `task.maxConcurrency` setting to control concurrent limit for subagents (default: 32)
- Added UI options for task concurrency configuration with presets from unlimited to 64 tasks
- Added support for loading skills from `~/.agents/skills`

### Changed

- Simplified `task.maxRecursionDepth` description in settings UI to remove specific value examples
- Made thinking level persistence optional via `persist` parameter in `setThinkingLevel()` method, allowing temporary thinking level changes without saving to settings
- Updated thinking level cycling to no longer persist changes to settings, enabling quick iteration through thinking levels without modifying user preferences
- Replaced nanoid with Snowflake for ID generation throughout codebase for improved performance and collision resistance
- Updated session ID format in documentation from nanoid to snowflake hex string (e.g., "a1b2c3d4e5f60001")
- Renamed environment variable prefix from `OMP_` to `PI_` throughout codebase (e.g., `OMP_DEBUG_STARTUP` → `PI_DEBUG_STARTUP`, `OMP_PYTHON_GATEWAY_URL` → `PI_PYTHON_GATEWAY_URL`)
- Removed `env` setting from configuration schema; environment variables are no longer automatically applied from settings
- Changed `venvPath` property in PythonRuntime from nullable to optional (returns `undefined` instead of `null`)
- Simplified notification settings from protocol-specific options (bell, osc99, osc9) to simple on/off toggle for `completion.notify` and `ask.notify`
- Moved notification protocol detection and sending to `TERMINAL` API from local utility functions
- Changed task tool spawns configuration from "explore" to "\*" to allow subagents to spawn any agent type
- Changed system prompt to enable parallel delegation guidance for all agents (removed coordinator-only restriction)
- Changed task tool to automatically disable itself when maximum recursion depth is reached, preventing infinite nesting
- Changed task concurrency from hardcoded constant to configurable setting via `task.maxConcurrency`
- Changed concurrency limit calculation to support unlimited concurrency when set to 0

### Removed

- Removed nanoid dependency from package.json
- Removed `terminal-notify.ts` utility module with `detectNotificationProtocol()`, `sendNotification()`, and `isNotificationSuppressed()` functions
- Removed `MAX_PARALLEL_TASKS` constant and associated task count validation limit

### Fixed

- Fixed MCP tool name generation to properly sanitize server and tool names, preventing invalid characters and duplicate prefixes in tool identifiers
- Fixed task ID display formatting to show hierarchical structure for nested tasks (e.g., "0.1 Auth>Subtask" instead of "0-Auth.1-Subtask")
- Improved frontmatter parsing error messages to include source context for better debugging

## [10.6.1] - 2026-02-04

### Added

- Added `commit` model role for dedicated commit message generation
- Exported `resolveModelOverride` function from model resolver for external use

### Changed

- Updated model role resolution to accept optional `roleOrder` parameter for custom role priority
- Made `tag` and `color` properties optional in `ModelRoleInfo` interface
- Updated model selector to safely handle roles without tag or color definitions
- Refactored role label display to use centralized `MODEL_ROLES` registry instead of hardcoded strings
- Refactored model role system to use centralized `MODEL_ROLES` registry with consistent tag, name, and color definitions
- Simplified model role resolution to use `MODEL_ROLE_IDS` array instead of hardcoded role checks
- Updated model selector to dynamically generate menu actions from `MODEL_ROLES` registry

### Removed

- Removed support for `omp/` model role prefix; use `pi/` prefix instead

## [10.6.0] - 2026-02-04

### Breaking Changes

- Removed `output_mode` parameter from grep tool—results now always use content mode with formatted match output
- Renamed grep context parameters from `context_pre`/`context_post` to `pre`/`post`
- Removed `n` (show line numbers) parameter—line numbers are now always displayed in grep results

### Added

- Added Jina as a web search provider option alongside Exa, Perplexity, and Anthropic
- Added support for Jina Reader API integration with automatic provider detection when JINA_API_KEY is configured

### Changed

- Reformatted grep output to display matches grouped by file with numbered match headers and aligned context lines
- Updated grep output to use `>>` prefix for match lines and aligned spacing for context lines for improved readability
- Changed multiline matching to automatically enable when pattern contains literal newlines (`
`)
- Split grep context parameter into separate `context_pre` and `context_post` options for independent control of lines before and after matches
- Updated grep tool to use configurable default context settings from `grep.contextBefore` and `grep.contextAfter` configuration
- Added configurable grep context defaults and reduced the default to 1 line before, 3 lines after
- Enabled the browser tool by default

### Removed

- Removed `filesWithMatches` and `count` output modes from grep tool

## [10.5.0] - 2026-02-04

### Breaking Changes

- Changed `ask` tool to require `questions` array parameter; single-question mode with `question`, `options`, `multi`, and `recommended` parameters is no longer supported
- Removed support for local Python kernel gateway startup; shared gateway is now required

### Added

- Added browser tool powered by Ulixee Hero with support for navigation, DOM interaction, screenshots, and readable content extraction
- Added `/browser` command to toggle browser headless vs visible mode in interactive sessions
- Added `browser.enabled` and `browser.headless` settings to control browser automation behavior
- Added Python prelude caching to improve startup performance by storing compiled prelude helpers and module metadata
- Added `OMP_DEBUG_STARTUP` environment variable for conditional startup performance debugging output
- Added autonomous memory system with storage, memory tools, and context injection

### Changed

- Updated task tool guidance to enforce small, well-defined task scope with maximum 3-5 files per task to prevent timeouts and improve parallel execution
- Updated browser viewport to use 1.25x device scale factor for improved rendering on high-DPI displays
- Modified device pixel ratio detection to respect actual screen capabilities instead of forcing 1x ratio
- Updated system prompt guidance to state assumptions and proceed without asking for confirmation, reducing unnecessary round-trips
- Tightened `ask` tool conditions to require multiple approaches with significantly different tradeoffs before prompting user
- Strengthened `ask` tool guidance to default to action and only ask when genuinely blocked by decisions with materially different outcomes
- Changed refactor workflow to automatically remove now-unused elements and note removals instead of asking for confirmation
- Enforced exclusive concurrency mode for all file-modifying tools (edit, write, bash, python, ssh, todo-write) to prevent concurrent execution conflicts
- Updated `ask` tool guidance to prioritize proactive problem-solving and default to action, asking only when truly blocked by decisions that materially change scope or behavior
- Changed Python kernel initialization to require shared gateway mode; local gateway startup has been removed
- Changed shared gateway error handling to retry on server errors (5xx status codes) before failing

### Fixed

- Fixed glob search returning no results when all files are ignored by gitignore by automatically retrying without gitignore filtering

## [10.3.2] - 2026-02-03

### Added

- Added `renderCall` and `renderResult` methods to MCP tools for structured TUI display of tool calls and results
- Added new `mcp/render.ts` module providing JSON tree rendering for MCP tool output with collapsible/expandable views

### Changed

- Updated `renderResult` signature in custom tools and extensions to accept optional `args` parameter for context-aware rendering
- Changed environment variable from `ENV_AGENT_DIR` constant to hardcoded `OMP_CODING_AGENT_DIR` string in config and CLI help text
- Fixed method binding in extension and hook tool wrappers to preserve `this` context for `renderCall` and `renderResult` methods

## [10.3.1] - 2026-02-03

### Fixed

- Fixed timeout handling in LSP write-through operations to properly clear formatter and diagnostics results when operations exceed the 10-second timeout

## [10.3.0] - 2026-02-03

### Removed

- Removed `shellForceBasic` setting that forced bash/sh shell selection
- Removed `bash.persistentShell` experimental setting for shell session reuse

## [10.2.3] - 2026-02-02

### Added

- Added `find.enabled`, `grep.enabled`, `ls.enabled`, `notebook.enabled`, `fetch.enabled`, `web_search.enabled`, `lsp.enabled`, and `calc.enabled` settings to control availability of individual tools
- Added conditional tool documentation in system prompt that dynamically lists only enabled specialized tools
- Added `todos.enabled` setting to control availability of the todo_write tool for task tracking
- Added `tools` field to agent frontmatter for declaring agent-specific tool capabilities

### Changed

- Consolidated `symbols` action to handle both file-based document symbols and workspace symbol search (query-based)
- Consolidated `diagnostics` action to handle both single-file and workspace-wide diagnostics (no file = workspace)
- Simplified `reload` action to gracefully reload language server with fallback to kill
- Updated LSP tool documentation to reflect simplified operation set and consolidated actions
- Reorganized settings tabs from 8 to 9 tabs with clearer categorization: Display, Agent, Input, Tools, Config, Services, Bash, LSP, and TTSR
- Moved behavior-related settings to new Agent tab for better organization
- Moved input/interaction settings to new Input tab
- Moved tool configuration settings to new Config tab
- Moved provider and service settings to new Services tab
- Added visual icons to settings tabs using theme symbols for improved UI clarity
- Changed default settings tab from Behavior to Display on startup
- Updated `read` tool to handle directory paths by returning formatted listings with modification times instead of redirecting to `ls`
- Updated tool documentation to reflect that `read` now handles both files and directories
- Updated system prompt tool precedence section to conditionally display only available specialized tools based on enabled settings
- Renamed todo completion settings from `todoCompletion.*` to `todos.reminders.*` and `todos.enabled` for clearer organization
- Updated todo reminder logic to check both `todos.reminders` and `todos.enabled` settings independently

### Removed

- Removed Rust-analyzer specific LSP operations: `flycheck`, `expand_macro`, `ssr`, `runnables`, `related_tests`, and `reload_workspace`
- Removed `workspace_diagnostics` action; use `diagnostics` without file parameter instead
- Removed `workspace_symbols` action; use `symbols` with query parameter and no file instead
- Removed `actions`, `incoming_calls`, and `outgoing_calls` LSP operations
- Removed `replacement`, `kind`, `action_index`, `end_line`, and `end_character` parameters from LSP tool
- Removed Python prelude helper functions: `pwd()`, `mkdir()`, `ls()`, `head()`, `tail()`, `sh()`, `cat()`, `touch()`, `wc()`, `basenames()`, and `batch()`
- Removed type guard functions (`isBashToolResult`, `isReadToolResult`, `isEditToolResult`, `isWriteToolResult`, `isGrepToolResult`, `isFindToolResult`, `isLsToolResult`) from public API exports
- Removed `ls` tool—directory listing is now handled by the `read` tool
- Removed `ls.enabled` setting and related configuration options
- Removed `bashInterceptor.simpleLs` setting that redirected simple `ls` commands to the dedicated tool
- Removed project tree snapshot generation from system prompt (unused feature)

### Fixed

- Fixed tool parameter schemas displaying internal TypeBox metadata fields in system prompt

## [10.2.1] - 2026-02-02

### Breaking Changes

- Removed `strippedRedirect` field from `NormalizedCommand` interface returned by `normalizeBashCommand()`
- Removed automatic stripping of `2>&1` stderr redirections from bash command normalization

## [10.1.0] - 2026-02-01

### Added

- Added work scheduling profiler to debug menu for analyzing CPU scheduling patterns over the last 30 seconds
- Added support for work profile data in report bundles including folded stacks, summary, and flamegraph visualization

## [10.0.0] - 2026-02-01

### Added

- Added `shell` subcommand for interactive shell console testing with brush-core
- Added `--cwd` / `-C` option to set working directory for shell commands
- Added `--timeout` / `-t` option to configure per-command timeout in milliseconds
- Added `--no-snapshot` option to skip sourcing snapshot from user shell

### Fixed

- `find` now returns a single match when given a file path instead of failing with "not a directory"

## [9.8.0] - 2026-02-01

### Breaking Changes

- Removed persistent shell session support; bash execution now uses native bindings via brush-core for improved reliability

### Added

- Added `sessionKey` option to bash executor to isolate shell sessions per agent instance
- Added shell snapshot support for bash execution to preserve shell state across commands
- Added `onChunk` callback support for streaming command output in real-time

### Changed

- Refactored bash executor to queue output chunks asynchronously for improved reliability
- Updated bash executor to pass environment variables separately as `sessionEnv` to native bindings
- Migrated system information collection to use native bindings from brush-core instead of shell command execution
- Updated CPU information to report core count alongside model name
- Simplified OS version reporting to use Node.js built-in APIs
- Migrated bash command execution from ptree-based persistent sessions to native shell bindings with streaming support
- Simplified bash executor to use brush-core native API instead of managing long-lived shell processes
- Routed clipboard copy and image paste through native arboard bindings instead of shell commands
- Embedded native addon payload for compiled binaries and extract to `~/.omp/natives/<version>` on first run

### Removed

- Removed shell configuration from environment information display
- Removed `shell-session.ts` module providing persistent shell session management
- Removed shell session test suite for persistent execution patterns

## [9.6.2] - 2026-02-01

### Changed

- Replaced hardcoded ellipsis strings with Unicode ellipsis character (…) throughout rendering code
- Removed `format.ellipsis` symbol from theme configuration; ellipsis now uses literal Unicode character
- Updated `truncate()` function to `truncateToWidth()` with simplified API accepting default ellipsis parameter
- Simplified `formatMoreItems()` function signature by removing theme parameter dependency

### Removed

- Removed `format.ellipsis` symbol key from theme symbol maps (Unicode, Nerd, and ASCII presets)
- Removed `ellipsis` property from `SymbolTheme` type

## [9.6.1] - 2026-02-01

### Fixed

- Fixed output handling to prioritize text/markdown over text/plain when both are available, ensuring Markdown content is displayed correctly
- Fixed bash command normalization to preserve newlines in heredocs and multiline commands

## [9.6.0] - 2026-02-01

### Breaking Changes

- Replaced `SettingsManager` class with new `Settings` singleton providing sync get/set API with background persistence
- Changed settings access from method calls (e.g., `getTheme()`) to path-based access (e.g., `settings.get("theme")`)
- Removed `settingsManager` parameter from `CreateAgentSessionOptions` in favor of `settingsInstance`
- Removed `loadSettings()` export from public API
- Removed example file `examples/sdk/10-settings.ts` demonstrating old SettingsManager API

### Added

- New `Settings` singleton class with sync get/set operations and background persistence
- Added `Settings.isolated()` factory for creating isolated settings instances in tests
- Added `Settings.init()` for initializing global settings instance
- Added `settings` global export for convenient access to settings singleton
- New `settings-schema.ts` providing unified, type-safe settings definitions with UI metadata
- Added "none" option to `doubleEscapeAction` setting to disable double-escape behavior entirely ([#973](https://github.com/badlogic/pi-mono/issues/973) by [@juanibiapina](https://github.com/juanibiapina))

### Changed

- Unified settings schema into single source of truth with `settings-schema.ts` replacing scattered definitions
- Refactored settings CLI to use new schema-based path resolution instead of SETTINGS_DEFS
- Updated config command examples to use new nested path syntax (e.g., `compaction.enabled` instead of `autoCompact`)
- Changed `InteractiveModeContext.settingsManager` to `InteractiveModeContext.settings`
- Updated all internal settings access throughout codebase to use new `settings.get()` and `settings.set()` API
- Moved `DEFAULT_BASH_INTERCEPTOR_RULES` from settings-manager to bash-interceptor module

### Removed

- Deleted `settings-manager.ts` (2035 lines) - functionality replaced by new Settings singleton
- Removed `SettingsManager.create()`, `SettingsManager.acquire()`, and `SettingsManager.inMemory()` factory methods
- Removed individual getter/setter methods from settings API (e.g., `getTheme()`, `setTheme()`, `getCompactionSettings()`)

### Fixed

- Respect .gitignore, .ignore, and .fdignore files when scanning package resources for skills, prompts, themes, and extensions

## [9.5.1] - 2026-02-01

### Changed

- Changed persistent shell from opt-out to opt-in (default: off) for improved reliability; enable via Settings > Bash > Persistent shell or `OMP_SHELL_PERSIST=1`
- Added new "Bash" settings tab grouping shell-related settings (force basic shell, persistent shell, interceptor, intercept ls)

## [9.5.0] - 2026-02-01

### Added

- Added `head` and `tail` parameters to bash tool to limit output lines without breaking streaming
- Added automatic normalization of bash commands to extract `| head -n N` and `| tail -n N` patterns into native parameters
- Added `maxResults` parameter to find tool to limit result set at the native layer
- Added context-structure template showing required sections (Goal, Constraints, Existing Code, API Contract) with examples of good vs bad context
- Added explicit dependency test: 'Can agent B write correct code without seeing agent A's output?' to determine sequencing
- Added detailed phased execution pattern with four phases (Foundation, Parallel Implementation, Integration, Dependent Layer) and WASM-to-N-API migration example
- Added table of dependency patterns that must be sequential (API creation before bindings, interface definition before implementation, etc.)
- Added phased execution guidance for migrations and refactors to prevent parallel work on dependent layers
- Added example demonstrating phased execution pattern for porting WASM to N-API with sequential foundation, parallel implementation, integration, and dependent layer phases

### Changed

- Improved find tool performance by delegating mtime-based sorting to native layer instead of post-processing results in JavaScript
- Simplified find tool result processing by removing redundant filesystem stat calls when native metadata is available
- Updated bash tool documentation to recommend using `head` and `tail` parameters instead of piping through head/tail commands
- Updated binary build process to exclude worker files from compilation, reducing binary size
- Modified update mechanism to download and install native addon alongside CLI binary for platform-specific functionality
- Updated find tool to emit streaming match updates via callback, allowing real-time progress feedback during file searches
- Modified find tool to use native match metadata (mtime, fileType) from WASM layer instead of redundant filesystem stats, improving performance
- Restructured Task tool documentation to emphasize context quality and explicit API contracts for subagent success
- Updated task execution guidance to require structured context with Goal, Constraints, Existing Code, and API Contract sections
- Reorganized parallelization rules with explicit dependency patterns and phased execution guidance for migrations
- Clarified that response format requirements must go in schema parameter, never in context descriptions
- Centralized Python runtime resolution into shared `ipy/runtime.ts` module, removing duplicate code from kernel and gateway coordinator

### Removed

- Removed Nushell language server configuration from LSP defaults

### Fixed

- Fixed race condition in shell session where command completion could occur before stream data was fully processed
- Fixed Python gateway spawning console window on Windows by using windowless Python interpreter (pythonw.exe)

## [9.4.0] - 2026-01-31

### Changed

- Migrated environment variable handling to use centralized `getEnv()` and `getEnvApiKey()` utilities from pi-ai package for consistent API key resolution across web search providers and image tools
- Simplified web search error messages to remove provider-specific configuration hints
- Replaced manual space padding with `padding()` utility function from pi-tui across UI components for consistent whitespace handling
- Improved rendering performance for Python cell output by implementing caching in the table and cell results renderers
- Updated task tool documentation to clarify that subagents can access parent conversation context via a searchable file, reducing need to repeat information in context parameter
- Updated plan mode prompt to guide model toward using `edit` tool for incremental plan updates instead of defaulting to `write`

### Removed

- Removed environment variable denylist that blocked API keys from being passed to subprocesses; API keys are now controlled via allowlist only

## [9.3.1] - 2026-01-31

### Added

- Added `getCompactContext()` API to retrieve parent conversation context for subagents, excluding system prompts and tool results
- Added automatic `submit_result` tool injection for subagents with explicit tool lists
- Added `contextFile` parameter to pass parent conversation context to subagent sessions

### Changed

- Updated subagent system prompt to reference parent conversation context file when available
- Enhanced subagent system prompt formatting with clearer backtick notation for tool and parameter names

### Removed

- Removed schema override notification from task summary prompt

## [9.2.5] - 2026-01-31

### Changed

- Clarified that user instructions about delegation override tool-use defaults
- Updated coordinator guidance to emphasize Task tool preference for substantial work with improved emphasis on context window limitations
- Enhanced `context` parameter documentation to require self-contained information for subagents, including file contents and user requirements

## [9.2.4] - 2026-01-31

### Fixed

- Prevented interactive commands from blocking on stdin by redirecting from /dev/null in POSIX and Fish shell sessions

## [9.2.3] - 2026-01-31

### Added

- Persistent shell session support for bash tool with environment variable preservation across commands
- New `shellForceBasic` setting to force bash/sh even if user's default shell is different (default: true)
- New `OMP_SHELL_PERSIST` environment variable to control persistent shell behavior (set to 0 to disable)

### Changed

- Bash tool now reuses a persistent shell session by default on Unix systems for improved performance and state preservation
- Replaced Bun file APIs with Node.js `fs` module for better cross-runtime compatibility
- LSP configuration loading is now synchronous instead of async
- Shell snapshot generation now sanitizes `BASH_ENV` and `ENV` variables to prevent shell exit issues
- Shell snapshot caching now per-shell-binary instead of global to avoid cross-shell contamination
- System prompt restructured with coordinator-specific guidance for parallel task delegation
- Bash tool now reuses a persistent shell session by default on Unix. Set `OMP_SHELL_PERSIST=0` to disable or fall back to per-command execution on Windows/unsupported shells.
- Added a shellForceBasic setting to force bash/sh and keep environment changes across bash commands (default: true).

### Fixed

- Shell snapshots now filter unsafe bash options (onecmd, monitor, restricted) to prevent session exits
- Git branch detection in status line now works synchronously without race conditions
- Shell session initialization properly restores trap handlers and shell functions after command execution
- Sanitized `BASH_ENV`/`ENV` during persistent shell startup and snapshot creation to prevent basic shells from exiting immediately.
- Cached shell snapshots per shell binary to avoid sourcing zsh snapshots in bash sessions.
- Filtered unsafe bash options (onecmd/monitor/restricted) out of shell snapshots to prevent session exits.

## [9.2.2] - 2026-01-31

### Added

- Added grep CLI subcommand (`omp grep`) for testing pattern matching
- Added fuzzy matching for model resolution with scoring and ranking fallback
- Added 'Open: artifact folder' menu option to debug selector for quick access to session artifacts
- Added Kimi API format setting for selecting between OpenAI and Anthropic formats
- Added Codex and Gemini web search providers with OAuth and grounding support
- Added /debug command with interactive menu for profiling, heap snapshots, session dumps, and diagnostics
- Added configurable ask timeout and notification settings
- Added gitignore-aware project tree scanning with ripgrep integration
- Added project tree visualization to system prompts with configurable depth and entry limits
- Added reset() method to CountdownTimer with integration into HookSelectorComponent
- Added custom message support to AgentSession via promptCustomMessage() method
- Added skill message component for rendering /skill command messages as compact entries
- Added model preference matching system for intelligent model selection based on usage history
- Added designer agent with UI/UX review and accessibility audit capabilities
- Added model-specific edit variant configuration for patch/replace modes
- Added automatic browser opening when stats dashboard starts
- Added model statistics table and TTFT/throughput metrics to stats dashboard
- Added artifact allocation for truncated fetch responses to preserve full content
- Added 30-second timeout to ask tool with auto-selection of recommended option
- Added recommended parameter (0-indexed) to ask tool for specifying default option
- Added JTD to TypeScript converter for rendering schemas in system prompts
- Added tools list to system prompt for better agent awareness
- Added synthetic message flag for system-injected prompts
- Added session compaction enhancements with auto-continue, tool pruning, and remote endpoint support
- Added detection and rendering of missing complete tool warning in subagent output
- Added outline UI components for bordered list containers
- Added macOS NFD normalization and curly quote variant resolution for file paths
- Enhanced session compaction with dynamic token ratio adjustment and improved summary preservation

### Changed

- Simplified find tool API by consolidating path and pattern parameters
- Replaced bulk file loading with streaming for read tool to reduce memory overhead
- Migrated grep and find tools to WASM-based implementation
- Replaced ripgrep-based file listing with glob-based file discovery for project scans
- Updated minimum Bun runtime requirement to >=1.3.7
- Renamed task parameter from output to schema
- Renamed complete tool to submit_result for clarity and consistency
- Improved output preview logic: shows full output for ≤30 lines, truncates to 10 lines for larger output

### Fixed

- Enhanced error reporting with debug stack trace when DEBUG env is set
- Improved OAuth token refresh error handling to distinguish transient vs definitive failures
- Added windowsHide option to child process spawn calls to prevent console windows on Windows
- External edits to config.yml are now preserved when omp reloads or saves settings
- Exposed LSP server startup errors in session display and logs
- Improved error handling and security in agent storage initialization with restrictive file permissions
- Fixed LSP server display showing unknown when server warmup fails
- Preserved null timeout when user disables ask timeout setting
- Removed incorrect timeout unit conversion logic in cursor, fetch, gemini-image, and ssh tools
- Blocked /fork command while streaming to prevent split session logs

## [9.0.0] - 2026-01-29

### Fixed

- External edits to `config.yml` are now preserved when omp reloads or saves unrelated settings. Previously, editing config.yml directly (e.g., removing a package from `packages` array) would be silently reverted on next omp startup when automatic setters like `setLastChangelogVersion()` triggered a save. ([#1046](https://github.com/badlogic/pi-mono/pull/1046) by [@nicobailonMD](https://github.com/nicobailonMD))

## [8.13.0] - 2026-01-29

### Added

- Added `/debug` command with interactive menu for bug report generation:
  - `Report: performance issue` - CPU profiling with reproduction flow
  - `Report: dump session` - Immediate session bundle creation
  - `Report: memory issue` - Heap snapshot with bundle
  - `View: recent logs` - Display last 50 log entries
  - `View: system info` - Show environment details
  - `Clear: artifact cache` - Remove old session artifacts

### Fixed

- Fixed LSP server errors not being visible in `/session` output or logs when startup fails

## [8.12.7] - 2026-01-29

### Fixed

- Fixed LSP servers showing as "unknown" in status display when server warmup fails
- Fixed Read tool loading entire file into memory when offset/limit was specified

## [8.12.2] - 2026-01-28

### Changed

- Replaced ripgrep-based file listing with fs.glob for project scans and find/read tooling

## [8.11.14] - 2026-01-28

### Changed

- Rendered /skill command messages as compact skill entries instead of full prompt text

## [8.8.8] - 2026-01-28

### Added

- Added `/fork` command to create a new session with the exact same state (entries and artifacts) as the current session

### Changed

- Renamed the `complete` tool to `submit_result` for subagent result submission

## [8.6.0] - 2026-01-27

### Added

- Added `plan` model role for specifying the model used by the plan agent
- Added `--plan` CLI flag and `OMP_PLAN_MODEL` environment variable for ephemeral plan model override
- Added plan model selection in model selector UI with PLAN badge

### Changed

- Task tool subagents now execute in-process instead of using worker threads

### Fixed

- Queued skill commands as follow-ups when the agent is already streaming to avoid load failures
- Deduplicated repeated review findings in subagent progress rendering
- Restored MCP proxy tool timeout handling to prevent subagent hangs

## [8.5.0] - 2026-01-27

### Added

- Added subagent support for preloading skill contents into the system prompt instead of listing available skills
- Added session init entries to capture system prompt, task, tools, and output schema for subagent session logs

### Fixed

- Reduced Task tool progress update overhead to keep the UI responsive during high-volume streaming output
- Fixed subagent session logs dropping pre-assistant entries (user/task metadata) before the first assistant response

### Removed

- Removed enter-plan-mode tool

## [8.4.5] - 2026-01-26

### Added

- Model usage tracking to record and retrieve most recently used models
- Model sorting in selector based on usage history

### Changed

- Renamed `head_limit` parameter to `limit` in grep and find tools for consistency
- Added `context` as an alias for the `c` context parameter in grep tool
- Made hidden files inclusion configurable in find tool via `hidden` parameter (defaults to true)
- Added support for reading ignore patterns from .gitignore and .ignore files in find tool

### Fixed

- Respected .gitignore rules when filtering find tool results by glob pattern

## [8.4.2] - 2026-01-25

### Changed

- Clarified and condensed plan mode prompts for improved clarity and consistency

## [8.4.1] - 2026-01-25

### Added

- Added core plan mode with plan file approval workflow and tool gating
- Added plan:// internal URLs for plan file access and subagent plan-mode system prompt
- Added plan mode toggle shortcut with paused status indicator

### Fixed

- Fixed plan reference injection and workflow prompt parameters for plan mode
- Fixed tool downloads hanging on slow/blocked GitHub by adding timeouts and zip extraction fallback
- Fixed missing UI notification when tools are downloaded or installed on demand

## [8.4.0] - 2026-01-25

### Added

- Added extension API to set working/loading messages during streaming
- Added task worker propagation of context files, skills, and prompt templates
- Added subagent option to skip Python preflight checks when Python tooling is unused
- Model field now accepts string arrays for fallback model prioritization

### Changed

- Merged patch application warnings into edit tool diagnostics output
- Cached Python prelude docs for subagent workers to avoid repeated warmups
- Simplified image placeholders inserted on paste to match Claude-style markers

### Fixed

- Rewrote empty or corrupted session files to restore valid headers
- Improved patch applicator ambiguity errors with match previews and overlap detection
- Fixed Task tool agent model resolution to honor comma-separated model lists

## [8.3.0] - 2026-01-25

### Changed

- Added request parameter tracking to LSP tool rendering for better diagnostics visibility
- Added async diff computation and Kitty protocol support to tool execution rendering
- Refactored patch applicator with improved fuzzy matching (7-pass sequence matching with Levenshtein distance) and indentation adjustment
- Added inline rendering flag to bash and fetch tool renderers
- Extracted constants for preview formatting to improve code maintainability
- Exposed mergeCallAndResult and inline rendering options from tools to their wrappers
- Added timeout validation and normalization for tool timeout parameters

### Fixed

- Fixed output block border rendering (bottom-right corner was missing)
- Added background control parameter to output block rendering

## [8.2.2] - 2026-01-24

### Removed

- Removed git utility functions (\_git, git_status, git_diff, git_log, git_show, git_file_at, git_branch, git_has_changes) from IPython prelude

## [8.2.0] - 2026-01-24

### Added

- Added `omp commit` command to generate conventional commits with changelog updates
- Added agentic commit mode with commit-specific tools and `--legacy` fallback
- Added configurable settings for map-reduce analysis including concurrency, timeout, file thresholds, and token limits
- Added support for excluding YAML lock files (`.lock.yml`, `.lock.yaml`, `-lock.yml`, `-lock.yaml`) from commit analysis
- Added new TUI component library with reusable rendering utilities including code cells, file lists, tree lists, status lines, and output blocks
- Added renderCodeCell component for displaying code with optional output sections, supporting syntax highlighting and status indicators
- Added renderFileList component for rendering file/directory listings with language icons and metadata
- Added renderTreeList component for hierarchical tree-based item rendering with expand/collapse support
- Added renderStatusLine component for standardized tool status headers with icons, descriptions, and metadata
- Added renderOutputBlock component for bordered output containers with structured sections
- Added renderOutputBlock to Bash tool for improved output formatting with status indicators
- Added `--legacy` flag to `omp commit` for using the deterministic pipeline instead of agentic mode
- Added split commit support to automatically create multiple atomic commits for unrelated changes
- Added git hunk inspection tools for fine-grained diff analysis in commit generation
- Added commit message validation with filler word and meta phrase detection
- Added automatic unicode normalization in commit summaries
- Added real-time progress output to agentic commit mode showing thinking status, tool calls, and completion summary
- Added hunk-level staging support in split commits allowing partial file changes per commit
- Added dependency ordering for split commits ensuring commits are applied in correct sequence
- Added circular dependency detection with validation errors for split commit plans
- Added parallel file analysis with cross-file context awareness via `analyze_files` tool
- Added AGENTS.md context file discovery for commit generation
- Added progress indicators during changelog generation and model resolution
- Added propose_changelog tool for agent-provided changelog entries in agentic commit workflow
- Added fallback commit generation when agentic mode fails, using file pattern analysis and heuristic-based type inference
- Added trivial change detection to automatically classify whitespace-only and import-reorganization commits
- Added support for pre-computed file observations in commit agent to skip redundant analyze_files calls
- Added diff content caching with smart file prioritization to optimize token usage in large changesets
- Added lock file filtering (17 patterns including Cargo.lock, package-lock.json, bun.lock) from commit analysis
- Added changelog deletion support to remove outdated entries via the changelog proposal interface
- Added support for pre-computed changelog entries in commit agent to display existing unreleased sections for potential deletion
- Added `ExistingChangelogEntries` interface to track changelog sections by path for changelog proposal context
- Added conditional `analyze_files` skipping in commit agent when pre-analyzed observations are provided
- Added guidance to commit agent prompts instructing subagents to write files directly instead of returning changes for manual application
- Added mermaid diagram rendering with terminal graphics support (Kitty/iTerm2) for markdown output
- Added renderMermaidToPng utility for converting mermaid code blocks to terminal-displayable PNG images via mmdc CLI
- Added mermaid block extraction with content-addressed hashing for deduplication and cache lookup
- Added background mermaid pre-rendering in assistant messages for responsive diagram display
- Added two-level mermaid caching with pending deduplication to prevent redundant renders
- Added Python kernel session pooling with MAX_KERNEL_SESSIONS limit and automatic eviction of oldest sessions
- Added automatic idle kernel session cleanup timer (5-minute timeout, 30-second interval)
- Added types/assets/index.d.ts for global TypeScript module declarations supporting `.md`, `.py`, and `.wasm?raw` imports
- Added bunfig.toml loader configuration for importing markdown, Python, and WASM files as text modules
- Added color manipulation utilities (hexToHsv, hsvToHex, shiftHue) to pi-utils for accessible theme adjustments
- Added color-blind mode setting for improved accessibility
- Added filesystem error type guards (isEnoent, isEacces, isPerm, isEnotempty, isFsError, hasFsCode) to pi-utils for safe error handling
- Added tarball installation test Dockerfile to validate npm publish/install flow

### Changed

- Changed changelog diff truncation limit to be configurable via settings
- Changed tool result rendering to use new TUI component library across multiple tools (bash, calculator, fetch, find, grep, ls, notebook, python, read, ssh, write, lsp, web search) for consistent output formatting
- Changed Bash tool output rendering to use renderOutputBlock with proper section handling and width-aware truncation
- Changed Python tool output rendering to use renderCodeCell component for code cell display with status indicators
- Changed Read tool output rendering to use renderCodeCell with syntax highlighting and warnings display
- Changed Write tool output rendering to use renderCodeCell for code display with streaming preview support
- Changed Fetch tool output rendering to use renderOutputBlock with metadata and content preview sections
- Changed LSP tool output rendering to use renderStatusLine and renderOutputBlock for structured output display
- Changed Web Search result rendering to use renderOutputBlock with answer, sources, related questions, and metadata sections
- Changed Find, Grep, and Ls tools to use renderFileList and renderTreeList for consistent file/item listing
- Changed Calculator tool result rendering to use renderTreeList for result item display
- Changed Notebook and TodoWrite tools to use new TUI rendering components for consistent output format
- Refactored render-utils to move tree-related utilities to TUI module (getTreeBranch, getTreeContinuePrefix)
- Changed import organization in sdk.ts for consistency
- Changed tool result rendering to merge call and result displays, showing tool arguments (command, pattern, query, path) in result headers for Bash, Calculator, Fetch, Find, Grep, Ls, LSP, Notebook, Read, SSH, TodoWrite, Web Search, and Write tools
- Changed Read tool title to display line range when offset or limit arguments are provided
- Changed worker instantiation to use direct URL import instead of pre-bundled worker files
- Changed `omp commit` to use agentic mode by default with tool-based git inspection
- Changed agentic commit progress output to show real-time thinking previews and structured tool argument details
- Changed agentic commit progress output to display full multi-line assistant messages and render tool arguments with tree-style formatting for improved readability
- Changed agentic commit progress output to render assistant messages as formatted Markdown with proper word wrapping
- Changed output block border color to reflect state (error, success, warning) for improved visual feedback
- Changed LSP hover rendering to display documentation text before code blocks in both collapsed and expanded views
- Changed Write tool to show streaming preview of content being written with syntax highlighting
- Changed Read tool to display resolved path information when reading from URLs or symlinks
- Changed Calculator tool result display to show both expression and output (e.g., `2+2 = 4`) instead of just the result
- Changed Python tool output to group status information under a labeled section for clearer organization
- Changed SSH tool output to apply consistent styling to non-ANSI output lines
- Changed Todo Write tool to respect expanded/collapsed state and use standard preview limits
- Changed Web Search related questions to respect expanded/collapsed state instead of always showing all items
- Changed empty and error state rendering across multiple tools (Find, Grep, Ls, Notebook, Calculator, Ask) to include consistent status headers
- Changed split commit to support hunk selectors (all, indices, or line ranges) instead of whole-file staging
- Changed `analyze_file` tool to `analyze_files` for batch parallel analysis of multiple files
- Switched agentic commit from auto-generated changelogs to agent-proposed entries with validation and retry logic
- Commit agent now resolves a separate smaller model for commit generation instead of reusing the primary model
- Normalized code formatting and indentation across tool renderers and UI components
- Changed git-file-diff tool to prioritize files by type and respect token budget limits with intelligent truncation
- Changed git-overview tool to filter and report excluded lock files separately from staged files
- Changed analyze-file tool to include file type inference and enriched related files with line counts
- Changed propose-changelog tool to support optional deletion entries for removing existing changelog items
- Changed commit agent to accept pre-computed file observations and format them into session prompts
- Changed changelog skip condition in `applyChangelogProposals` to also check for empty deletions object
- Changed `createCommitTools()` to build tools array incrementally with conditional `analyze_files` inclusion based on `enableAnalyzeFiles` flag
- Changed system prompt guidance to clarify that pre-computed observations prevent redundant `analyze_files` calls
- Removed map-reduce preprocessing phase from commit agent for faster iteration
- Changed commit agent to process full diff text directly instead of pre-computed file observations
- Changed commit agent initialization to load settingsManager, authStorage, modelRegistry, and stagedFiles in parallel
- Changed commit agent prompt to remove pre-computed observations guidance and encourage direct analyze_files usage
- Changed AuthStorage from constructor-based instantiation to async factory method (AuthStorage.create())
- Changed Python kernel resource management with gateway shutdown on session disposal
- Updated TypeScript configuration for better publish-time configuration handling with tsconfig.publish.json
- Updated TypeScript and Bun configuration for monorepo-wide build consistency and reduced boilerplate
- Removed WASM base64 encoding build script; imports now use Bun loader with `wasm?raw` query parameter
- Unified TypeScript checking pipeline with tsgo-based configuration instead of per-package tsconfig.publish.json boilerplate
- Refactored scanDirectoryForSkills to use async/await with concurrent directory scanning via Promise.all
- Improved error logging in settings manager for config file access failures
- Migrated node module imports from named to namespace imports across all packages for consistency with project guidelines
- Improved filesystem error handling in extension loader with additional type guards (isEacces, hasFsCode) for permission and EPERM errors
- Changed model discovery to synchronous file operations for more immediate initialization

### Fixed

- Fixed database busy errors during concurrent access by adding retry logic with exponential backoff when opening storage
- Find tool now rejects searches from root directory and enforces a 5-second timeout on fd operations
- Commit command now exits cleanly with exit code 0 on success
- Handle undefined code parameter in code cell renderer
- Fixed indentation formatting in split-commit tool function signature
- Fixed changelog application to process proposals containing only deletion entries without additions
- Fixed indentation formatting in Python tool output renderer
- Fixed Python kernel resource management with proper timing instrumentation for performance monitoring
- Fixed model discovery to re-check file existence after JSON to YAML migration
- Fixed branch change callbacks in footer component to properly update state after git resolution
- Added guard clause in plugin-settings to prevent null reference when settings list is undefined
- Fixed agent task discovery to support symlinks and improved error handling for file access failures

## [8.0.0] - 2026-01-23

### Added

- Added antigravity provider support for image generation with Google Cloud authentication
- Added support for google-antigravity API credentials in model registry
- Added antigravity-specific request handling with SSE streaming
- Added projectId parameter to antigravity credentials parsing
- Added antigravity provider to preferred image provider selection
- Added list-limit utility for consistent result limiting across tools
- Added output-utils module with tail buffer and artifact allocation helpers
- Added tool-result module for standardized tool result construction
- Added truncation summary options to OutputMetaBuilder for better output tracking
- Added artifact storage system for truncated tool outputs with artifact:// URL protocol
- Added structured output metadata system with fluent OutputMetaBuilder for consistent notices
- Added standardized tool error types (ToolError, MultiError, ToolAbortError) for better error handling
- Added internal URL routing system with protocol handlers:
- `agent://<id>` - access agent output artifacts
- `agent://<id>/<path>` and `agent://<id>?q=<query>` - JSON extraction from agent outputs
- `skill://<name>` and `skill://<name>/<path>` - read skill files and relative paths
- `rule://<name>` - read rule content
- URL resolution includes filesystem path in output for bash/python interop
- Added fetch tool for URL content retrieval with enhanced processing capabilities
- Added `isolated` option to task tool for git worktree execution with automatic patch generation and application
- Added format-prompts script to standardize prompt file formatting

### Changed

- Updated default line limit from 4000 to 3000 lines for output truncation
- Reordered truncation notice to show offset continuation before artifact reference
- Applied meta notice wrapper to all tools in createTools function
- Updated test expectations to reflect new 3000 line limit
- Removed output tool from schema validation test list
- Replaced inline output truncation notices with structured metadata system across all tools
- Updated bash, python, and ssh executors to track detailed output statistics (total lines/bytes vs output lines/bytes)
- Modified artifact storage to use pre-allocated paths instead of inline file writing
- Changed message format to use meta field instead of fullOutputPath for truncation information
- Updated interactive components to display truncation metadata from structured format
- Standardized tool result building with new ToolResultBuilder for consistent metadata handling
- Simplified Python gateway coordination by removing reference counting and client tracking
- Updated Python gateway to use global shared instance instead of per-process coordination
- Modified Python kernel initialization to set working directory and environment per kernel
- Updated interactive status display to show Python and venv paths instead of client count
- Changed system prompt to clarify CHECKPOINT step 0 timing
- Updated Python environment warming to use await instead of void for proper error handling
- Updated interactive mode shutdown to use postmortem.quit instead of process.exit
- Updated bash tool documentation to clarify specialized tool usage
- Updated task tool documentation to escape placeholder syntax in examples
- Updated Python environment warming to use await instead of void for proper error handling
- Updated interactive mode shutdown to use postmortem.quit instead of process.exit
- Updated bash tool documentation to clarify specialized tool usage
- Updated task tool documentation to escape placeholder syntax in examples
- Updated all tools to use structured metadata instead of inline notices for truncation, limits, and diagnostics
- Replaced manual error formatting with ToolError.render() and standardized error handling
- Enhanced bash and python executors to save full output as artifacts when truncated
- Improved abort signal handling across <caution>ith consistent ToolAbortError
- Renamed task parameter from `vars` to `args` throughout task tool interface and updated template rendering to support built-in `{{id}}` and `{{description}}` placeholders
- Simplified todo-write tool by removing active_form parameter, using single content field for task descriptions
- Updated system prompt structure with `<important>` and `<avoid>` tags, clearer critical sections, and standardized whitespace handling
- Renamed web_fetch tool to fetch and removed internal URL handling (use read tool instead)
- Standardized tool parameter names from camelCase to snake_case across edit, grep, python, and todo-write tools
- Unified timeout parameters across all tools with auto-conversion from milliseconds and reasonable clamping (1s-3600s for bash/ssh, 1s-600s for python/gemini-image)
- Simplified web-search tool by removing advanced parameters (`max_tokens`, `model`, `search_domain_filter`, `search_context_size`, `return_related_questions`) and using `recency` instead of `search_recency_filter`
- Restructured tool documentation with standardized `<instruction>`, `<output>`, `<critical>`, and `<avoid>` sections across all 18 tools
- Updated find tool to always sort results by modification time
- Updated bash prompt to use `cwd` parameter instead of `workdir`
- Improved output truncation limits: bash to 50KB/2000 lines, python to 100KB
- Removed model parameter from task and gemini-image tools to use session/provider defaults
- Improved MCP tool name handling with explicit server and tool name properties
- Marked read tool as non-abortable to improve performance
- Converted dynamic imports to static imports in installer and exa tools

### Removed

- Removed output tool (replaced by `agent://` URLs via read tool)
- Removed web_fetch tool (replaced by fetch tool)

### Fixed

- Fixed Python kernel environment initialization for external and shared gateways
- Fixed gateway status reporting to include Python and virtual environment paths
- Fixed inconsistent error formatting across tools by standardizing on ToolError types
- Fixed timeout parameter handling to auto-convert milliseconds to seconds and clamp to reasonable ranges
- Fixed whitespace formatting in json-query.ts comment
- Fixed interactive shutdown to await postmortem cleanup so Python kernel gateways are terminated
- Fixed shared Python gateway reuse across working directories by initializing kernel cwd and env per kernel
- Fixed Python gateway coordination to use a single global gateway without ref counting

## [7.0.0] - 2026-01-21

### Added

- Added usage report deduplication to prevent duplicate account entries
- Added debug logging for usage fetch operations to aid diagnostics
- Added provider sorting in usage display by total usage amount
- Added `isolated` parameter to task tool for running each task in separate git worktrees
- Added git worktree management for isolated task execution with patch generation
- Added patch application system that applies changes only when all patches are valid
- Added working directory information to environment info display
- Added `/usage` command to display provider usage and limits
- Added support for multiple usage providers beyond Codex
- Added usage report caching with configurable TTL
- Added visual usage bars and account aggregation in usage display
- Added `fetchUsageReports()` method to agent session
- Added `output()` function to read task/agent outputs by ID with support for multiple formats and queries
- Added session file support to Python executor for accessing task outputs
- Added support for jq-like queries when reading JSON outputs
- Added offset and limit parameters for reading specific line ranges from outputs
- Added "." and "c" shortcuts to continue agent without sending visible message
- Added debug logging for usage fetch results to aid /usage diagnostics

### Changed

- Updated discoverSkills function to return object with skills property
- Enhanced usage report merging to combine limits and metadata from duplicate accounts
- Improved OAuth credential handling to preserve existing fields when updating
- Removed cd function from Python prelude to encourage using cwd parameter
- Updated task tool to generate and apply patches when running in isolated mode
- Enhanced task tool rendering to display isolated execution status and patch paths
- Updated system prompt structure and formatting for better readability
- Reorganized tool hierarchy and discipline sections
- Added parallel work guidance for task-based workflows
- Enhanced verification and integration methodology sections
- Updated skills and rules formatting for cleaner presentation
- Added stronger emphasis on completeness and quality standards
- Refactored usage tracking from Codex-specific to generic provider system
- Updated usage limit detection to work with multiple provider APIs
- Changed usage cache to use persistent storage instead of in-memory only
- Limited diagnostic messages to 50 items to prevent overwhelming output when processing files with many issues
- Changed `/dump` command to include complete agent context: system prompt, model config, available tools with schemas, and all message types (bash/python executions, custom messages, branch summaries, compaction summaries, file mentions)
- Changed `/dump` format to use YAML instead of JSON for tool schemas and arguments (more readable)

### Fixed

- Fixed TypeScript error in bash executor by properly typing caught exception
- Fixed usage display ordering to show providers with lowest usage first
- Fixed task tool result rendering to show fallback text when no results are available
- Fixed external editor to work properly on Unix systems by correctly handling terminal I/O
- Fixed external editor to show warning message when it fails to open instead of silently failing
- Fixed find tool to properly handle no matches case without treating as error
- Fixed find tool to wait for fd exit so error messages no longer report exit null
- Fixed read tool to properly handle no matches case without treating as error
- Fixed orphaned Python kernel gateway processes not being killed on process exit
- Fixed /usage provider ordering to sort by aggregate usage (most used last)
- Fixed /usage account dedupe to collapse identical accounts using usage metadata

## [6.9.69] - 2026-01-21

### Added

- Added cell-by-cell status tracking with duration and exit code for Python execution
- Added syntax highlighting for Python code in execution display
- Added template system with {{placeholders}} for task tool context
- Added task variables support for filling context placeholders
- Added enhanced task progress display with variable values
- Added concurrent work handling guidance in system prompt
- Added extension system support for user Python execution events
- Added Python mode border color theming across all themes
- Added Python execution indicator to welcome screen help text
- Added `omp stats` command for viewing AI usage statistics dashboard
- Added support for JSON output and console summary of usage statistics
- Added configurable port option for stats dashboard server
- Added multi-cell Python execution with sequential processing in persistent kernel
- Added cell titles for better Python code organization and debugging
- Added `$` command prefix for user-initiated Python execution in shared kernel
- Added `$$` prefix variant for Python execution excluded from LLM context

### Changed

- Updated Python execution to display cells in bordered blocks with status indicators
- Changed task tool to use template-based context instead of simple concatenation
- Enhanced Python execution component with proper syntax highlighting
- Improved patch applicator to preserve exact indentation when intended
- Updated task tool schema to require vars instead of task field
- Updated Python execution component to use pythonMode theming instead of bashMode
- Enhanced UI helpers to handle pending Python components properly
- Changed Python tool to use `cells` array instead of single `code` parameter
- Renamed `workdir` parameter to `cwd` in Bash and Python tools for consistency
- Updated Python tool to display cell-by-cell output when multiple cells are provided

### Fixed

- Fixed indentation preservation for exact matches and indentation-only patches
- Fixed Python execution status updates to show real-time cell progress
- Fixed indentation adjustment logic to handle edge cases with mixed indentation levels
- Fixed patch indentation normalization for fuzzy matches, tab/space diffs, and ambiguous context alignment

## [6.9.0] - 2026-01-21

### Removed

- Removed Git tool and all related functionality
- Removed voice control and TTS features
- Removed worktree management system
- Removed bundled wt custom command
- Removed voice-related settings and configuration options
- Removed @oh-my-pi/pi-git-tool dependency

## [6.8.5] - 2026-01-21

### Breaking Changes

- Changed timeout parameter from seconds to milliseconds in Python tool
- Updated PythonExecutorOptions interface to use timeoutMs instead of timeout

### Changed

- Updated default timeout to 30000ms (30 seconds) for Python tool
- Improved streaming output handling and buffer management

## [6.8.4] - 2026-01-21

### Changed

- Updated output sink to properly handle large outputs
- Improved error message formatting in SSH executor
- Updated web fetch timeout bounds and conversion

### Fixed

- Fixed output truncation handling in streaming output
- Fixed timeout handling in web fetch tool
- Fixed async stream dumping in executors

## [6.8.3] - 2026-01-21

### Changed

- Updated keybinding system to normalize key IDs to lowercase
- Changed label edit shortcut from 'l' to 'Shift+L' in tree selector
- Changed output file extension from `.out.md` to `.md` for artifacts

### Removed

- Removed bundled worktree command from custom commands loader

### Fixed

- Fixed keybinding case sensitivity issues by normalizing all key IDs
- Fixed task artifact path handling and simplified file structure

## [6.8.2] - 2026-01-21

### Fixed

- Improved error messages when multiple text occurrences are found by showing line previews and context
- Enhanced patch application to better handle duplicate content in context lines
- Added occurrence previews to help users disambiguate between multiple matches
- Fixed cache invalidation for streaming edits to prevent stale data
- Fixed file existence check for prompt templates directory
- Fixed bash output streaming to prevent premature stream closure
- Fixed LSP client request handling when signal is already aborted
- Fixed git apply operations with stdin input handling

### Security

- Updated Anthropic authentication to handle manual code input securely

## [6.8.1] - 2026-01-20

### Fixed

- Fixed unhandled promise rejection when tool execution fails by adding missing `.catch()` to floating `.finally()` chain in `createAbortablePromise`

## [6.8.0] - 2026-01-20

### Added

- Added streaming abort setting to control edit tool behavior when patch preview fails

### Changed

- Replaced internal logger with @oh-my-pi/pi-utils logger across all modules
- Updated process spawning to use cspawn and ptree utilities from pi-utils
- Migrated file operations to use async fs/promises and Bun file APIs
- Refactored promise handling to use Promise.withResolvers and utility functions
- Updated timeout and abort handling to use standardized utility functions
- Refactored authentication login method to use OAuthController interface instead of individual callbacks

### Fixed

- Fixed Python package installation to handle async operations properly
- Fixed streaming output truncation to use consistent column limits
- Fixed shell command execution to properly handle process cleanup and timeouts
- Fixed SSH connection management to properly await async operations
- Fixed voice supervisor process cleanup to use proper async handling
- Added automatic regex pattern validation in grep tool to handle invalid patterns by switching to literal mode

### Security

- Updated temporary file cleanup to use secure async removal methods

## [6.7.67] - 2026-01-19

### Added

- Added normative rewrite setting to control tool call argument normalization in session history
- Added read line numbers setting to prepend line numbers to read tool output by default
- Added streaming preview for edit and write tools with spinner animation
- Added automatic anchor derivation for normative patches when anchors not specified

### Changed

- Enhanced edit and write tool renderers to show streaming content preview
- Updated read tool to respect default line numbers setting
- Improved normative patch anchor handling to support undefined anchors

## [6.7.0] - 2026-01-19

### Added

- Normative patch generation to canonicalize edit tool output with tool call argument rewriting for session history
- Patch matching fallback variants: trimmed context, collapsed duplicates, single-line reduction, comment-prefix normalization
- Extended anchor syntax: ellipsis placeholders, `top of file`/`start of file`, `@@ line N`, nested `@@` anchors, space-separated hierarchical contexts
- Relaxed fuzzy threshold fallback and unique substring acceptance for context matching
- Added `--no-title` flag to disable automatic session title generation
- Environment variables for edit tool configuration (OMP_EDIT_VARIANT, OMP_EDIT_FUZZY, OMP_EDIT_FUZZY_THRESHOLD)
- Configurable fuzzy matching threshold setting (0.85 lenient to 0.98 strict)
- Apply-patch mode for edit tool (`edit.patchMode` setting) with create, update, delete, and rename operations
- Added MCP tool caching for faster startup with cached tool definitions

### Changed

- Patch applicator now supports normalized input, implicit context lines, and improved indentation adjustment
- Patch operation schema uses 'op' instead of 'operation' and 'rename' instead of 'moveTo'
- Fuzzy matching tries comment-prefix normalized matches before unicode normalization
- Updated patch prompts with clearer anchor selection rules and verbatim context requirements
- Changed default behavior of read tool to omit line numbers by default
- Changed default edit tool mode to use apply-patch format instead of oldText/newText
- Converted tool implementations from factory functions to class-based architecture
- Refactored edit tool with modular patch architecture (moved from `edit/` to `patch/` module)
- Enhanced patch parsing: unified diff format, Codex-style patches, nested anchors, multi-file markers
- Improved fuzzy matching with multiple match tracking, ambiguity detection, and out-of-order hunk processing
- Better diff rendering: smarter truncation, optional line numbers, trailing newline preservation
- Improved error messages with hierarchical context display using `>` separator
- Centralized output sanitization in streaming-output module
- Enhanced MCP startup with deferred tool loading and cached fallback

### Fixed

- Patch application handles repeated context blocks, preserves original indentation on fuzzy match
- Ambiguous context matching resolves duplicates using adjacent @@ anchor positioning
- Patch parser handles bare \*\*\* terminators, model hallucination markers, line hint ranges
- Function context matching handles signatures with and without empty parentheses
- Fixed session title generation to respect OMP_NO_TITLE environment variable
- Fixed Python module discovery to use import.meta.dir for ES module compatibility
- Fixed LSP writethrough batching to flush when delete operations complete a batch
- Fixed line number validation, BOM detection, and trailing newline preservation in patches
- Fixed hierarchical context matching and space-separated anchor parsing
- Fixed fuzzy matching to avoid infinite loops when `allowFuzzy` is disabled
- Fixed tool completion logic to only mark tools as complete when streaming is not aborted or in error state
- Fixed MCP tool path formatting to correctly display provider information

## [6.2.0] - 2026-01-19

### Changed

- Improved LSP batching to coalesce formatting and diagnostics for parallel edits
- Updated edit and write tools to support batched LSP operations

### Fixed

- Coalesced LSP formatting/diagnostics for parallel edits so only the final write triggers LSP across touched files

## [6.1.0] - 2026-01-19

### Added

- Added lspmux integration for LSP server multiplexing to reduce startup time and memory usage
- Added LSP tool proxy support for subagent workers
- Updated LSP status command to show lspmux connection state
- Added maxdepth and mindepth parameters to find function for depth-controlled file search
- Added counter function to count occurrences and sort by frequency
- Added basenames function to extract base names from paths

### Changed

- Simplified rust-analyzer default configuration by removing custom initOptions and settings

## [6.0.0] - 2026-01-19

### Added

- Added Cursor and OpenAI Codex OAuth providers
- Added Windows installer bash shell auto-configuration
- Added dedicated TTSR settings tab (separated from Voice/TTS)

### Fixed

- Fixed TTSR abbreviation expansion from TTSR to Time Traveling Stream Rules

## [5.8.0] - 2026-01-19

### Changed

- Updated WASM loading to use streaming for development environments with base64 fallback
- Added scripts directory to published package files

## [5.7.68] - 2026-01-18

### Changed

- Updated WASM loading to use base64-encoded WASM for better compatibility with compiled binaries

### Fixed

- Fixed WASM loading issues in compiled binary builds

## [5.7.67] - 2026-01-18

### Changed

- Replaced external photon-node dependency with vendored WebAssembly implementation
- Updated image processing to use local photon library for better performance

## [5.6.70] - 2026-01-18

### Added

- Added support for loading Python prelude extension modules from user and project directories
- Added automatic discovery of Python modules from `.omp/modules` and `.pi/modules` directories
- Added prioritized module loading with project-level modules overriding user-level modules

## [5.6.7] - 2026-01-18

### Added

- Added Python shared gateway setting to enable resource-efficient kernel reuse across sessions
- Added Python tool cancellation support with proper timeout and cleanup handling
- Added enhanced Python prelude helpers including file operations, text processing, and Git utilities
- Added Python tool documentation rendering with categorized helper functions
- Added session-scoped Python kernel isolation with workdir-aware session IDs
- Added structured status events for Python prelude functions with TUI rendering
- Added status event display system with operation icons and formatted descriptions
- Added support for rich output using IPython.display.display() in Python tool
- Added setup subcommand to install dependencies for optional features
- Added Python setup component to install Jupyter kernel dependencies
- Added setup command help with component and option documentation
- Added Python tool dependency check in help output
- Added file locking mechanism for shared Python gateway to prevent race conditions
- Added Python gateway status monitoring with URL, PID, client count, and uptime information
- Added comprehensive Git helpers to Python prelude including status, diff, log, show, branch, and file operations
- Added line-based operations to Python prelude including line extraction, deletion, insertion, and pattern matching
- Added automatic categorization system for Python prelude functions with discoverable documentation
- Added enhanced `/status` command display showing Python gateway, LSP servers, and MCP server connections
- Added shared Python gateway coordinator for resource-efficient kernel management across sessions
- Added Python shared gateway setting with session-scoped kernel reuse and fallback behavior
- Added automatic idle shutdown for shared Python gateway after 30 seconds of inactivity
- Added environment filtering for shared Python gateway to exclude sensitive API keys
- Added virtual environment detection and automatic PATH configuration for Python gateway
- Added IPython-backed Python tool with streaming output, image/JSON rendering, and Jupyter kernel gateway integration
- Added Python prelude with 30+ shell-like utility functions for file operations
- Added Python tool exposure settings with session-scoped kernel reuse and fallback behavior
- Added streaming output system with automatic spill-to-disk for large outputs
- Added extension input interception with source metadata and command argument completion
- Added extension command context `compact()` helper plus context usage accessors
- Added ExtensionAPI `setLabel()` for extension and entry labels
- Added startup quiet setting to suppress welcome screen and startup messages
- Added support for auto-discovering APPEND_SYSTEM.md files
- Added support for piped input in non-interactive mode (auto-print mode)
- Added global session listing across all project directories with enhanced search metadata
- Added session fork prompt when resolving sessions from other projects
- Added key hint formatting utilities plus public exports for getShellConfig/getAgentDir/VERSION
- Added bash tool timeout display in tool output
- Added fuzzy text normalization for improved edit diff matching
- Added $@ argument slicing syntax in prompt templates
- Added configurable keybindings for expand tools and dequeue actions
- Added process title update on CLI startup

### Changed

- Updated Python tool description to display categorized helper functions with improved formatting
- Enhanced Python kernel startup to use shared gateway by default for better resource utilization
- Improved Python prelude functions to emit structured status events instead of text output
- Updated agent prompts to use bash tool instead of exec for git operations
- Changed default Python tool mode from ipy-only to both to enable shell execution
- Enhanced Python gateway coordination with Windows environment support and stale process cleanup
- Updated Python prelude functions to emit structured status events instead of text output
- Enhanced Python tool renderer to display status events alongside output
- Improved Python tool output formatting with status event integration
- Improved shared Python gateway coordination with environment validation and stale process cleanup
- Updated Python prelude to rename `bash()` function to `sh()` for consistency
- Changed default Python tool mode from "ipy-only" to "both" to enable both IPython and shell execution
- Enhanced Python gateway metadata tracking to include Python path and virtual environment information
- Improved Python kernel startup to use shared gateway by default for better resource utilization
- Updated Python tool to support proxy execution mode for worker processes
- Enhanced Python kernel availability checking with faster validation
- Optimized Python environment warming to avoid blocking during tool initialization
- Reorganized settings interface into behavior, tools, display, voice, status, lsp, and exa tabs
- Migrated environment variables from PI* to OMP* prefix with automatic migration
- Updated model selector to use TabBar component for provider navigation
- Changed role badges to inverted style with colored backgrounds
- Added support for /models command alias in addition to /model
- Improved error retry detection to include fetch failures
- Enhanced session selector search and overflow handling
- Updated skill command execution to include skill path metadata
- Surfaced loaded prompt templates during initialization
- Updated compaction summarization to use serialized prompt text
- Cleaned up Python prelude `sh()` and `run()` output to only show stdout/stderr without noisy metadata

### Fixed

- Fixed Python kernel cancellation handling and WebSocket cleanup for in-flight executions
- Fixed Python tool session scoping to include workdir and honor sharedGateway settings
- Fixed gist sharing output draining to avoid truncated URLs
- Fixed streaming output byte accounting and UTF-8 decoder flushing
- Fixed Python prelude integration tests to detect virtual environments and cover helper exports
- Fixed Python kernel cancellation/timeout handling and WebSocket close cleanup for in-flight executions
- Fixed Python output byte accounting and UTF-8 decoder flushing in streaming output
- Fixed shared Python gateway coordination (Windows env allowlist, lock staleness, refcount recovery)
- Fixed Python tool session scoping to include workdir and honor sharedGateway settings
- Fixed subagent Python proxy session isolation and cancellation/timeout propagation
- Fixed print-mode cleanup to dispose Python sessions before exit
- Fixed gist share output draining to avoid truncated URLs
- Fixed explore agent tool list to use bash for git operations
- Fixed Python prelude integration tests to detect venv-only Python and cover helper exports

### Security

- Enhanced Python gateway environment filtering to exclude sensitive API keys and Windows system paths

## [5.5.0] - 2026-01-18

### Changed

- Updated task execution guidelines to improve prompt framing and parallelization instructions

## [5.4.2] - 2026-01-16

### Changed

- Updated model resolution to accept pre-serialized settings for better performance
- Improved system prompt guidance for position-addressed vs content-addressed file edits
- Enhanced edit tool documentation with clear use cases for bash alternatives

## [5.3.0] - 2026-01-15

### Changed

- Expanded bash tool guidance to explicitly list appropriate use cases including file operations, build commands, and process management

## [5.2.1] - 2026-01-14

### Fixed

- Fixed stale diagnostic results by tracking diagnostic versions before file sync operations
- Fixed race condition where LSP diagnostics could return outdated results after file modifications

## [5.2.0] - 2026-01-14

### Added

- Added `withLines` parameter to read tool for optional line number output (default: true, cat -n format)

### Changed

- Changed find/grep/ls tool output to render inline without background box for cleaner visual flow

### Fixed

- Fixed task tool abort to return partial results instead of failing (completed tasks preserved, cancelled tasks shown as skipped)
- Fixed TUI crash when bash output metadata lines exceed terminal width on narrow terminals
- Fixed find tool not matching `**/filename` patterns (was incorrectly using `--full-path` for glob depth wildcards)

## [5.1.1] - 2026-01-14

### Fixed

- Fixed clipboard image paste getting stuck on Wayland when no image is present (was falling back to X11 and timing out)

## [5.1.0] - 2026-01-14

### Changed

- Updated light theme colors for WCAG AA compliance (4.5:1 contrast against white background)
- Changed dequeue hint text from "restore" to "edit all queued messages"

### Fixed

- Fixed session selector staying open when current folder has no sessions (shows hint to press Tab)
- Fixed print mode JSON output to emit session header at start
- Fixed "database is locked" SQLite errors when running subagents by serializing settings to workers instead of opening the database
- Fixed `/new` command to create a new session file (previously reused the same file when `--session` was specified)
- Fixed session selector page up/down navigation

## [5.0.1] - 2026-01-12

### Changed

- Replaced wasm-vips with Photon for more stable WASM image processing
- Added graceful fallback to original images when image resizing fails
- Added error handling for image conversion failures in interactive mode to prevent crashes
- Replace wasm-vips with Photon for more stable WASM image processing (fixes worker thread crashes)

## [5.0.0] - 2026-01-12

### Added

- Implemented `xhigh` thinking level for Anthropic models with increased reasoning limits

## [4.8.3] - 2026-01-12

### Changed

- Replace sharp with wasm-vips for cross-platform image processing without native dependencies

## [4.8.0] - 2026-01-12

### Fixed

- Move `sharp` to optional dependencies with all platform binaries to fix arm64 runtime errors

## [4.7.0] - 2026-01-12

### Added

- Add `omp config` subcommand for managing settings (`list`, `get`, `set`, `reset`, `path`)
- Add `todoCompletion` setting to warn agent when it stops with incomplete todos (up to 3 reminders)
- Add multi-part questions support to `ask` tool via `questions` array parameter

### Changed

- Updated multi-select cursor behavior in `ask` tool to stay on the toggled option instead of jumping to top
- Single-file reads now render inline (e.g., `Read AGENTS.md:23`) instead of tree structure

### Fixed

- Subagent model resolution now respects explicit provider prefix (e.g., `zai/glm-4.7` no longer matches `cerebras/zai-glm-4.7`)
- Auto-compaction now skips to next model candidate when retry delay exceeds 30 seconds

## [4.6.0] - 2026-01-12

### Added

- Add `/skill:name` slash commands for quick skill access (toggle via `skills.enableSkillCommands` setting)
- Add `cwd` to SessionInfo for session list display
- Add custom summarization instructions option in tree selector
- Add Alt+Up (dequeue) to restore all queued messages at once
- Add `shutdownRequested` and `checkShutdownRequested()` for extension-initiated shutdown

### Fixed

- Component `invalidate()` now properly rebuilds content on theme changes
- Force full re-render after returning from external editor

## [4.4.8] - 2026-01-12

### Changed

- Changed review finding priority format from numeric (0-3) to string labels (P0-P3) for clearer severity indication
- Replaced Type.Union with Type.Literal patterns with StringEnum helper across tool schemas for cleaner enum definitions

## [4.4.5] - 2026-01-11

### Changed

- Removed `format: "date-time"` from timestamp type conversion in JTD to JSON Schema transformation
- Reorganized system prompt to display context, environment, and tools sections before discipline guidelines
- Updated system prompt to show file paths more clearly in output
- Improved YAML frontmatter parsing with better error messages including source file information

### Fixed

- Fixed frontmatter parsing to properly report source location when YAML parsing fails

## [4.4.4] - 2026-01-11

### Added

- Added `todo_write` tool for creating and managing structured task lists during coding sessions
- Added persistent todo panel above the editor that displays task progress
- Added `Ctrl+T` keybinding to toggle todo list expansion
- Added grouped display for consecutive Read tool calls, showing multiple file reads in a compact tree view
- Added `todo_write` tool and persistent todo panel above the editor

### Changed

- Changed `Ctrl+Enter` to insert a newline when not streaming (previously `Alt+Enter`)
- Changed `Ctrl+T` from toggling thinking block visibility to toggling todo list expansion
- Changed system prompt to use more direct, field-oriented language with emphasis on verification and assumptions
- Changed temporary model selector keybinding from Ctrl+Y to Alt+P
- Changed expand hint text from "Ctrl+O to expand" to "Ctrl+O for more"
- Changed Read tool result display to hide content by default, showing only file path and status
- Changed `Ctrl+T` to toggle todo panel expansion

### Removed

- Removed `yaml` package dependency in favor of Bun's built-in YAML parser

### Fixed

- Fixed Alt+Enter to insert a newline when not streaming, instead of submitting the message
- Fixed Alt+Enter inserting a new line when not streaming instead of submitting a message
- Fixed Cursor provider to avoid advertising the Edit tool, relying on full-file Write operations instead
- Fixed prompt template loading to strip leading HTML comment metadata blocks

## [4.3.2] - 2026-01-11

### Changed

- Increased default bash output preview from 5 to 10 lines when collapsed
- Updated expanded bash output view to show full untruncated output when available

## [4.3.1] - 2026-01-11

### Changed

- Expanded system prompt with defensive reasoning guidance and assumption checks
- Allowed agent frontmatter to override subagent thinking level, clamped to model capabilities

### Fixed

- Ensured reviewer agents use structured output schemas and include reported findings in task outputs

## [4.3.0] - 2026-01-11

### Added

- Added Cursor provider support with browser-based OAuth authentication
- Added default model configuration for Cursor provider (claude-sonnet-4-5)
- Added execution bridge for Cursor tool calls including read, ls, grep, write, delete, shell, diagnostics, and MCP operations

### Fixed

- Improved fuzzy matching accuracy for edit operations when file and target have inconsistent indentation patterns

## [4.2.3] - 2026-01-11

### Changed

- Changed default for `hidden` option in find tool from `false` to `true`, now including hidden files by default

### Fixed

- Fixed serialized auth storage initialization so OAuth refreshes in subagents don't crash

## [4.2.2] - 2026-01-11

### Added

- Added persistent cache storage for Codex usage data that survives application restarts
- Added `--no-lsp` to disable LSP tools, formatting, diagnostics, and warmup for a session

### Changed

- Changed `SettingsManager.create()` to be async, requiring `await` when creating settings managers
- Changed `loadSettings()` to be async, requiring `await` when loading settings
- Changed `discoverSkills()` to be async, requiring `await` when discovering skills
- Changed `loadSlashCommands()` to be async, requiring `await` when loading slash commands
- Changed `buildSystemPrompt()` to be async, requiring `await` when building system prompts
- Changed `loadSkills()` to be async, requiring `await` when loading skills
- Changed `loadProjectContextFiles()` to be async, requiring `await` when loading context files
- Changed `getShellConfig()` to be async, requiring `await` when getting shell configuration
- Changed capability provider `load()` methods to be async-only, removing synchronous `loadSync` API
- Updated `plan` agent with enhanced structured planning process, parallel exploration via `explore` agent spawning, and improved output format with examples
- Removed `planner` agent command template, consolidating planning functionality into the `plan` agent

## [4.2.1] - 2026-01-11

### Added

- Added automatic discovery and listing of AGENTS.md files in the system prompt, providing agents with an authoritative list of project-specific instruction files without runtime searching
- Added `planner` built-in agent for comprehensive implementation planning with slow model

### Changed

- Refactored skill discovery to use unified `loadSkillsFromDir` helper across all providers, reducing code duplication
- Updated skill discovery to scan only `skills/*/SKILL.md` entries instead of recursive walks in Codex provider
- Added guidance to Task tool documentation to isolate file scopes when assigning tasks to prevent agent conflicts
- Updated Task tool documentation to emphasize that subagents have no access to conversation history and require all relevant context to be explicitly passed
- Revised task agent prompt to clarify that subagents have full tool access and can make file edits, run commands, and create files
- OpenAI Codex: updated to use bundled system prompt from upstream
- Changed `complete` tool to make `data` parameter optional when aborting, while still requiring it for successful completions
- Skills discovery now scans only `skills/*/SKILL.md` entries instead of recursive walks

### Removed

- Removed `architect-plan`, `implement`, and `implement-with-critic` built-in agent commands

### Fixed

- Fixed editor border rendering glitch after canceling slash command autocomplete
- Fixed login/logout credential path message to reference agent.db
- Removed legacy auth.json file—credentials are stored exclusively in agent.db
- Removed legacy auth.json file—credentials are stored exclusively in agent.db

## [4.2.0] - 2026-01-10

### Added

- Added `/dump` slash command to copy the full session transcript to the clipboard
- Added automatic Nerd Fonts detection for terminals like iTerm, WezTerm, Kitty, Ghostty, and Alacritty to set appropriate symbol preset
- Added `NERD_FONTS` environment variable override (`1` or `0`) to manually control Nerd Fonts symbol preset
- Added Handlebars templating engine for prompt template rendering with `{{arg}}` helper for positional arguments
- Added support for custom share scripts at ~/.omp/agent/share.ts to replace default GitHub Gist sharing

### Changed

- Changed rules system to use `read` tool for loading rule content instead of dedicated `rulebook` tool
- Separated `/export` and `/dump` commands—`/export` now only exports to HTML file, while `/dump` copies session transcript to clipboard
- Updated `/export` command to no longer accept `--copy` flag (use `/dump` instead)
- Changed prompt template rendering to use Handlebars instead of simple string replacement
- Updated prompt layout optimization to normalize indentation and collapse excessive blank lines
- Changed auth migration to merge credentials per-provider instead of skipping when any credentials exist in database
- Migrated settings and auth credential storage from JSON files to SQLite database (agent.db)
- Updated credential migration message to reference agent.db instead of auth.json
- Renamed Glob tool references to Find tool throughout prompts and documentation
- Updated project context formatting to use XML-style tags for clearer structure
- Refined bash tool guidance to prefer dedicated tools (read/grep/find/ls) over bash for file operations
- Updated system prompt with clearer tone guidelines emphasizing directness and conciseness
- Revised workflow instructions to require explicit planning for non-trivial tasks
- Enhanced verification guidance to prefer external feedback loops like tests and linters
- Added explicit alignment and prohibited behavior sections to improve response quality

### Removed

- Removed `rulebook` tool - rules are now loaded via the `read` tool instead of a dedicated tool

### Fixed

- Fixed message submission lag caused by synchronous history database writes by deferring DB operations with setImmediate

### Security

- Hardened file permissions on agent database directory (700) and database file (600) to restrict access

## [4.1.0] - 2026-01-10

### Added

- Added persistent prompt history with SQLite-backed storage and Ctrl+R search

### Fixed

- Fixed credential blocking logic to correctly check for remaining available credentials instead of always returning true

## [4.0.1] - 2026-01-10

### Added

- Added usage limit error detection to enable automatic credential switching when Codex accounts hit rate limits
- Added Codex usage API integration to proactively check account limits before credential selection
- Added credential backoff tracking to temporarily skip rate-limited accounts during selection
- Multi-credential usage-aware selection for OpenAI Codex OAuth accounts with automatic fallback when rate limits are reached
- Consistent session-to-credential hashing (FNV-1a) for stable credential assignment across sessions
- Codex usage API integration to detect and cache rate limit status per account
- Automatic mid-session credential switching when usage limits are hit

### Changed

- Changed credential selection to use deterministic FNV-1a hashing for consistent session-to-credential mapping
- Changed OAuth credential resolution to try credentials in priority order, skipping blocked ones

## [4.0.0] - 2026-01-10

### Added

- Exported `InteractiveModeOptions` type for programmatic SDK usage
- Exported additional UI components for extensions: `ArminComponent`, `AssistantMessageComponent`, `BashExecutionComponent`, `BranchSummaryMessageComponent`, `CompactionSummaryMessageComponent`, `CustomEditor`, `CustomMessageComponent`, `FooterComponent`, `ExtensionEditorComponent`, `ExtensionInputComponent`, `ExtensionSelectorComponent`, `LoginDialogComponent`, `ModelSelectorComponent`, `OAuthSelectorComponent`, `SessionSelectorComponent`, `SettingsSelectorComponent`, `ShowImagesSelectorComponent`, `ThemeSelectorComponent`, `ThinkingSelectorComponent`, `ToolExecutionComponent`, `TreeSelectorComponent`, `UserMessageComponent`, `UserMessageSelectorComponent`
- Exported `renderDiff`, `truncateToVisualLines`, and related types for extension use
- `setFooter()` and `setHeader()` methods on `ExtensionUIContext` for custom footer/header components
- `setEditorComponent()` method on `ExtensionUIContext` for custom editor components
- `supportsUsageInStreaming` model config option to control `stream_options: { include_usage: true }` behavior
- Terminal setup documentation for Kitty keyboard protocol configuration (Ghostty, wezterm, Windows Terminal)
- Documentation for paid Cloud Code Assist subscriptions via `GOOGLE_CLOUD_PROJECT` env var
- Environment variables reference section in README
- `--no-tools` flag to disable all built-in tools, enabling extension-only setups
- `--no-extensions` flag to disable extension discovery while still allowing explicit `-e` paths
- `blockImages` setting to prevent images from being sent to LLM providers
- `thinkingBudgets` setting to customize token budgets per thinking level
- `PI_SKIP_VERSION_CHECK` environment variable to disable new version notifications at startup
- Anthropic OAuth support via `/login` to authenticate with Claude Pro/Max subscription
- OpenCode Zen provider support via `OPENCODE_API_KEY` env var and `opencode/<model-id>` syntax
- Session picker (`pi -r`) and `--session` flag support searching/resuming by session ID (UUID prefix)
- Session ID forwarding to LLM providers for session-based caching (used by OpenAI Codex for prompt caching)
- `dequeue` keybinding (`Alt+Up`) to restore queued steering/follow-up messages back into the editor
- Pluggable operations for built-in tools enabling remote execution via SSH or other transports (`ReadOperations`, `WriteOperations`, `EditOperations`, `BashOperations`, `LsOperations`, `GrepOperations`, `FindOperations`)
- `/model <search>` pre-filters the model selector or auto-selects on exact match; use `provider/model` syntax to disambiguate
- Managed binaries directory (`~/.omp/bin/`) for fd and rg tools
- `FooterDataProvider` for custom footers with `getGitBranch()`, `getExtensionStatuses()`, and `onBranchChange()`
- `ctx.ui.custom()` accepts `{ overlay: true }` option for floating modal components
- `ctx.ui.getAllThemes()`, `ctx.ui.getTheme(name)`, `ctx.ui.setTheme(name | Theme)` for theme management
- `setActiveTools()` for dynamic tool management
- `setModel()`, `getThinkingLevel()`, `setThinkingLevel()` methods for runtime model and thinking level changes
- `ctx.shutdown()` for requesting graceful shutdown
- `pi.sendUserMessage()` for sending user messages from extensions
- Extension UI dialogs (`select`, `confirm`, `input`) support `timeout` option with live countdown display
- Extension UI dialogs accept optional `AbortSignal` to programmatically dismiss dialogs
- Async extension factories for dynamic imports and lazy-loaded dependencies
- `user_bash` event for intercepting user `!`/`!!` commands
- Built-in renderers used automatically for tool overrides without custom `renderCall`/`renderResult`
- `InteractiveMode`, `runPrintMode()`, `runRpcMode()` exported for building custom run modes
- Copy link button on messages for deep linking to specific entries
- Codex injection info display showing system prompt modifications
- URL parameter support for `leafId` and `targetId` deep linking
- Wayland clipboard support for `/copy` command using wl-copy with xclip/xsel fallback

### Changed

- Bash tool output truncation now recalculates on terminal resize instead of using cached width
- Web search tool headers updated to match Claude Code client format for better compatibility
- `discoverSkills()` return type documented as `{ skills: Skill[], warnings: SkillWarning[] }` in SDK docs
- Default model for OpenCode provider changed from `claude-sonnet-4-5` to `claude-opus-4-5`
- Terminal color mode detection defaults to truecolor for modern terminals instead of 256color
- System prompt restructured with XML tags and clearer instructions format
- `before_agent_start` event receives `systemPrompt` in the event object and returns `systemPrompt` (full replacement) instead of `systemPromptAppend`
- `discoverSkills()` returns `{ skills: Skill[], warnings: SkillWarning[] }` instead of `Skill[]`
- `ctx.ui.custom()` factory signature changed from `(tui, theme, done)` to `(tui, theme, keybindings, done)`
- `ExtensionRunner.initialize()` signature changed from options object to positional params `(actions, contextActions, commandContextActions?, uiContext?)`

### Fixed

- Wayland clipboard copy (`wl-copy`) no longer blocks when the process doesn't exit promptly
- Empty `--tools` flag now correctly enables all built-in tools instead of disabling them
- Bash tool handles spawn errors gracefully instead of crashing the agent
- Components properly rebuild their content on theme change via `invalidate()` override
- `setTheme()` triggers a full rerender so previously rendered components update with new theme colors
- Session ID updates correctly when branching sessions
- External edits to `settings.json` while pi is running are preserved when pi saves settings
- Default thinking level from settings applies correctly when `enabledModels` is configured
- LM Studio compatibility for OpenAI Responses tool strict mapping
- Symlinked directories in `prompts/` folders are followed when loading prompt templates
- String `systemPrompt` in `createAgentSession()` works as a full replacement instead of having context files and skills appended
- Update notification for bun binary installs shows release download URL instead of npm command
- ESC key works during "Working..." state after auto-retry
- Abort messages show correct retry attempt count
- Antigravity provider returning 429 errors despite available quota
- Malformed thinking text in Gemini/Antigravity responses where thinking content appeared as regular text
- `--no-skills` flag correctly prevents skills from loading in interactive mode
- Overflow-based compaction skips if error came from a different model or was already handled
- OpenAI Codex context window reduced from 400k to 272k tokens to match Codex CLI defaults
- Context overflow detection recognizes `context_length_exceeded` errors
- Key presses no longer dropped when input is batched over SSH
- Clipboard image support works on Alpine Linux and other musl-based distros
- Queued steering/follow-up messages no longer wipe unsent editor input
- OAuth token refresh failure no longer crashes app at startup
- Status bar shows correct git branch when running in a git worktree
- Ctrl+V clipboard image paste works on Wayland sessions
- Extension directories in `settings.json` respect `package.json` manifests

## [3.37.0] - 2026-01-10

### Changed

- Improved bash command display to show relative paths for working directories within the current directory, and hide redundant `cd` prefix when working directory matches current directory

## [3.36.0] - 2026-01-10

### Added

- Added `calc` tool for basic mathematical calculations with support for arithmetic operators, parentheses, and hex/binary/octal literals
- Added support for multiple API credentials per provider with round-robin distribution across sessions
- Added file locking for auth.json to prevent concurrent write corruption
- Added clickable OAuth login URL display in terminal
- Added `workdir` parameter to bash tool to execute commands in a specific directory without requiring `cd` commands

### Changed

- Updated bash tool rendering to display working directory context when `workdir` parameter is used

### Fixed

- Fixed completion notification to only send when interactive mode is in foreground
- Improved completion notification message to include session title when available

## [3.35.0] - 2026-01-09

### Added

- Added retry logic with exponential backoff for auto-compaction failures
- Added fallback to alternative models when auto-compaction fails with the primary model
- Added support for `pi/<role>` model aliases in task tool (e.g., `pi/slow`, `pi/default`)
- Added visual cycle indicator when switching between role models showing available roles
- Added automatic model inheritance for subtasks when parent uses default model
- Added `--` separator in grep tool to prevent pattern interpretation as flags

### Changed

- Changed role model cycling to remember last selected role instead of matching current model
- Changed edit tool to merge call and result displays into single block
- Changed model override behavior to persist in settings when explicitly set via CLI

### Fixed

- Fixed retry-after parsing from error messages supporting multiple header formats (retry-after, retry-after-ms, x-ratelimit-reset)
- Fixed image attachments being dropped when steering/follow-up messages are queued during streaming
- Fixed image auto-resize not applying to clipboard images before sending
- Fixed clipboard image attachments being dropped when steering/follow-up messages are queued while streaming
- Fixed clipboard image attachments ignoring the auto-resize setting before sending

## [3.34.0] - 2026-01-09

### Added

- Added caching for system environment detection to improve startup performance
- Added disk usage information to automatic environment detection in system prompt
- Added `compat` option for SSH hosts to wrap commands in a POSIX shell on Windows systems
- Added automatic working directory handling for PowerShell and cmd.exe on Windows SSH hosts
- Added automatic environment detection to system prompt including OS, distro, kernel, CPU, GPU, shell, terminal, desktop environment, and window manager information
- Added SSH tool with project ssh.json/.ssh.json discovery, persistent connections, and optional sshfs mounts
- Added SSH host OS/shell detection with compat mode and persistent host info cache

### Changed

- Changed GPU detection on Linux to prioritize discrete GPUs (NVIDIA, AMD) over integrated graphics and skip server management adapters
- Changed SSH host info cache to use versioned format for automatic refresh on schema changes
- Changed SSH compat shell detection to actively probe for bash/sh availability on Windows hosts
- Changed SSH tool description to show detected shell type and available commands per host

## [3.33.0] - 2026-01-08

### Added

- Added `env` support in `settings.json` for automatically setting environment variables on startup
- Added environment variable management methods to SettingsManager (get/set/clear)

### Fixed

- Fixed bash output previews to recompute on resize, preventing TUI line width overflow crashes
- Fixed session title generation to retry alternate smol models when the primary model errors or is rate-limited
- Fixed file mentions to resolve extensionless paths and directories, using read tool truncation limits for injected content
- Fixed interactive UI to show auto-read file mention indicators
- Fixed task tool tree rendering to use consistent tree connectors for progress, findings, and results
- Fixed last-branch tree connector symbol in the TUI
- Fixed output tool previews to use compact JSON when outputs are formatted with leading braces

## [3.32.0] - 2026-01-08

### Added

- Added progress indicator when starting LSP servers at session startup
- Added bundled `/init` slash command available by default

### Changed

- Changed LSP server warmup to use a 5-second timeout, falling back to lazy initialization for slow servers

### Fixed

- Fixed Task tool subagent model selection to inherit explicit CLI `--model` overrides

## [3.31.0] - 2026-01-08

### Added

- Added temporary model selection: `Ctrl+Y` opens model selector for session-only model switching (not persisted to settings)
- Added `setModelTemporary()` method to AgentSession for ephemeral model changes
- Added empty Enter to flush queued messages: pressing Enter with empty editor while streaming aborts current stream
- Added auto-chdir to temp directories when starting in home unless `--allow-home` is set
- Added upfront diff parsing and filtering for code review command to exclude lock files, generated code, and binary assets

### Fixed

- Fixed auto-chdir to only use existing directories and fall back to `tmpdir()`
- Added automatic reviewer agent count recommendation based on diff weight and file count
- Added file grouping guidance for parallel review distribution across multiple agents
- Added diff preview mode for large changesets that exceed size thresholds
- Added in-memory session storage implementation for testing and ephemeral sessions
- Added `createToolUIKit` helper to consolidate common UI formatting utilities across tool renderers
- Added configurable bash interceptor rules via `bashInterceptor.patterns` setting for custom command blocking
- Added `bashInterceptor.simpleLs` setting to control interception of bare ls commands
- Added LSP server configuration via external JSON defaults file for easier customization
- Added abort signal propagation to web scrapers for improved cancellation handling
- Added `diagnosticsVersion` tracking to LSP client for more reliable diagnostic polling
- Added 80+ specialized web scrapers for structured content extraction from popular sites including GitHub, GitLab, npm, PyPI, crates.io, Wikipedia, YouTube, Stack Overflow, Hacker News, Reddit, arXiv, PubMed, and many more
- Added site-specific API integrations for package registries (npm, PyPI, crates.io, Hex, Hackage, NuGet, Maven, RubyGems, Packagist, pub.dev, Go packages)
- Added scrapers for social platforms (Mastodon, Bluesky, Lemmy, Lobsters, Dev.to, Discourse)
- Added scrapers for academic sources (arXiv, bioRxiv, PubMed, Semantic Scholar, ORCID, CrossRef, IACR)
- Added scrapers for security databases (NVD, OSV, CISA KEV)
- Added scrapers for documentation sites (MDN, Read the Docs, RFC Editor, W3C, SPDX, tldr, cheat.sh)
- Added scrapers for media platforms (YouTube, Vimeo, Spotify, Discogs, MusicBrainz)
- Added scrapers for AI/ML platforms (Hugging Face, Ollama)
- Added scrapers for app stores and marketplaces (VS Code Marketplace, JetBrains Marketplace, Firefox Add-ons, Open VSX, Flathub, F-Droid, Snapcraft)
- Added scrapers for business data (SEC EDGAR, OpenCorporates, CoinGecko)
- Added scrapers for reference sources (Wikipedia, Wikidata, OpenLibrary, Choose a License)

### Changed

- Changed `Ctrl+P` to cycle through role models (slow → default → smol) instead of all available models
- Changed `Shift+Ctrl+P` to cycle role models temporarily (not persisted)
- Changed Extension Control Center to scale with terminal height instead of fixed 25-line limit
- Changed review command to parse git diff upfront and provide structured context to reviewer agents
- Changed session persistence to use structured logging instead of console.error for persistence failures
- Changed find tool to use fd command for .gitignore discovery instead of Bun.Glob for better abort handling
- Changed LSP config loading to only mark overrides when servers are actually defined
- Changed task tool to require explicit task `id` field instead of auto-generating names from agent type
- Changed grep and find tools to use native Bun file APIs instead of Node.js fs module for improved performance
- Changed YouTube scraper to use async command execution with proper stream handling
- Improved rust-analyzer diagnostic polling to use version-based stability detection instead of time-based delays
- Changed theme icons for extension types to use Unicode symbols (✧, ⚒) instead of text abbreviations (SK, TL, MCP)
- Changed task tool to use short CamelCase task IDs instead of agent-based naming (e.g., 'SessionStore' instead of 'explore_0')
- Changed task tool to accept single `agent` parameter at top level instead of per-task agent specification
- Changed reviewer agent to use `complete` tool instead of `submit_review` for finishing reviews
- Changed theme icons for extensions to use Unicode symbols instead of text abbreviations
- Changed LSP file type matching to support exact filename matches in addition to extensions
- Improved rust-analyzer diagnostic polling to use version-based stability detection
- Refactored web-fetch tool to use modular scraper architecture for improved maintainability

### Removed

- Removed `submit_review` tool - reviewers now finish via `complete` tool with structured output

### Fixed

- Fixed session persistence to call fsync before renaming temp file for durability
- Fixed duplicate persistence error logging by tracking whether error was already reported
- Fixed byte counting in task output truncation to correctly handle multi-byte Unicode characters
- Fixed parallel task execution to propagate abort signals and fail fast on first error
- Fixed task worker abort handling to properly clean up on cancellation
- Fixed parallel task execution to fail fast on first error instead of waiting for all workers
- Fixed byte counting in task output truncation to handle multi-byte Unicode characters correctly

## [3.30.0] - 2026-01-07

### Added

- Added environment variable configuration for task limits: `OMP_TASK_MAX_PARALLEL`, `OMP_TASK_MAX_CONCURRENCY`, `OMP_TASK_MAX_OUTPUT_BYTES`, `OMP_TASK_MAX_OUTPUT_LINES`, and `OMP_TASK_MAX_AGENTS_IN_DESCRIPTION`
- Added specialized web-fetch handlers for 50+ platforms including GitHub, GitLab, npm, PyPI, crates.io, Stack Overflow, Wikipedia, arXiv, PubMed, Hacker News, Reddit, Mastodon, Bluesky, and many more
- Added automatic yt-dlp installation for YouTube transcript extraction
- Added YouTube video support with automatic transcript extraction via yt-dlp

### Changed

- Changed task executor to gracefully handle worker termination with proper cleanup and timeout handling

### Fixed

- Fixed Lobsters front page handler to use correct API endpoint (`/hottest.json` instead of invalid `.json`)
- Fixed task worker error handling to prevent hanging on worker crashes, uncaught errors, and unhandled rejections
- Fixed double-stringified JSON output from subagents being returned as escaped strings instead of parsed objects
- Fixed markitdown tool installation to use automatic tool installer instead of requiring manual installation

## [3.25.0] - 2026-01-07

### Added

- Added `complete` tool for structured subagent output with JSON schema validation
- Added `query` parameter to output tool for jq-like JSON querying
- Added `output_schema` parameter to task tool for structured subagent completion
- Added JTD (JSON Type Definition) to JSON Schema converter for schema flexibility
- Added memorable two-word task identifiers (e.g., SwiftFalcon) for better task tracking

### Changed

- Changed task output IDs from `agent_index` format to memorable names for easier reference
- Changed subagent completion flow to require explicit `complete` tool call with retry reminders
- Simplified worker agent system prompt to be more concise and focused

## [3.24.0] - 2026-01-07

### Added

- Added `ToolSession` interface to unify tool creation with session context including cwd, UI availability, and rulebook rules
- Added Bun Worker-based execution for subagent tasks, replacing subprocess spawning for improved performance and event streaming
- Added `toolNames` option to filter which built-in tools are included in agent sessions
- Added `BUILTIN_TOOLS` registry constant for programmatic access to available tool factories
- Added unit tests for `createTools` function covering tool filtering and conditional tool creation

### Changed

- Changed subagent execution from spawning separate `omp` processes to running in Bun Workers with direct event streaming
- Changed tool factories to accept `ToolSession` parameter instead of separate cwd and options arguments
- Changed `createTools` to return tools as a Map and support conditional tool creation based on session context
- Changed system prompt builder to dynamically generate tool descriptions from the tool registry
- Changed task tool description to be generated from a template with dynamic agent list injection
- Changed tool creation to use a unified `ToolSession` interface instead of separate parameters for cwd, options, and callbacks
- Changed `createTools` to return tools as a Map instead of an array for consistent tool registry access
- Changed system prompt builder to receive tool registry Map for dynamic tool description generation
- Changed subprocess usage tracking to accumulate incrementally from message_end events rather than parsing stored events after completion

### Removed

- Removed `browser` embedded agent from task tool agent discovery
- Removed `recursive` property from agent definitions
- Removed environment variables `OMP_NO_SUBAGENTS`, `OMP_BLOCKED_AGENT`, and `OMP_SPAWNS` for subagent control
- Removed pre-instantiated tool exports (`readTool`, `bashTool`, `editTool`, `writeTool`, `grepTool`, `findTool`, `lsTool`) in favor of factory functions
- Removed `createCodingTools` and `createReadOnlyTools` helper functions
- Removed `codingTools` and `readOnlyTools` convenience exports
- Removed `wrapToolsWithExtensions` function from extensions API
- Removed `hidden` property support from custom tools
- Removed subagent and question custom tool examples

### Fixed

- Fixed memory accumulation in task subprocess by streaming events directly to disk instead of storing in memory
- Fixed session persistence to exclude transient streaming data (partialJson, jsonlEvents) that was causing unnecessary storage bloat
- Fixed createTools respecting explicit tool lists instead of returning all non-hidden tools

## [3.21.0] - 2026-01-06

### Changed

- Switched from local `@oh-my-pi/pi-ai` to upstream `@oh-my-pi/pi-ai` package

### Added

- Added `webSearchProvider` setting to override auto-detection priority (Exa > Perplexity > Anthropic)
- Added `imageProvider` setting to override auto-detection priority (OpenRouter > Gemini)
- Added `git.enabled` setting to enable/disable the structured git tool
- Added `offset` and `limit` parameters to Output tool for paginated reading of large outputs
- Added provider fallback chain for web search that tries all configured providers before failing
- Added `SearchProviderError` class with HTTP status for actionable provider error messages
- Added bash interceptor rule to block git commands when structured git tool is enabled
- Added validation requiring `message` parameter for git commit operations (prevents interactive editor)
- Added output ID hints in multi-agent Task results pointing to Output tool for full logs
- Added fuzzy matching support for `all: true` mode in edit tool, enabling replacement of similar text blocks with whitespace differences
- Added `all` parameter to edit tool for replacing all occurrences instead of requiring unique matches
- Added OpenRouter support for image generation when `OPENROUTER_API_KEY` is set
- Added ImageMagick fallback for image processing when sharp module is unavailable
- Added slash commands to the extensions inspector panel for visibility and management
- Added support for file-based slash commands from `commands/` directories
- Added `$ARGUMENTS` placeholder for slash command argument substitution, aligning with Claude and Codex conventions

### Changed

- Refactored tool renderers to be co-located with their respective tool implementations for improved code organization
- Changed web search to try all configured providers in sequence with fallback before reporting errors
- Changed default Anthropic web search model from `claude-sonnet-4-5-20250514` to `claude-haiku-4-5`
- Changed read tool to show first 50KB of oversized lines instead of directing users to bash sed
- Changed web_fetch to use `Bun.which()` instead of spawning `which`/`where` for command detection
- Changed web_fetch to check Content-Length header before downloading to reject oversized files early
- Changed generate_image tool to save images to temp files and report paths instead of inline base64
- Changed system prompt with tool usage guidance (ground answers with tools, minimize context, iterate on results)
- Changed Task tool prompt with plan-then-execute guidance and output tool hints
- Changed edit tool success message to report count when replacing multiple occurrences with `all: true`
- Changed default image generation model to `gemini-3-pro-image-preview`
- Changed error message for multiple occurrences to suggest using `all: true` option
- Changed web_fetch tool label from `web_fetch` to `Web Fetch` for improved display
- Changed argument substitution order in slash commands to process positional args ($1, $2) before wildcards ($@, $ARGUMENTS) to prevent re-substitution issues
- Changed image tool name from `gemini_image` to `generate_image` with label `GenerateImage`

### Fixed

- Fixed read tool markitdown truncation message using broken template string (missing `${` around format call)
- Fixed web_fetch URL normalization order to run before special handlers
- Fixed TUI image display for generate_image tool by sourcing images from details.images in addition to content blocks
- Fixed context file preview in inspector panel to display content correctly instead of attempting async file reads
- Fixed Linux ARM64 installs failing on fresh Debian when the `sharp` module is unavailable during session image compression

## [3.20.1] - 2026-01-06

### Fixed

- Fixed find tool failing to match patterns with path separators (e.g., `reports/**`) by enabling full-path matching in fd

### Changed

- Changed multi-task display to show task descriptions instead of agent names when available
- Changed ls tool to show relative modification times (e.g., "2d ago", "just now") for each entry

## [3.20.0] - 2026-01-06

### Added

- Added extensions API with auto-discovery (`.omp/extensions`) and `--extension`/`-e` loading for custom tools, commands, and lifecycle hooks
- Added prompt templates loaded from global and project `.omp/prompts` directories with `/template` expansion in the input box
- Built-in provider overrides in `models.json`: override just `baseUrl` to route a built-in provider through a proxy while keeping all its models, or define `models` to fully replace the provider
- Shell commands without context contribution: use `!!command` to execute a bash command that is shown in the TUI and saved to session history but excluded from LLM context. Useful for running commands you don't want the AI to see
- Added VoiceSupervisor class for realtime voice mode using OpenAI Realtime API with continuous mic streaming and semantic VAD turn detection
- Added VoiceController class for steering user input and deciding presentation of assistant responses
- Added echo suppression and noise floor filtering for microphone input during voice playback
- Added fallback transcript handling when realtime assistant produces no tool call or audio output
- Added voice progress notifications that speak partial results after 15 seconds of streaming
- Added platform-specific audio tool detection with helpful installation instructions for missing tools
- Added realtime voice mode using OpenAI gpt-5-realtime with continuous mic streaming, interruptible input, and supervisor-controlled spoken updates
- Added `gemini_image` tool for Gemini Nano Banana image generation when `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) is set
- Added `description` field to task tool for displaying short user-facing summaries in progress output
- Added `getApiKeyForProvider()` method to ModelRegistry for retrieving API keys by provider name
- Added voice settings configuration for transcription model, TTS model, voice, and audio format
- Added shared render utilities module with standardized formatting functions for truncation, byte/token/duration display, and tree rendering
- Added `resolveOmpCommand()` helper to resolve subprocess command from environment or entry point
- Added `/background` (or `/bg`) command to detach UI and continue agent execution in the background
- Added completion notification system with configurable methods (bell, osc99, osc9, auto, off) when agent finishes
- Added `completionNotification` setting to configure how the agent notifies on completion
- Added `OMP_NOTIFICATIONS` environment variable to suppress notifications globally
- Added `/wt` slash command for git worktree management with create, list, merge, remove, status, spawn, and parallel operations
- Added worktree library with collapse strategies (simple, merge-base, rebase) for merging changes between worktrees
- Added worktree session tracking for managing agent tasks across isolated worktrees
- Added structured git tool with safety guards, caching, and GitHub operations
- Added `cycleRoleModels()` method to cycle through configured role-based models in a fixed order with deduplication
- Added language-specific file icons to LSP diagnostics output showing file locations
- Added language-specific file icon to edit tool header display

### Changed

- Changed voice mode toggle from Caps Lock to Ctrl+Y with auto-send on silence behavior
- Changed default TTS model from gpt-4o-mini-tts to tts-1
- Changed voice mode description to reflect realtime input/output with auto-send on silence
- Updated hotkeys help to show Ctrl+Y for voice mode toggle instead of Caps Lock
- Voice mode now uses OpenAI Realtime (gpt-5-realtime) with Ctrl+Y toggle and auto-send on silence
- Updated web search tool to support `auto` as explicit provider option for auto-detection
- Standardized tool result rendering across grep, find, ls, notebook, ask, output, and web search tools with consistent tree formatting and expand hints
- Updated grep and find tool output to display language-specific icons for files and folder icons for directories
- Updated file listing to display language-specific icons based on file extension instead of generic file icons

### Fixed

- Fixed task tool race condition where subprocess stdout events were skipped due to `resolved` flag being set before stream readers finished, causing completed tasks to display "0 tools · 0 tokens"
- `/model` selector now opens instantly instead of waiting for OAuth token refresh. Token refresh is deferred until a model is actually used
- Fixed cross-platform browser opening to work on Windows (via cmd /c start) and fail gracefully when unavailable

## [3.15.1] - 2026-01-05

### Added

- Added 65 new built-in color themes including dark variants (abyss, aurora, cavern, copper, cosmos, eclipse, ember, equinox, lavender, lunar, midnight, nebula, rainforest, reef, sakura, slate, solstice, starfall, swamp, taiga, terminal, tundra, twilight, volcanic), light variants (aurora-day, canyon, cirrus, coral, dawn, dunes, eucalyptus, frost, glacier, haze, honeycomb, lagoon, lavender, meadow, mint, opal, orchard, paper, prism, sand, savanna, soleil, wetland, zenith), and material themes (alabaster, amethyst, anthracite, basalt, birch, graphite, limestone, mahogany, marble, obsidian, onyx, pearl, porcelain, quartz, sandstone, titanium)

### Fixed

- Fixed status line end cap rendering to properly apply background colors and use correct powerline separator characters

## [3.15.0] - 2026-01-05

### Added

- Added spinner type variants (status and activity) with distinct animation frames per symbol preset
- Added animated spinner for task tool progress display during subagent execution
- Added language/file type icons for read tool output with support for 35+ file types
- Added async cleanup registry for graceful session flush on SIGINT, SIGTERM, and SIGHUP signals
- Added subagent token usage aggregation to session statistics and task tool results
- Added streaming NDJSON writer for session persistence with proper backpressure handling
- Added `flush()` method to SessionManager for explicit control over pending write completion
- Added `/exit` slash command to exit the application from interactive mode
- Added fuzzy path matching suggestions when read tool encounters file-not-found errors, showing closest matches using Levenshtein distance
- Added `status.shadowed` symbol for theme customization to properly indicate shadowed extension state
- Added Biome CLI-based linter client as alternative to LSP for more reliable diagnostics
- Added LinterClient interface for pluggable formatter/linter implementations
- Added status line segment editor for arranging and toggling status line components
- Added status line presets (default, minimal, compact, developer, balanced) for quick configuration
- Added status line separator styles (powerline, powerline-thin, arrow, slash, pipe, space)
- Added configurable status line segments including time, hostname, and subagent count
- Added symbol customization via theme overrides for icons, separators, and glyphs
- Added 30+ built-in color themes including Catppuccin, Dracula, Nord, Gruvbox, Tokyo Night, and more
- Added configurable status line with customizable segments, presets, and separators
- Added status line segment editor for arranging and toggling status line components
- Added symbol preset setting to switch between Unicode, Nerd Font, and ASCII glyphs
- Added file size limit (20MB) for image files to prevent memory issues during serialization

### Changed

- Changed `isError` property in tool result events to be optional instead of required
- Changed `SessionManager.open()` and `SessionManager.continueRecent()` to async methods for proper initialization
- Changed session file writes to use atomic rename pattern with fsync for crash-safe persistence
- Changed read tool display to show file type icons and metadata inline with path
- Changed `AgentSession.dispose()` to async method that flushes pending writes before cleanup
- Changed read tool result display to hide content by default with expand hint, showing only metadata until expanded
- Changed diagnostics display to group messages by file with tree structure and severity icons
- Changed diff stats formatting to use colored +/- indicators with slash separators
- Changed session persistence to use streaming writes instead of synchronous file appends for better performance
- Changed read tool to automatically redirect to ls when given a directory path instead of a file
- Changed tool description prompts to be more concise with clearer usage guidelines and structured formatting
- Moved tool description prompts from inline strings to external markdown files in `src/prompts/tools/` directory for better maintainability
- Changed Exa web search provider from MCP protocol to direct REST API for simpler integration
- Changed web search result rendering to handle malformed response data with fallback text display
- Changed compaction prompts to preserve tool outputs, command results, and repository state in context summaries
- Changed init prompt to include runtime/tooling preferences section and improved formatting guidelines
- Changed reviewer prompt to require evidence-backed findings anchored to diff hunks with stricter suggestion block formatting
- Changed system prompt to include explicit core behavior guidelines for task completion and progress updates
- Changed task prompt to emphasize end-to-end task completion and tool verification
- Moved all prompt templates from inline strings to external markdown files in `src/prompts/` directory for better maintainability
- Changed tool result renderers to use structured tree layouts with consistent expand hints and truncation indicators
- Changed grep, find, and ls tools to show scope path and detailed truncation reasons in output
- Changed web search and web fetch result rendering to display structured metadata sections with bounded content previews
- Changed task/subagent progress rendering to use badge-style status labels and structured output sections
- Changed notebook tool to display cell content preview with line counts
- Changed ask tool result to show checkbox-style selection indicators
- Changed output tool to include provenance metadata and content previews for retrieved outputs
- Changed collapsed tool views to show consistent "Ctrl+O to expand" hints with remaining item counts
- Changed Biome integration to use CLI instead of LSP to avoid stale diagnostics issues
- Changed hardcoded UI symbols throughout codebase to use theme-configurable glyphs
- Changed tree drawing characters to use theme-defined box-drawing symbols
- Changed status line rendering to support left/right segment positioning with separators
- Changed hardcoded UI symbols to use theme-configurable glyphs throughout the interface
- Changed tree drawing characters to use theme-defined box-drawing symbols
- Changed CLI image attachments to resize if larger than 2048px (fit within 1920x1080) and convert >2MB images to JPEG

### Removed

- Removed custom renderers for ls, find, and grep tools in favor of generic tool display

### Fixed

- Fixed spinner animation crash when spinner frames array is empty by adding length check
- Fixed session persistence to properly await all queued writes before closing or switching sessions
- Fixed session persistence to truncate oversized content blocks before writing to prevent memory exhaustion
- Fixed extension list and inspector panel to use correct symbols for disabled and shadowed states instead of reusing unrelated status icons
- Fixed token counting for subagent progress to handle different usage object formats (camelCase and snake_case)
- Fixed image file handling by adding 20MB size limit to prevent memory issues during serialization
- Fixed session persistence to truncate oversized entries before writing JSONL to prevent out-of-memory errors

## [3.14.0] - 2026-01-04

### Added

- Added `getUsageStatistics()` method to SessionManager for tracking cumulative token usage and costs across session messages

### Changed

- Changed status line to display usage statistics more efficiently by using centralized session statistics instead of recalculating from entries

## [3.9.1337] - 2026-01-04

### Changed

- Changed default for `lsp.formatOnWrite` setting from `true` to `false`
- Updated status line thinking level display to use emoji icons instead of abbreviated text
- Changed auto-compact indicator from "(auto)" text to icon

### Fixed

- Fixed status line not updating token counts and cost after starting a new session
- Fixed stale diagnostics persisting after file content changes in LSP client

## [3.8.1337] - 2026-01-04

### Added

- Added automatic browser opening after exporting session to HTML
- Added automatic browser opening after sharing session as a Gist

### Fixed

- Fixed session titles not persisting to file when set before first flush

## [3.7.1337] - 2026-01-04

### Added

- Added `EditMatchError` class for structured error handling in edit operations
- Added `utils` module export with `once` and `untilAborted` helper functions
- Added in-memory LSP content sync via `syncContent` and `notifySaved` client methods

### Changed

- Refactored LSP integration to use writethrough callbacks for edit and write tools, improving performance by syncing content in-memory before disk writes
- Simplified FileDiagnosticsResult interface with renamed fields: `diagnostics` → `messages`, `hasErrors` → `errored`, `serverName` → `server`
- Session title generation now triggers before sending the first message rather than after agent work begins

### Fixed

- Fixed potential text decoding issues in bash executor by using streaming TextDecoder instead of Buffer.toString()

## [3.5.1337] - 2026-01-03

### Added

- Added session header and footer output in text mode showing version, model, provider, thinking level, and session ID
- Added Extension Control Center dashboard accessible via `/extensions` command for unified management of all providers and extensions
- Added ability to enable/disable individual extensions with persistent settings
- Added three-column dashboard layout with sidebar tree, extension list, and inspector panel
- Added fuzzy search filtering for extensions in the dashboard
- Added keyboard navigation with Tab to cycle panes, j/k for navigation, Space to toggle, Enter to expand/collapse

### Changed

- Redesigned Extension Control Center from 3-column layout to tabbed interface with horizontal provider tabs and 2-column grid
- Replaced sidebar tree navigation with provider tabs using TAB/Shift+TAB cycling

### Fixed

- Fixed title generation flag not resetting when starting a new session

## [3.4.1337] - 2026-01-03

### Added

- Added Time Traveling Stream Rules (TTSR) feature that monitors agent output for pattern matches and injects rule reminders mid-stream
- Added `ttsr_trigger` frontmatter field for rules to define regex patterns that trigger mid-stream injection
- Added TTSR settings for enabled state, context mode (keep/discard partial output), and repeat mode (once/after-gap)

### Fixed

- Fixed excessive subprocess spawns by caching git status for 1 second in the footer component

## [3.3.1337] - 2026-01-03

### Changed

- Improved `/status` command output formatting to use consistent column alignment across all sections
- Updated version update notification to suggest `omp update` instead of manual npm install command

## [3.1.1337] - 2026-01-03

### Added

- Added `spawns` frontmatter field for agent definitions to control which sub-agents can be spawned
- Added spawn restriction enforcement preventing agents from spawning unauthorized sub-agents

### Fixed

- Fixed duplicate skill loading when the same SKILL.md file was discovered through multiple paths

## [3.0.1337] - 2026-01-03

### Added

- Added unified capability-based discovery system for loading configuration from multiple AI coding tools (Claude Code, Cursor, Windsurf, Gemini, Codex, Cline, GitHub Copilot, VS Code)
- Added support for discovering MCP servers, rules, skills, hooks, tools, slash commands, prompts, and context files from tool-specific config directories
- Added Discovery settings tab in interactive mode to enable/disable individual configuration providers
- Added provider source attribution showing which tool contributed each configuration item
- Added support for Cursor MDC rule format with frontmatter (description, globs, alwaysApply)
- Added support for Windsurf rules from .windsurf/rules/\*.md and global_rules.md
- Added support for Cline rules from .clinerules file or directory
- Added support for GitHub Copilot instructions with applyTo glob patterns
- Added support for Gemini extensions and system.md customization files
- Added support for Codex AGENTS.md and config.toml settings
- Added automatic migration of `PI_*` environment variables to `OMP_*` equivalents for backwards compatibility
- Added multi-path config discovery supporting `.omp`, `.pi`, and `.claude` directories with priority ordering
- Added `getConfigDirPaths()`, `findConfigFile()`, and `readConfigFile()` functions for unified config resolution
- Added documentation for config module usage patterns

### Changed

- Changed MCP tool name parsing to use last underscore separator for better server name handling
- Changed /config output to show provider attribution for discovered items
- Renamed CLI binary from `pi` to `omp` and updated all command references
- Changed config directory from `.pi` to `.omp` with fallback support for legacy paths
- Renamed environment variables from `PI_*` to `OMP_*` prefix (e.g., `OMP_SMOL_MODEL`, `OMP_SLOW_MODEL`)
- Changed model role alias prefix from `pi/` to `omp/` (e.g., `omp/slow` instead of `pi/slow`)

## [2.1.1337] - 2026-01-03

### Added

- Added `omp update` command to check for and install updates from GitHub releases or via bun

### Changed

- Changed HTML export to use compile-time bundled templates via Bun macros for improved performance
- Changed `exportToHtml` and `exportFromFile` functions to be async
- Simplified build process by embedding assets (themes, templates, agents, commands) directly into the binary at compile time
- Removed separate asset copying steps from build scripts

## [2.0.1337] - 2026-01-03

### Added

- Added shell environment snapshot to preserve user aliases, functions, and shell options when executing bash commands
- Added support for `OMP_BASH_NO_CI`, `OMP_BASH_NO_LOGIN`, and `OMP_SHELL_PREFIX` environment variables for shell customization
- Added zsh support alongside bash for shell detection and configuration

### Changed

- Changed shell detection to prefer user's `$SHELL` when it's bash or zsh, with improved fallback path resolution
- Changed Edit tool to reject `.ipynb` files with guidance to use NotebookEdit tool instead

## [1.500.0] - 2026-01-03

### Added

- Added provider tabs to model selector with Tab/Arrow navigation for filtering models by provider
- Added context menu to model selector for choosing model role (Default, Smol, Slow) instead of keyboard shortcuts
- Added LSP diagnostics display in tool execution output showing errors and warnings after file edits
- Added centralized file logger with daily rotation to `~/.omp/logs/` for debugging production issues
- Added `logger` property to hook and custom tool APIs for error/warning/debug logging
- Added `output` tool to read full agent/task outputs by ID when truncated previews are insufficient
- Added `task` tool to reviewer agent, enabling parallel exploration of large codebases during reviews
- Added subprocess tool registry for extracting and rendering tool data from subprocess agents in real-time
- Added combined review result rendering showing verdict and findings in a tree structure
- Auto-read file mentions: Reference files with `@path/to/file.ext` syntax in prompts to automatically inject their contents, eliminating manual Read tool calls
- Added `hidden` property for custom tools to exclude them from default tool list unless explicitly requested
- Added `explicitTools` option to `createAgentSession` for enabling hidden tools by name
- Added example review tools (`report_finding`, `submit_review`) with structured findings accumulation and verdict rendering
- Added `/review` example command for interactive code review with branch comparison, uncommitted changes, and commit review modes
- Custom TypeScript slash commands: Create programmable commands at `~/.omp/agent/commands/[name]/index.ts` or `.omp/commands/[name]/index.ts`. Commands export a factory returning `{ name, description, execute(args, ctx) }`. Return a string to send as LLM prompt, or void for fire-and-forget actions. Full access to `HookCommandContext` for UI dialogs, session control, and shell execution.
- Claude command directories: Markdown slash commands now also load from `~/.claude/commands/` and `.claude/commands/` (parallel to existing `.omp/commands/` support)
- `commands.enableClaudeUser` and `commands.enableClaudeProject` settings to disable Claude command directory loading
- `/export --copy` option to copy entire session as formatted text to clipboard

### Changed

- Changed model selector keyboard shortcuts from S/L keys to a context menu opened with Enter
- Changed model role indicators from symbols (✓ ⚡ 🧠) to labeled badges ([ DEFAULT ] [ SMOL ] [ SLOW ])
- Changed model list sorting to include secondary sort by model ID within each provider
- Changed silent error suppression to log warnings and debug info for tool errors, theme loading, and command loading failures
- Changed Task tool progress display to show agent index (e.g., `reviewer(0)`) for easier Output tool ID derivation
- Changed Task tool output to only include file paths when Output tool is unavailable, providing Read tool fallback
- Changed Task tool output references to use simpler ID format (e.g., `reviewer_0`) with line/char counts for Output tool integration
- Changed subagent recursion prevention from blanket blocking to same-agent blocking. Non-recursive agents can now spawn other agent types (e.g., reviewer can spawn explore agents) but cannot spawn themselves.
- Changed `/review` command from markdown to interactive TypeScript with mode selection menu (branch comparison, uncommitted changes, commit review, custom)
- Changed bundled commands to be overridable by user/project commands with same name
- Changed subprocess termination to wait for message_end event to capture accurate token counts
- Changed token counting in subprocess to accumulate across messages instead of overwriting
- Updated bundled `reviewer` agent to use structured review tools with priority-based findings (P0-P3) and formal verdict submission
- Task tool now streams artifacts in real-time: input written before spawn, session jsonl written by subprocess, output written at completion

### Removed

- Removed separate Exa error logger in favor of centralized logging system
- Removed `findings_count` parameter from `submit_review` tool - findings are now counted automatically
- Removed artifacts location display from task tool output

### Fixed

- Fixed race condition in event listener iteration by copying array before iteration to prevent mutation during callbacks
- Fixed potential memory leak from orphaned abort controllers by properly aborting existing controllers before replacement
- Fixed stream reader resource leak by adding proper `releaseLock()` calls in finally blocks
- Fixed hook API methods throwing clear errors when handlers are not initialized instead of silently failing
- Fixed LSP client race conditions with concurrent client creation and file operations using proper locking
- Fixed Task tool progress display showing stale data by cloning progress objects before passing to callbacks
- Fixed Task tool missing final progress events by waiting for readline to close before resolving
- Fixed RPC mode race condition with concurrent prompt commands by serializing execution
- Fixed pre-commit hook race condition causing `index.lock` errors when GitKraken/IDE git integrations detect file changes during formatting
- Fixed Task tool output artifacts (`out.md`) containing duplicated text from streaming updates
- Fixed Task tool progress display showing repeated nearly-identical lines during streaming
- Fixed Task tool subprocess model selection ignoring agent's configured model and falling back to settings default. The `--model` flag now accepts `provider/model` format directly.
- Fixed Task tool showing "done + succeeded" when aborted; now correctly displays "⊘ aborted" status

## [1.341.0] - 2026-01-03

### Added

- Added interruptMode setting to control when queued messages are processed during tool execution.
- Implemented getter and setter methods in SettingsManager for interrupt mode persistence.
- Exposed interruptMode configuration in interactive settings UI with immediate/wait options.
- Wired interrupt mode through AgentSession and SDK to enable runtime configuration.
- Model roles: Configure different models for different purposes (default, smol, slow) via `/model` selector
- Model selector key bindings: Enter sets default, S sets smol, L sets slow, Escape closes
- Model selector shows role markers: ✓ for default, ⚡ for smol, 🧠 for slow
- `pi/<role>` model aliases in Task tool agent definitions (e.g., `model: pi/smol, haiku, flash, mini`)
- Smol model auto-discovery using priority chain: haiku > flash > mini
- Slow model auto-discovery using priority chain: gpt-5.2-codex > codex > gpt > opus > pro
- CLI args for model roles: `--smol <model>` and `--slow <model>` (ephemeral, not persisted)
- Env var overrides: `OMP_SMOL_MODEL` and `OMP_SLOW_MODEL`
- Title generation now uses configured smol model from settings
- LSP diagnostics on edit: Edit tool can now return LSP diagnostics after editing code files. Disabled by default to avoid noise during multi-edit sequences. Enable via `lsp.diagnosticsOnEdit` setting.
- LSP workspace diagnostics: New `lsp action=workspace_diagnostics` command checks the entire project for errors. Auto-detects project type and uses appropriate checker (rust-analyzer/cargo for Rust, tsc for TypeScript, go build for Go, pyright for Python).
- LSP local binary resolution: LSP servers installed in project-local directories are now discovered automatically. Checks `node_modules/.bin/` for Node.js projects, `.venv/bin/`/`venv/bin/` for Python projects, and `vendor/bundle/bin/` for Ruby projects before falling back to `$PATH`.
- LSP format on write: Write tool now automatically formats code files using LSP after writing. Uses the language server's built-in formatter (e.g., rustfmt for Rust, gofmt for Go). Controlled via `lsp.formatOnWrite` setting (enabled by default).
- LSP diagnostics on write: Write tool now returns LSP diagnostics (errors/warnings) after writing code files. This gives immediate feedback on syntax errors and type issues. Controlled via `lsp.diagnosticsOnWrite` setting (enabled by default).
- LSP server warmup at startup: LSP servers are now started at launch to avoid cold-start delays when first writing files.
- LSP server status in welcome banner: Shows which language servers are active and ready.
- Edit fuzzy match setting: Added `edit.fuzzyMatch` setting (enabled by default) to control whether the edit tool accepts high-confidence fuzzy matches for whitespace/indentation differences. Toggle via `/settings`.
- Multi-server LSP diagnostics: Diagnostics now query all applicable language servers for a file type. For TypeScript/JavaScript projects with Biome, this means both type errors (from tsserver) and lint errors (from Biome) are reported together.
- Comprehensive LSP server configurations for 40+ languages including Rust, Go, Python, Java, Kotlin, Scala, Haskell, OCaml, Elixir, Ruby, PHP, C#, Lua, Nix, and many more. Each server includes sensible defaults for args, settings, and init options.
- Extended LSP config file search paths: Now searches for `lsp.json`, `.lsp.json` in project root and `.omp/` subdirectory, plus user-level configs in `~/.omp/` and home directory.

### Changed

- LSP settings moved to dedicated "LSP" tab in `/settings` for better organization
- Improved grep tool description to document pagination options (`headLimit`, `offset`) and clarify recursive search behavior
- LSP idle timeout now disabled by default. Configure via `idleTimeoutMs` in lsp.json to auto-shutdown inactive servers.
- Model settings now use role-based storage (`modelRoles` map) instead of single `defaultProvider`/`defaultModel` fields. Supports multiple model roles (default, small, etc.)
- Session model persistence now uses `"provider/modelId"` string format with optional role field

### Fixed

- Recent sessions now show in welcome banner (was never wired up).
- Auto-generated session titles: Sessions are now automatically titled based on the first message using a small model (Haiku/GPT-4o-mini/Flash). Titles are shown in the terminal window title, recent sessions list, and --resume picker. The resume picker shows title with dimmed first message preview below.

## [1.340.0] - 2026-01-03

### Changed

- Replaced vendored highlight.js and marked.js with CDN-hosted versions for smaller exports
- Added runtime minification for HTML, CSS, and JS in session exports
- Session share URL now uses gistpreview.github.io instead of shittycodingagent.ai

## [1.339.0] - 2026-01-03

### Added

- MCP project config setting to disable loading `.mcp.json`/`mcp.json` from project root
- Support for both `mcp.json` and `.mcp.json` filenames (prefers `mcp.json` if both exist)
- Automatic Exa MCP server filtering with API key extraction for native integration

## [1.338.0] - 2026-01-03

### Added

- Bash interceptor setting to block shell commands that have dedicated tools (disabled by default, enable via `/settings`)

### Changed

- Refactored settings UI to declarative definitions for easier maintenance
- Shell detection now respects `$SHELL` environment variable before falling back to bash/sh
- Tool binary detection now uses `Bun.which()` instead of spawning processes

### Fixed

- CLI help text now accurately lists all default tools

## [1.337.1] - 2026-01-02

### Added

- MCP support and plugin system for external tool integration
- Git context to system prompt for repo awareness
- Bash interception to guide tool selection
- Fuzzy matching to handle indentation variance in edit tool
- Specialized Exa tools with granular toggles
- `/share` command for exporting conversations to HTML
- Edit diff preview before tool execution

### Changed

- Renamed package scope to @oh-my-pi for consistent branding
- Simplified toolset and enhanced navigation
- Improved process cleanup with tree kill
- Updated CI/CD workflows for GitHub Actions with provenance-signed npm publishing

### Fixed

- Template string interpolation in image read output
- Prevented full re-renders during write tool streaming
- Edit tool failing on files with UTF-8 BOM

## [1.337.0] - 2026-01-02

Initial release under @oh-my-pi scope. See previous releases at [badlogic/pi-mono](https://github.com/badlogic/pi-mono).

## [0.31.1] - 2026-01-02

### Fixed

- Model selector no longer allows negative index when pressing arrow keys before models finish loading ([#398](https://github.com/badlogic/pi-mono/pull/398) by [@mitsuhiko](https://github.com/mitsuhiko))
- Type guard functions (`isBashToolResult`, etc.) now exported at runtime, not just in type declarations ([#397](https://github.com/badlogic/pi-mono/issues/397))

## [0.31.0] - 2026-01-02

This release introduces session trees for in-place branching, major API changes to hooks and custom tools, and structured compaction with file tracking.

### Session Tree

Sessions now use a tree structure with `id`/`parentId` fields. This enables in-place branching: navigate to any previous point with `/tree`, continue from there, and switch between branches while preserving all history in a single file.

**Existing sessions are automatically migrated** (v1 → v2) on first load. No manual action required.

New entry types: `BranchSummaryEntry` (context from abandoned branches), `CustomEntry` (hook state), `CustomMessageEntry` (hook-injected messages), `LabelEntry` (bookmarks).

See [docs/session.md](docs/session.md) for the file format and `SessionManager` API.

### Hooks Migration

The hooks API has been restructured with more granular events and better session access.

**Type renames:**

- `HookEventContext` → `HookContext`
- `HookCommandContext` is now a new interface extending `HookContext` with session control methods

**Event changes:**

- The monolithic `session` event is now split into granular events: `session_start`, `session_before_switch`, `session_switch`, `session_before_branch`, `session_branch`, `session_before_compact`, `session_compact`, `session_shutdown`
- `session_before_switch` and `session_switch` events now include `reason: "new" | "resume"` to distinguish between `/new` and `/resume`
- New `session_before_tree` and `session_tree` events for `/tree` navigation (hook can provide custom branch summary)
- New `before_agent_start` event: inject messages before the agent loop starts
- New `context` event: modify messages non-destructively before each LLM call
- Session entries are no longer passed in events. Use `ctx.sessionManager.getEntries()` or `ctx.sessionManager.getBranch()` instead

**API changes:**

- `pi.send(text, attachments?)` → `pi.sendMessage(message, triggerTurn?)` (creates `CustomMessageEntry`)
- New `pi.appendEntry(customType, data?)` for hook state persistence (not in LLM context)
- New `pi.registerCommand(name, options)` for custom slash commands (handler receives `HookCommandContext`)
- New `pi.registerMessageRenderer(customType, renderer)` for custom TUI rendering
- New `ctx.isIdle()`, `ctx.abort()`, `ctx.hasQueuedMessages()` for agent state (available in all events)
- New `ctx.ui.editor(title, prefill?)` for multi-line text editing with Ctrl+G external editor support
- New `ctx.ui.custom(component)` for full TUI component rendering with keyboard focus
- New `ctx.ui.setStatus(key, text)` for persistent status text in footer (multiple hooks can set their own)
- New `ctx.ui.theme` getter for styling text with theme colors
- `ctx.exec()` moved to `pi.exec()`
- `ctx.sessionFile` → `ctx.sessionManager.getSessionFile()`
- New `ctx.modelRegistry` and `ctx.model` for API key resolution

**HookCommandContext (slash commands only):**

- `ctx.waitForIdle()` - wait for agent to finish streaming
- `ctx.newSession(options?)` - create new sessions with optional setup callback
- `ctx.branch(entryId)` - branch from a specific entry
- `ctx.navigateTree(targetId, options?)` - navigate the session tree

These methods are only on `HookCommandContext` (not `HookContext`) because they can deadlock if called from event handlers that run inside the agent loop.

**Removed:**

- `hookTimeout` setting (hooks no longer have timeouts; use Ctrl+C to abort)
- `resolveApiKey` parameter (use `ctx.modelRegistry.getApiKey(model)`)

See [docs/hooks.md](docs/hooks.md) and [examples/hooks/](examples/hooks/) for the current API.

### Custom Tools Migration

The custom tools API has been restructured to mirror the hooks pattern with a context object.

**Type renames:**

- `CustomAgentTool` → `CustomTool`
- `ToolAPI` → `CustomToolAPI`
- `ToolContext` → `CustomToolContext`
- `ToolSessionEvent` → `CustomToolSessionEvent`

**Execute signature changed:**

```typescript
// Before (v0.30.2)
execute(toolCallId, params, signal, onUpdate)

// After
execute(toolCallId, params, onUpdate, ctx, signal?)
```

The new `ctx: CustomToolContext` provides `sessionManager`, `modelRegistry`, `model`, and agent state methods:

- `ctx.isIdle()` - check if agent is streaming
- `ctx.hasQueuedMessages()` - check if user has queued messages (skip interactive prompts)
- `ctx.abort()` - abort current operation (fire-and-forget)

**Session event changes:**

- `CustomToolSessionEvent` now only has `reason` and `previousSessionFile`
- Session entries are no longer in the event. Use `ctx.sessionManager.getBranch()` or `ctx.sessionManager.getEntries()` to reconstruct state
- Reasons: `"start" | "switch" | "branch" | "tree" | "shutdown"` (no separate `"new"` reason; `/new` triggers `"switch"`)
- `dispose()` method removed. Use `onSession` with `reason: "shutdown"` for cleanup

See [docs/custom-tools.md](docs/custom-tools.md) and [examples/custom-tools/](examples/custom-tools/) for the current API.

### SDK Migration

**Type changes:**

- `CustomAgentTool` → `CustomTool`
- `AppMessage` → `AgentMessage`
- `sessionFile` returns `string | undefined` (was `string | null`)
- `model` returns `Model | undefined` (was `Model | null`)
- `Attachment` type removed. Use `ImageContent` from `@oh-my-pi/pi-ai` instead. Add images directly to message content arrays.

**AgentSession API:**

- `branch(entryIndex: number)` → `branch(entryId: string)`
- `getUserMessagesForBranching()` returns `{ entryId, text }` instead of `{ entryIndex, text }`
- `reset()` → `newSession(options?)` where options has optional `parentSession` for lineage tracking
- `newSession()` and `switchSession()` now return `Promise<boolean>` (false if cancelled by hook)
- New `navigateTree(targetId, options?)` for in-place tree navigation

**Hook integration:**

- New `sendHookMessage(message, triggerTurn?)` for hook message injection

**SessionManager API:**

- Method renames: `saveXXX()` → `appendXXX()` (e.g., `appendMessage`, `appendCompaction`)
- `branchInPlace()` → `branch()`
- `reset()` → `newSession(options?)` with optional `parentSession` for lineage tracking
- `createBranchedSessionFromEntries(entries, index)` → `createBranchedSession(leafId)`
- `SessionHeader.branchedFrom` → `SessionHeader.parentSession`
- `saveCompaction(entry)` → `appendCompaction(summary, firstKeptEntryId, tokensBefore, details?)`
- `getEntries()` now excludes the session header (use `getHeader()` separately)
- `getSessionFile()` returns `string | undefined` (undefined for in-memory sessions)
- New tree methods: `getTree()`, `getBranch()`, `getLeafId()`, `getLeafEntry()`, `getEntry()`, `getChildren()`, `getLabel()`
- New append methods: `appendCustomEntry()`, `appendCustomMessageEntry()`, `appendLabelChange()`
- New branch methods: `branch(entryId)`, `branchWithSummary()`

**ModelRegistry (new):**

`ModelRegistry` is a new class that manages model discovery and API key resolution. It combines built-in models with custom models from `models.json` and resolves API keys via `AuthStorage`.

```typescript
import { discoverAuthStorage, discoverModels } from "@oh-my-pi/pi-coding-agent";

const authStorage = discoverAuthStorage(); // ~/.omp/agent/auth.json
const modelRegistry = discoverModels(authStorage); // + ~/.omp/agent/models.json

// Get all models (built-in + custom)
const allModels = modelRegistry.getAll();

// Get only models with valid API keys
const available = await modelRegistry.getAvailable();

// Find specific model
const model = modelRegistry.find("anthropic", "claude-sonnet-4-20250514");

// Get API key for a model
const apiKey = await modelRegistry.getApiKey(model);
```

This replaces the old `resolveApiKey` callback pattern. Hooks and custom tools access it via `ctx.modelRegistry`.

**Renamed exports:**

- `messageTransformer` → `convertToLlm`
- `SessionContext` alias `LoadedSession` removed

See [docs/sdk.md](docs/sdk.md) and [examples/sdk/](examples/sdk/) for the current API.

### RPC Migration

**Session commands:**

- `reset` command → `new_session` command with optional `parentSession` field

**Branching commands:**

- `branch` command: `entryIndex` → `entryId`
- `get_branch_messages` response: `entryIndex` → `entryId`

**Type changes:**

- Messages are now `AgentMessage` (was `AppMessage`)
- `prompt` command: `attachments` field replaced with `images` field using `ImageContent` format

**Compaction events:**

- `auto_compaction_start` now includes `reason` field (`"threshold"` or `"overflow"`)
- `auto_compaction_end` now includes `willRetry` field
- `compact` response includes full `CompactionResult` (`summary`, `firstKeptEntryId`, `tokensBefore`, `details`)

See [docs/rpc.md](docs/rpc.md) for the current protocol.

### Structured Compaction

Compaction and branch summarization now use a structured output format:

- Clear sections: Goal, Progress, Key Information, File Operations
- File tracking: `readFiles` and `modifiedFiles` arrays in `details`, accumulated across compactions
- Conversations are serialized to text before summarization to prevent the model from "continuing" them

The `before_compact` and `before_tree` hook events allow custom compaction implementations. See [docs/compaction.md](docs/compaction.md).

### Interactive Mode

**`/tree` command:**

- Navigate the full session tree in-place
- Search by typing, page with ←/→
- Filter modes (Ctrl+O): default → no-tools → user-only → labeled-only → all
- Press `l` to label entries as bookmarks
- Selecting a branch switches context and optionally injects a summary of the abandoned branch

**Entry labels:**

- Bookmark any entry via `/tree` → select → `l`
- Labels appear in tree view and persist as `LabelEntry`

**Theme changes (breaking for custom themes):**

Custom themes must add these new color tokens or they will fail to load:

- `selectedBg`: background for selected/highlighted items in tree selector and other components
- `customMessageBg`: background for hook-injected messages (`CustomMessageEntry`)
- `customMessageText`: text color for hook messages
- `customMessageLabel`: label color for hook messages (the `[customType]` prefix)

Total color count increased from 46 to 50. See [docs/theme.md](docs/theme.md) for the full color list and copy values from the built-in dark/light themes.

**Settings:**

- `enabledModels`: allowlist models in `settings.json` (same format as `--models` CLI)

### Added

- `ctx.ui.setStatus(key, text)` for hooks to display persistent status text in the footer ([#385](https://github.com/badlogic/pi-mono/pull/385) by [@prateekmedia](https://github.com/prateekmedia))
- `ctx.ui.theme` getter for styling status text and other output with theme colors
- `/share` command to upload session as a secret GitHub gist and get a shareable URL via shittycodingagent.ai ([#380](https://github.com/badlogic/pi-mono/issues/380))
- HTML export now includes a tree visualization sidebar for navigating session branches ([#375](https://github.com/badlogic/pi-mono/issues/375))
- HTML export supports keyboard shortcuts: Ctrl+T to toggle thinking blocks, Ctrl+O to toggle tool outputs
- HTML export supports theme-configurable background colors via optional `export` section in theme JSON ([#387](https://github.com/badlogic/pi-mono/pull/387) by [@mitsuhiko](https://github.com/mitsuhiko))
- HTML export syntax highlighting now uses theme colors and matches TUI rendering
- **Snake game example hook**: Demonstrates `ui.custom()`, `registerCommand()`, and session persistence. See [examples/hooks/snake.ts](examples/hooks/snake.ts).
- **`thinkingText` theme token**: Configurable color for thinking block text. ([#366](https://github.com/badlogic/pi-mono/pull/366) by [@paulbettner](https://github.com/paulbettner))

### Changed

- **Entry IDs**: Session entries now use short 8-character hex IDs instead of full UUIDs
- **API key priority**: `ANTHROPIC_OAUTH_TOKEN` now takes precedence over `ANTHROPIC_API_KEY`
- HTML export template split into separate files (template.html, template.css, template.js) for easier maintenance

### Fixed

- HTML export now properly sanitizes user messages containing HTML tags like `<style>` that could break DOM rendering
- Crash when displaying bash output containing Unicode format characters like U+0600-U+0604 ([#372](https://github.com/badlogic/pi-mono/pull/372) by [@HACKE-RC](https://github.com/HACKE-RC))
- **Footer shows full session stats**: Token usage and cost now include all messages, not just those after compaction. ([#322](https://github.com/badlogic/pi-mono/issues/322))
- **Status messages spam chat log**: Rapidly changing settings (e.g., thinking level via Shift+Tab) would add multiple status lines. Sequential status updates now coalesce into a single line. ([#365](https://github.com/badlogic/pi-mono/pull/365) by [@paulbettner](https://github.com/paulbettner))
- **Toggling thinking blocks during streaming shows nothing**: Pressing Ctrl+T while streaming would hide the current message until streaming completed.
- **Resuming session resets thinking level to off**: Initial model and thinking level were not saved to session file, causing `--resume`/`--continue` to default to `off`. ([#342](https://github.com/badlogic/pi-mono/issues/342) by [@aliou](https://github.com/aliou))
- **Hook `tool_result` event ignores errors from custom tools**: The `tool_result` hook event was never emitted when tools threw errors, and always had `isError: false` for successful executions. Now emits the event with correct `isError` value in both success and error cases. ([#374](https://github.com/badlogic/pi-mono/issues/374) by [@nicobailon](https://github.com/nicobailon))
- **Edit tool fails on Windows due to CRLF line endings**: Files with CRLF line endings now match correctly when LLMs send LF-only text. Line endings are normalized before matching and restored to original style on write. ([#355](https://github.com/badlogic/pi-mono/issues/355) by [@Pratham-Dubey](https://github.com/Pratham-Dubey))
- **Edit tool fails on files with UTF-8 BOM**: Files with UTF-8 BOM marker could cause "text not found" errors since the LLM doesn't include the invisible BOM character. BOM is now stripped before matching and restored on write. ([#394](https://github.com/badlogic/pi-mono/pull/394) by [@prathamdby](https://github.com/prathamdby))
- **Use bash instead of sh on Unix**: Fixed shell commands using `/bin/sh` instead of `/bin/bash` on Unix systems. ([#328](https://github.com/badlogic/pi-mono/pull/328) by [@dnouri](https://github.com/dnouri))
- **OAuth login URL clickable**: Made OAuth login URLs clickable in terminal. ([#349](https://github.com/badlogic/pi-mono/pull/349) by [@Cursivez](https://github.com/Cursivez))
- **Improved error messages**: Better error messages when `apiKey` or `model` are missing. ([#346](https://github.com/badlogic/pi-mono/pull/346) by [@ronyrus](https://github.com/ronyrus))
- **Session file validation**: `findMostRecentSession()` now validates session headers before returning, preventing non-session JSONL files from being loaded
- **Compaction error handling**: `generateSummary()` and `generateTurnPrefixSummary()` now throw on LLM errors instead of returning empty strings
- **Compaction with branched sessions**: Fixed compaction incorrectly including entries from abandoned branches, causing token overflow errors. Compaction now uses `sessionManager.getPath()` to work only on the current branch path, eliminating 80+ lines of duplicate entry collection logic between `prepareCompaction()` and `compact()`
- **enabledModels glob patterns**: `--models` and `enabledModels` now support glob patterns like `github-copilot/*` or `*sonnet*`. Previously, patterns were only matched literally or via substring search. ([#337](https://github.com/badlogic/pi-mono/issues/337))

## [0.30.2] - 2025-12-26

### Changed

- **Consolidated migrations**: Moved auth migration from `AuthStorage.migrateLegacy()` to new `migrations.ts` module.

## [0.30.1] - 2025-12-26

### Fixed

- **Sessions saved to wrong directory**: In v0.30.0, sessions were being saved to `~/.omp/agent/` instead of `~/.omp/agent/sessions/<encoded-cwd>/`, breaking `--resume` and `/resume`. Misplaced sessions are automatically migrated on startup. ([#320](https://github.com/badlogic/pi-mono/issues/320) by [@aliou](https://github.com/aliou))
- **Custom system prompts missing context**: When using a custom system prompt string, project context files (AGENTS.md), skills, date/time, and working directory were not appended. ([#321](https://github.com/badlogic/pi-mono/issues/321))

## [0.30.0] - 2025-12-25

### Breaking Changes

- **SessionManager API**: The second parameter of `create()`, `continueRecent()`, and `list()` changed from `agentDir` to `sessionDir`. When provided, it specifies the session directory directly (no cwd encoding). When omitted, uses default (`~/.omp/agent/sessions/<encoded-cwd>/`). `open()` no longer takes `agentDir`. ([#313](https://github.com/badlogic/pi-mono/pull/313))

### Added

- **`--session-dir` flag**: Use a custom directory for sessions instead of the default `~/.omp/agent/sessions/<encoded-cwd>/`. Works with `-c` (continue) and `-r` (resume) flags. ([#313](https://github.com/badlogic/pi-mono/pull/313) by [@scutifer](https://github.com/scutifer))
- **Reverse model cycling and model selector**: Shift+Ctrl+P cycles models backward, Ctrl+L opens model selector (retaining text in editor). ([#315](https://github.com/badlogic/pi-mono/pull/315) by [@mitsuhiko](https://github.com/mitsuhiko))

## [0.29.1] - 2025-12-25

### Added

- **Automatic custom system prompt loading**: OMP now auto-loads `SYSTEM.md` files to replace the default system prompt. Project-local `.omp/SYSTEM.md` takes precedence over global `~/.omp/agent/SYSTEM.md`. CLI `--system-prompt` flag overrides both. ([#309](https://github.com/badlogic/pi-mono/issues/309))
- **Unified `/settings` command**: New settings menu consolidating thinking level, theme, queue mode, auto-compact, show images, hide thinking, and collapse changelog. Replaces individual `/thinking`, `/queue`, `/theme`, `/autocompact`, and `/show-images` commands. ([#310](https://github.com/badlogic/pi-mono/issues/310))

### Fixed

- **Custom tools/hooks with typebox subpath imports**: Fixed jiti alias for `@sinclair/typebox` to point to package root instead of entry file, allowing imports like `@sinclair/typebox/compiler` to resolve correctly. ([#311](https://github.com/badlogic/pi-mono/issues/311) by [@kim0](https://github.com/kim0))

## [0.29.0] - 2025-12-25

### Breaking Changes

- **Renamed `/clear` to `/new`**: The command to start a fresh session is now `/new`. Hook event reasons `before_clear`/`clear` are now `before_new`/`new`. Merry Christmas [@mitsuhiko](https://github.com/mitsuhiko)! ([#305](https://github.com/badlogic/pi-mono/pull/305))

### Added

- **Auto-space before pasted file paths**: When pasting a file path (starting with `/`, `~`, or `.`) after a word character, a space is automatically prepended. ([#307](https://github.com/badlogic/pi-mono/pull/307) by [@mitsuhiko](https://github.com/mitsuhiko))
- **Word navigation in input fields**: Added Ctrl+Left/Right and Alt+Left/Right for word-by-word cursor movement. ([#306](https://github.com/badlogic/pi-mono/pull/306) by [@kim0](https://github.com/kim0))
- **Full Unicode input**: Input fields now accept Unicode characters beyond ASCII. ([#306](https://github.com/badlogic/pi-mono/pull/306) by [@kim0](https://github.com/kim0))

### Fixed

- **Readline-style Ctrl+W**: Now skips trailing whitespace before deleting the preceding word, matching standard readline behavior. ([#306](https://github.com/badlogic/pi-mono/pull/306) by [@kim0](https://github.com/kim0))

## [0.28.0] - 2025-12-25

### Changed

- **Credential storage refactored**: API keys and OAuth tokens are now stored in `~/.omp/agent/auth.json` instead of `oauth.json` and `settings.json`. Existing credentials are automatically migrated on first run. ([#296](https://github.com/badlogic/pi-mono/issues/296))

- **SDK API changes** ([#296](https://github.com/badlogic/pi-mono/issues/296)):
  - Added `AuthStorage` class for credential management (API keys and OAuth tokens)
  - Added `ModelRegistry` class for model discovery and API key resolution
  - Added `discoverAuthStorage()` and `discoverModels()` discovery functions
  - `createAgentSession()` now accepts `authStorage` and `modelRegistry` options
  - Removed `configureOAuthStorage()`, `defaultGetApiKey()`, `findModel()`, `discoverAvailableModels()`
  - Removed `getApiKey` callback option (use `AuthStorage.setRuntimeApiKey()` for runtime overrides)
  - Use `getModel()` from `@oh-my-pi/pi-ai` for built-in models, `modelRegistry.find()` for custom models + built-in models
  - See updated [SDK documentation](docs/sdk.md) and [README](README.md)

- **Settings changes**: Removed `apiKeys` from `settings.json`. Use `auth.json` instead. ([#296](https://github.com/badlogic/pi-mono/issues/296))

### Fixed

- **Duplicate skill warnings for symlinks**: Skills loaded via symlinks pointing to the same file are now silently deduplicated instead of showing name collision warnings. ([#304](https://github.com/badlogic/pi-mono/pull/304) by [@mitsuhiko](https://github.com/mitsuhiko))

## [0.27.9] - 2025-12-24

### Fixed

- **Model selector and --list-models with settings.json API keys**: Models with API keys configured in settings.json (but not in environment variables) now properly appear in the /model selector and `--list-models` output. ([#295](https://github.com/badlogic/pi-mono/issues/295))

## [0.27.8] - 2025-12-24

### Fixed

- **API key priority**: OAuth tokens now take priority over settings.json API keys. Previously, an API key in settings.json would trump OAuth, causing users logged in with a plan (unlimited tokens) to be billed via PAYG instead.

## [0.27.7] - 2025-12-24

### Fixed

- **Thinking tag leakage**: Fixed Claude mimicking literal `</thinking>` tags in responses. Unsigned thinking blocks (from aborted streams) are now converted to plain text without `<thinking>` tags. The TUI still displays them as thinking blocks. ([#302](https://github.com/badlogic/pi-mono/pull/302) by [@nicobailon](https://github.com/nicobailon))

## [0.27.6] - 2025-12-24

### Added

- **Compaction hook improvements**: The `before_compact` session event now includes:
  - `previousSummary`: Summary from the last compaction (if any), so hooks can preserve accumulated context
  - `messagesToKeep`: Messages that will be kept after the summary (recent turns), in addition to `messagesToSummarize`
  - `resolveApiKey`: Function to resolve API keys for any model (checks settings, OAuth, env vars)
  - Removed `apiKey` string in favor of `resolveApiKey` for more flexibility

- **SessionManager API cleanup**:
  - Renamed `loadSessionFromEntries()` to `buildSessionContext()` (builds LLM context from entries, handling compaction)
  - Renamed `loadEntries()` to `getEntries()` (returns defensive copy of all session entries)
  - Added `buildSessionContext()` method to SessionManager

## [0.27.5] - 2025-12-24

### Added

- **HTML export syntax highlighting**: Code blocks in markdown and tool outputs (read, write) now have syntax highlighting using highlight.js with theme-aware colors matching the TUI.
- **HTML export improvements**: Render markdown server-side using marked (tables, headings, code blocks, etc.), honor user's chosen theme (light/dark), add image rendering for user messages, and style code blocks with TUI-like language markers. ([@scutifer](https://github.com/scutifer))

### Fixed

- **Ghostty inline images in tmux**: Fixed terminal detection for Ghostty when running inside tmux by checking `GHOSTTY_RESOURCES_DIR` env var. ([#299](https://github.com/badlogic/pi-mono/pull/299) by [@nicobailon](https://github.com/nicobailon))

## [0.27.4] - 2025-12-24

### Fixed

- **Symlinked skill directories**: Skills in symlinked directories (e.g., `~/.omp/agent/skills/my-skills -> /path/to/skills`) are now correctly discovered and loaded.

## [0.27.3] - 2025-12-24

### Added

- **API keys in settings.json**: Store API keys in `~/.omp/agent/settings.json` under the `apiKeys` field (e.g., `{ "apiKeys": { "anthropic": "sk-..." } }`). Settings keys take priority over environment variables. ([#295](https://github.com/badlogic/pi-mono/issues/295))

### Fixed

- **Allow startup without API keys**: Interactive mode no longer throws when no API keys are configured. Users can now start the agent and use `/login` to authenticate. ([#288](https://github.com/badlogic/pi-mono/issues/288))
- **`--system-prompt` file path support**: The `--system-prompt` argument now correctly resolves file paths (like `--append-system-prompt` already did). ([#287](https://github.com/badlogic/pi-mono/pull/287) by [@scutifer](https://github.com/scutifer))

## [0.27.2] - 2025-12-23

### Added

- **Skip conversation restore on branch**: Hooks can return `{ skipConversationRestore: true }` from `before_branch` to create the branched session file without restoring conversation messages. Useful for checkpoint hooks that restore files separately. ([#286](https://github.com/badlogic/pi-mono/pull/286) by [@nicobarray](https://github.com/nicobarray))

## [0.27.1] - 2025-12-22

### Fixed

- **Skill discovery performance**: Skip `node_modules` directories when recursively scanning for skills. Fixes ~60ms startup delay when skill directories contain npm dependencies.

### Added

- **Startup timing instrumentation**: Set `OMP_TIMING=1` to see startup performance breakdown (interactive mode only).

## [0.27.0] - 2025-12-22

### Breaking

- **Session hooks API redesign**: Merged `branch` event into `session` event. `BranchEvent`, `BranchEventResult` types and `pi.on("branch", ...)` removed. Use `pi.on("session", ...)` with `reason: "before_branch" | "branch"` instead. `AgentSession.branch()` returns `{ cancelled }` instead of `{ skipped }`. `AgentSession.reset()` and `switchSession()` now return `boolean` (false if cancelled by hook). RPC commands `reset`, `switch_session`, and `branch` now include `cancelled` in response data. ([#278](https://github.com/badlogic/pi-mono/issues/278))

### Added

- **Session lifecycle hooks**: Added `before_*` variants (`before_switch`, `before_clear`, `before_branch`) that fire before actions and can be cancelled with `{ cancel: true }`. Added `shutdown` reason for graceful exit handling. ([#278](https://github.com/badlogic/pi-mono/issues/278))

### Fixed

- **File tab completion display**: File paths no longer get cut off early. Folders now show trailing `/` and removed redundant "directory"/"file" labels to maximize horizontal space. ([#280](https://github.com/badlogic/pi-mono/issues/280))

- **Bash tool visual line truncation**: Fixed bash tool output in collapsed mode to use visual line counting (accounting for line wrapping) instead of logical line counting. Now consistent with bash-execution.ts behavior. Extracted shared `truncateToVisualLines` utility. ([#275](https://github.com/badlogic/pi-mono/issues/275))

## [0.26.1] - 2025-12-22

### Fixed

- **SDK tools respect cwd**: Core tools (bash, read, edit, write, grep, find, ls) now properly use the `cwd` option from `createAgentSession()`. Added tool factory functions (`createBashTool`, `createReadTool`, etc.) for SDK users who specify custom `cwd` with explicit tools. ([#279](https://github.com/badlogic/pi-mono/issues/279))

## [0.26.0] - 2025-12-22

### Added

- **SDK for programmatic usage**: New `createAgentSession()` factory with full control over model, tools, hooks, skills, session persistence, and settings. Philosophy: "omit to discover, provide to override". Includes 12 examples and comprehensive documentation. ([#272](https://github.com/badlogic/pi-mono/issues/272))

- **Project-specific settings**: Settings now load from both `~/.omp/agent/settings.json` (global) and `<cwd>/.omp/settings.json` (project). Project settings override global with deep merge for nested objects. Project settings are read-only (for version control). ([#276](https://github.com/badlogic/pi-mono/pull/276))

- **SettingsManager static factories**: `SettingsManager.create(cwd?, agentDir?)` for file-based settings, `SettingsManager.inMemory(settings?)` for testing. Added `applyOverrides()` for programmatic overrides.

- **SessionManager static factories**: `SessionManager.create()`, `SessionManager.open()`, `SessionManager.continueRecent()`, `SessionManager.inMemory()`, `SessionManager.list()` for flexible session management.

## [0.25.4] - 2025-12-22

### Fixed

- **Syntax highlighting stderr spam**: Fixed cli-highlight logging errors to stderr when markdown contains malformed code fences (e.g., missing newlines around closing backticks). Now validates language identifiers before highlighting and falls back silently to plain text. ([#274](https://github.com/badlogic/pi-mono/issues/274))

## [0.25.3] - 2025-12-21

### Added

- **Gemini 3 preview models**: Added `gemini-3-pro-preview` and `gemini-3-flash-preview` to the google-gemini-cli provider. ([#264](https://github.com/badlogic/pi-mono/pull/264) by [@LukeFost](https://github.com/LukeFost))

- **External editor support**: Press `Ctrl+G` to edit your message in an external editor. Uses `$VISUAL` or `$EDITOR` environment variable. On successful save, the message is replaced; on cancel, the original is kept. ([#266](https://github.com/badlogic/pi-mono/pull/266) by [@aliou](https://github.com/aliou))

- **Process suspension**: Press `Ctrl+Z` to suspend omp and return to the shell. Resume with `fg` as usual. ([#267](https://github.com/badlogic/pi-mono/pull/267) by [@aliou](https://github.com/aliou))

- **Configurable skills directories**: Added granular control over skill sources with `enableCodexUser`, `enableClaudeUser`, `enableClaudeProject`, `enablePiUser`, `enablePiProject` toggles, plus `customDirectories` and `ignoredSkills` settings. ([#269](https://github.com/badlogic/pi-mono/pull/269) by [@nicobailon](https://github.com/nicobailon))

- **Skills CLI filtering**: Added `--skills <patterns>` flag for filtering skills with glob patterns. Also added `includeSkills` setting and glob pattern support for `ignoredSkills`. ([#268](https://github.com/badlogic/pi-mono/issues/268))

## [0.25.2] - 2025-12-21

### Fixed

- **Image shifting in tool output**: Fixed an issue where images in tool output would shift down (due to accumulating spacers) each time the tool output was expanded or collapsed via Ctrl+O.

## [0.25.1] - 2025-12-21

### Fixed

- **Gemini image reading broken**: Fixed the `read` tool returning images causing flaky/broken responses with Gemini models. Images in tool results are now properly formatted per the Gemini API spec.

- **Tab completion for absolute paths**: Fixed tab completion producing `//tmp` instead of `/tmp/`. Also fixed symlinks to directories (like `/tmp`) not getting a trailing slash, which prevented continuing to tab through subdirectories.

## [0.25.0] - 2025-12-20

### Added

- **Interruptible tool execution**: Queuing a message while tools are executing now interrupts the current tool batch. Remaining tools are skipped with an error result, and your queued message is processed immediately. Useful for redirecting the agent mid-task. ([#259](https://github.com/badlogic/pi-mono/pull/259) by [@steipete](https://github.com/steipete))

- **Google Gemini CLI OAuth provider**: Access Gemini 2.0/2.5 models for free via Google Cloud Code Assist. Login with `/login` and select "Google Gemini CLI". Uses your Google account with rate limits.

- **Google Antigravity OAuth provider**: Access Gemini 3, Claude (sonnet/opus thinking models), and GPT-OSS models for free via Google's Antigravity sandbox. Login with `/login` and select "Antigravity". Uses your Google account with rate limits.

### Changed

- **Model selector respects --models scope**: The `/model` command now only shows models specified via `--models` flag when that flag is used, instead of showing all available models. This prevents accidentally selecting models from unintended providers. ([#255](https://github.com/badlogic/pi-mono/issues/255))

### Fixed

- **Connection errors not retried**: Added "connection error" to the list of retryable errors so Anthropic connection drops trigger auto-retry instead of silently failing. ([#252](https://github.com/badlogic/pi-mono/issues/252))

- **Thinking level not clamped on model switch**: Fixed TUI showing xhigh thinking level after switching to a model that doesn't support it. Thinking level is now automatically clamped to model capabilities. ([#253](https://github.com/badlogic/pi-mono/issues/253))

- **Cross-model thinking handoff**: Fixed error when switching between models with different thinking signature formats (e.g., GPT-OSS to Claude thinking models via Antigravity). Thinking blocks without signatures are now converted to text with `<thinking>` delimiters.

## [0.24.5] - 2025-12-20

### Fixed

- **Input buffering in iTerm2**: Fixed Ctrl+C, Ctrl+D, and other keys requiring multiple presses in iTerm2. The cell size query response parser was incorrectly holding back keyboard input.

## [0.24.4] - 2025-12-20

### Fixed

- **Arrow keys and Enter in selector components**: Fixed arrow keys and Enter not working in model selector, session selector, OAuth selector, and other selector components when Caps Lock or Num Lock is enabled. ([#243](https://github.com/badlogic/pi-mono/issues/243))

## [0.24.3] - 2025-12-19

### Fixed

- **Footer overflow on narrow terminals**: Fixed footer path display exceeding terminal width when resizing to very narrow widths, causing rendering crashes. /arminsayshi

## [0.24.2] - 2025-12-20

### Fixed

- **More Kitty keyboard protocol fixes**: Fixed Backspace, Enter, Home, End, and Delete keys not working with Caps Lock enabled. The initial fix in 0.24.1 missed several key handlers that were still using raw byte detection. Now all key handlers use the helper functions that properly mask out lock key bits. ([#243](https://github.com/badlogic/pi-mono/issues/243))

## [0.24.1] - 2025-12-19

### Added

- **OAuth and model config exports**: Scripts using `AgentSession` directly can now import `getAvailableModels`, `getApiKeyForModel`, `findModel`, `login`, `logout`, and `getOAuthProviders` from `@oh-my-pi/pi-coding-agent` to reuse OAuth token storage and model resolution. ([#245](https://github.com/badlogic/pi-mono/issues/245))

- **xhigh thinking level for gpt-5.2 models**: The thinking level selector and shift+tab cycling now show xhigh option for gpt-5.2 and gpt-5.2-codex models (in addition to gpt-5.1-codex-max). ([#236](https://github.com/badlogic/pi-mono/pull/236) by [@theBucky](https://github.com/theBucky))

### Fixed

- **Hooks wrap custom tools**: Custom tools are now executed through the hook wrapper, so `tool_call`/`tool_result` hooks can observe, block, and modify custom tool executions (consistent with hook type docs). ([#248](https://github.com/badlogic/pi-mono/pull/248) by [@nicobailon](https://github.com/nicobailon))

- **Hook onUpdate callback forwarding**: The `onUpdate` callback is now correctly forwarded through the hook wrapper, fixing custom tool progress updates. ([#238](https://github.com/badlogic/pi-mono/pull/238) by [@nicobailon](https://github.com/nicobailon))

- **Terminal cleanup on Ctrl+C in session selector**: Fixed terminal not being properly restored when pressing Ctrl+C in the session selector. ([#247](https://github.com/badlogic/pi-mono/pull/247) by [@aliou](https://github.com/aliou))

- **OpenRouter models with colons in IDs**: Fixed parsing of OpenRouter model IDs that contain colons (e.g., `openrouter:meta-llama/llama-4-scout:free`). ([#242](https://github.com/badlogic/pi-mono/pull/242) by [@aliou](https://github.com/aliou))

- **Global AGENTS.md loaded twice**: Fixed global AGENTS.md being loaded twice when present in both `~/.omp/agent/` and the current directory. ([#239](https://github.com/badlogic/pi-mono/pull/239) by [@aliou](https://github.com/aliou))

- **Kitty keyboard protocol on Linux**: Fixed keyboard input not working in Ghostty on Linux when Num Lock is enabled. The Kitty protocol includes Caps Lock and Num Lock state in modifier values, which broke key detection. Now correctly masks out lock key bits when matching keyboard shortcuts. ([#243](https://github.com/badlogic/pi-mono/issues/243))

- **Emoji deletion and cursor movement**: Backspace, Delete, and arrow keys now correctly handle multi-codepoint characters like emojis. Previously, deleting an emoji would leave partial bytes, corrupting the editor state. ([#240](https://github.com/badlogic/pi-mono/issues/240))

## [0.24.0] - 2025-12-19

### Added

- **Subagent orchestration example**: Added comprehensive custom tool example for spawning and orchestrating sub-agents with isolated context windows. Includes scout/planner/reviewer/worker agents and workflow commands for multi-agent pipelines. ([#215](https://github.com/badlogic/pi-mono/pull/215) by [@nicobailon](https://github.com/nicobailon))

- **`getMarkdownTheme()` export**: Custom tools can now import `getMarkdownTheme()` from `@oh-my-pi/pi-coding-agent` to use the same markdown styling as the main UI.

- **`pi.exec()` signal and timeout support**: Custom tools and hooks can now pass `{ signal, timeout }` options to `pi.exec()` for cancellation and timeout handling. The result includes a `killed` flag when the process was terminated.

- **Kitty keyboard protocol support**: Shift+Enter, Alt+Enter, Shift+Tab, Ctrl+D, and all Ctrl+key combinations now work in Ghostty, Kitty, WezTerm, and other modern terminals. ([#225](https://github.com/badlogic/pi-mono/pull/225) by [@kim0](https://github.com/kim0))

- **Dynamic API key refresh**: OAuth tokens (GitHub Copilot, Anthropic OAuth) are now refreshed before each LLM call, preventing failures in long-running agent loops where tokens expire mid-session. ([#223](https://github.com/badlogic/pi-mono/pull/223) by [@kim0](https://github.com/kim0))

- **`/hotkeys` command**: Shows all keyboard shortcuts in a formatted table.

- **Markdown table borders**: Tables now render with proper top and bottom borders.

### Changed

- **Subagent example improvements**: Parallel mode now streams updates from all tasks. Chain mode shows all completed steps during streaming. Expanded view uses proper markdown rendering with syntax highlighting. Usage footer shows turn count.

- **Skills standard compliance**: Skills now adhere to the [Agent Skills standard](https://agentskills.io/specification). Validates name (must match parent directory, lowercase, max 64 chars), description (required, max 1024 chars), and frontmatter fields. Warns on violations but remains lenient. Prompt format changed to XML structure. Removed `{baseDir}` placeholder in favor of relative paths. ([#231](https://github.com/badlogic/pi-mono/issues/231))

### Fixed

- **JSON mode stdout flush**: Fixed race condition where `omp --mode json` could exit before all output was written to stdout, causing consumers to miss final events.

- **Symlinked tools, hooks, and slash commands**: Discovery now correctly follows symlinks when scanning for custom tools, hooks, and slash commands. ([#219](https://github.com/badlogic/pi-mono/pull/219), [#232](https://github.com/badlogic/pi-mono/pull/232) by [@aliou](https://github.com/aliou))

### Breaking Changes

- **Custom tools now require `index.ts` entry point**: Auto-discovered custom tools must be in a subdirectory with an `index.ts` file. The old pattern `~/.omp/agent/tools/mytool.ts` must become `~/.omp/agent/tools/mytool/index.ts`. This allows multi-file tools to import helper modules. Explicit paths via `--tool` or `settings.json` still work with any `.ts` file.

- **Hook `tool_result` event restructured**: The `ToolResultEvent` now exposes full tool result data instead of just text. ([#233](https://github.com/badlogic/pi-mono/pull/233))
  - Removed: `result: string` field
  - Added: `content: (TextContent | ImageContent)[]` - full content array
  - Added: `details: unknown` - tool-specific details (typed per tool via discriminated union on `toolName`)
  - `ToolResultEventResult.result` renamed to `ToolResultEventResult.text` (removed), use `content` instead
  - Hook handlers returning `{ result: "..." }` must change to `{ content: [{ type: "text", text: "..." }] }`
  - Built-in tool details types exported: `BashToolDetails`, `ReadToolDetails`, `GrepToolDetails`, `FindToolDetails`, `LsToolDetails`, `TruncationResult`
  - Type guards exported for narrowing: `isBashToolResult`, `isReadToolResult`, `isEditToolResult`, `isWriteToolResult`, `isGrepToolResult`, `isFindToolResult`, `isLsToolResult`

## [0.23.4] - 2025-12-18

### Added

- **Syntax highlighting**: Added syntax highlighting for markdown code blocks, read tool output, and write tool content. Uses cli-highlight with theme-aware color mapping and VS Code-style syntax colors. ([#214](https://github.com/badlogic/pi-mono/pull/214) by [@svkozak](https://github.com/svkozak))

- **Intra-line diff highlighting**: Edit tool now shows word-level changes with inverse highlighting when a single line is modified. Multi-line changes show all removed lines first, then all added lines.

### Fixed

- **Gemini tool result format**: Fixed tool result format for Gemini 3 Flash Preview which strictly requires `{ output: value }` for success and `{ error: value }` for errors. Previous format using `{ result, isError }` was rejected by newer Gemini models. ([#213](https://github.com/badlogic/pi-mono/issues/213), [#220](https://github.com/badlogic/pi-mono/pull/220))

- **Google baseUrl configuration**: Google provider now respects `baseUrl` configuration for custom endpoints or API proxies. ([#216](https://github.com/badlogic/pi-mono/issues/216), [#221](https://github.com/badlogic/pi-mono/pull/221) by [@theBucky](https://github.com/theBucky))

- **Google provider FinishReason**: Added handling for new `IMAGE_RECITATION` and `IMAGE_OTHER` finish reasons. Upgraded @google/genai to 1.34.0.

## [0.23.3] - 2025-12-17

### Fixed

- Check for compaction before submitting user prompt, not just after agent turn ends. This catches cases where user aborts mid-response and context is already near the limit.

### Changed

- Improved system prompt documentation section with clearer pointers to specific doc files for custom models, themes, skills, hooks, custom tools, and RPC.

- Cleaned up documentation:
  - `theme.md`: Added missing color tokens (`thinkingXhigh`, `bashMode`)
  - `skills.md`: Rewrote with better framing and examples
  - `hooks.md`: Fixed timeout/error handling docs, added import aliases section
  - `custom-tools.md`: Added intro with use cases and comparison table
  - `rpc.md`: Added missing `hook_error` event documentation
  - `README.md`: Complete settings table, condensed philosophy section, standardized OAuth docs

- Hooks loader now supports same import aliases as custom tools (`@sinclair/typebox`, `@oh-my-pi/pi-ai`, `@oh-my-pi/pi-tui`, `@oh-my-pi/pi-coding-agent`).

### Breaking Changes

- **Hooks**: `turn_end` event's `toolResults` type changed from `AppMessage[]` to `ToolResultMessage[]`. If you have hooks that handle `turn_end` events and explicitly type the results, update your type annotations.

## [0.23.2] - 2025-12-17

### Fixed

- Fixed Claude models via GitHub Copilot re-answering all previous prompts in multi-turn conversations. The issue was that assistant message content was sent as an array instead of a string, which Copilot's Claude adapter misinterpreted. Also added missing `Openai-Intent: conversation-edits` header and fixed `X-Initiator` logic to check for any assistant/tool message in history. ([#209](https://github.com/badlogic/pi-mono/issues/209))

- Detect image MIME type via file magic (read tool and `@file` attachments), not filename extension.

- Fixed markdown tables overflowing terminal width. Tables now wrap cell contents to fit available width instead of breaking borders mid-row. ([#206](https://github.com/badlogic/pi-mono/pull/206) by [@kim0](https://github.com/kim0))

## [0.23.1] - 2025-12-17

### Fixed

- Fixed TUI performance regression caused by Box component lacking render caching. Built-in tools now use Text directly (like v0.22.5), and Box has proper caching for custom tool rendering.

- Fixed custom tools failing to load from `~/.omp/agent/tools/` when omp is installed globally. Module imports (`@sinclair/typebox`, `@oh-my-pi/pi-tui`, `@oh-my-pi/pi-ai`) are now resolved via aliases.

## [0.23.0] - 2025-12-17

### Added

- **Custom tools**: Extend omp with custom tools written in TypeScript. Tools can provide custom TUI rendering, interact with users via `omp.ui` (select, confirm, input, notify), and maintain state across sessions via `onSession` callback. See [docs/custom-tools.md](docs/custom-tools.md) and [examples/custom-tools/](examples/custom-tools/). ([#190](https://github.com/badlogic/pi-mono/issues/190))

- **Hook and tool examples**: Added `examples/hooks/` and `examples/custom-tools/` with working examples. Examples are now bundled in npm and binary releases.

### Breaking Changes

- **Hooks**: Replaced `session_start` and `session_switch` events with unified `session` event. Use `event.reason` (`"start" | "switch" | "clear"`) to distinguish. Event now includes `entries` array for state reconstruction.

## [0.22.5] - 2025-12-17

### Fixed

- Fixed `--session` flag not saving sessions in print mode (`-p`). The session manager was never receiving events because no subscriber was attached.

## [0.22.4] - 2025-12-17

### Added

- `--list-models [search]` CLI flag to list available models with optional fuzzy search. Shows provider, model ID, context window, max output, thinking support, and image support. Only lists models with configured API keys. ([#203](https://github.com/badlogic/pi-mono/issues/203))

### Fixed

- Fixed tool execution showing green (success) background while still running. Now correctly shows gray (pending) background until the tool completes.

## [0.22.3] - 2025-12-16

### Added

- **Streaming bash output**: Bash tool now streams output in real-time during execution. The TUI displays live progress with the last 5 lines visible (expandable with ctrl+o). ([#44](https://github.com/badlogic/pi-mono/issues/44))

### Changed

- **Tool output display**: When collapsed, tool output now shows the last N lines instead of the first N lines, making streaming output more useful.

- Updated `@oh-my-pi/pi-ai` with X-Initiator header support for GitHub Copilot, ensuring agent calls are not deducted from quota. ([#200](https://github.com/badlogic/pi-mono/pull/200) by [@kim0](https://github.com/kim0))

### Fixed

- Fixed editor text being cleared during compaction. Text typed while compaction is running is now preserved. ([#179](https://github.com/badlogic/pi-mono/issues/179))
- Improved RGB to 256-color mapping for terminals without truecolor support. Now correctly uses grayscale ramp for neutral colors and preserves semantic tints (green for success, red for error, blue for pending) instead of mapping everything to wrong cube colors.
- `/think off` now actually disables thinking for all providers. Previously, providers like Gemini with "dynamic thinking" enabled by default would still use thinking even when turned off. ([#180](https://github.com/badlogic/pi-mono/pull/180) by [@markusylisiurunen](https://github.com/markusylisiurunen))

## [0.22.2] - 2025-12-15

### Changed

- Updated `@oh-my-pi/pi-ai` with interleaved thinking enabled by default for Anthropic Claude 4 models.

## [0.22.1] - 2025-12-15

_Dedicated to Peter's shoulder ([@steipete](https://twitter.com/steipete))_

### Changed

- Updated `@oh-my-pi/pi-ai` with interleaved thinking support for Anthropic models.

## [0.22.0] - 2025-12-15

### Added

- **GitHub Copilot support**: Use GitHub Copilot models via OAuth login (`/login` -> "GitHub Copilot"). Supports both github.com and GitHub Enterprise. Models are sourced from models.dev and include Claude, GPT, Gemini, Grok, and more. All models are automatically enabled after login. ([#191](https://github.com/badlogic/pi-mono/pull/191) by [@cau1k](https://github.com/cau1k))

### Fixed

- Model selector fuzzy search now matches against provider name (not just model ID) and supports space-separated tokens where all tokens must match

## [0.21.0] - 2025-12-14

### Added

- **Inline image rendering**: Terminals supporting Kitty graphics protocol (Kitty, Ghostty, WezTerm) or iTerm2 inline images now render images inline in tool output. Aspect ratio is preserved by querying terminal cell dimensions on startup. Toggle with `/show-images` command or `terminal.showImages` setting. Falls back to text placeholder on unsupported terminals or when disabled. ([#177](https://github.com/badlogic/pi-mono/pull/177) by [@nicobailon](https://github.com/nicobailon))

- **Gemini 3 Pro thinking levels**: Thinking level selector now works with Gemini 3 Pro models. Minimal/low map to Google's LOW, medium/high map to Google's HIGH. ([#176](https://github.com/badlogic/pi-mono/pull/176) by [@markusylisiurunen](https://github.com/markusylisiurunen))

### Fixed

- Fixed read tool failing on macOS screenshot filenames due to Unicode Narrow No-Break Space (U+202F) in timestamp. Added fallback to try macOS variant paths and consolidated duplicate expandPath functions into shared path-utils.ts. ([#181](https://github.com/badlogic/pi-mono/pull/181) by [@nicobailon](https://github.com/nicobailon))

- Fixed double blank lines rendering after markdown code blocks ([#173](https://github.com/badlogic/pi-mono/pull/173) by [@markusylisiurunen](https://github.com/markusylisiurunen))

## [0.20.1] - 2025-12-13

### Added

- **Exported skills API**: `loadSkillsFromDir`, `formatSkillsForPrompt`, and related types are now exported for use by other packages (e.g., mom).

## [0.20.0] - 2025-12-13

### Breaking Changes

- **OMP skills now use `SKILL.md` convention**: OMP skills must now be named `SKILL.md` inside a directory, matching Codex CLI format. Previously any `*.md` file was treated as a skill. Migrate by renaming `~/.omp/agent/skills/foo.md` to `~/.omp/agent/skills/foo/SKILL.md`.

### Added

- Display loaded skills on startup in interactive mode

## [0.19.1] - 2025-12-12

### Fixed

- Documentation: Added skills system documentation to README (setup, usage, CLI flags, settings)

## [0.19.0] - 2025-12-12

### Added

- **Skills system**: Auto-discover and load instruction files on-demand. Supports Claude Code (`~/.claude/skills/*/SKILL.md`), Codex CLI (`~/.codex/skills/`), and OMP-native formats (`~/.omp/agent/skills/`, `.omp/skills/`). Skills are listed in system prompt with descriptions, agent loads them via read tool when needed. Supports `{baseDir}` placeholder. Disable with `--no-skills` or `skills.enabled: false` in settings. ([#169](https://github.com/badlogic/pi-mono/issues/169))

- **Version flag**: Added `--version` / `-v` flag to display the current version and exit. ([#170](https://github.com/badlogic/pi-mono/pull/170))

## [0.18.2] - 2025-12-11

### Added

- **Auto-retry on transient errors**: Automatically retries requests when providers return overloaded, rate limit, or server errors (429, 500, 502, 503, 504). Uses exponential backoff (2s, 4s, 8s). Shows retry status in TUI with option to cancel via Escape. Configurable in `settings.json` via `retry.enabled`, `retry.maxRetries`, `retry.baseDelayMs`. RPC mode emits `auto_retry_start` and `auto_retry_end` events. ([#157](https://github.com/badlogic/pi-mono/issues/157))

- **HTML export line numbers**: Read tool calls in HTML exports now display line number ranges (e.g., `file.txt:10-20`) when offset/limit parameters are used, matching the TUI display format. Line numbers appear in yellow color for better visibility. ([#166](https://github.com/badlogic/pi-mono/issues/166))

### Fixed

- **Branch selector now works with single message**: Previously the branch selector would not open when there was only one user message. Now it correctly allows branching from any message, including the first one. This is needed for checkpoint hooks to restore state from before the first message. ([#163](https://github.com/badlogic/pi-mono/issues/163))

- **In-memory branching for `--no-session` mode**: Branching now works correctly in `--no-session` mode without creating any session files. The conversation is truncated in memory.

- **Git branch indicator now works in subdirectories**: The footer's git branch detection now walks up the directory hierarchy to find the git root, so it works when running omp from a subdirectory of a repository. ([#156](https://github.com/badlogic/pi-mono/issues/156))

## [0.18.1] - 2025-12-10

### Added

- **Mistral provider**: Added support for Mistral AI models. Set `MISTRAL_API_KEY` environment variable to use.

### Fixed

- Fixed print mode (`-p`) not exiting after output when custom themes are present (theme watcher now properly stops in print mode) ([#161](https://github.com/badlogic/pi-mono/issues/161))

## [0.18.0] - 2025-12-10

### Added

- **Hooks system**: TypeScript modules that extend agent behavior by subscribing to lifecycle events. Hooks can intercept tool calls, prompt for confirmation, modify results, and inject messages from external sources. Auto-discovered from `~/.omp/agent/hooks/*.ts` and `.omp/hooks/*.ts`. Thanks to [@nicobailon](https://github.com/nicobailon) for the collaboration on the design and implementation. ([#145](https://github.com/badlogic/pi-mono/issues/145), supersedes [#158](https://github.com/badlogic/pi-mono/pull/158))

- **`pi.send()` API**: Hooks can inject messages into the agent session from external sources (file watchers, webhooks, CI systems). If streaming, messages are queued; otherwise a new agent loop starts immediately.

- **`--hook <path>` CLI flag**: Load hook files directly for testing without modifying settings.

- **Hook events**: `session_start`, `session_switch`, `agent_start`, `agent_end`, `turn_start`, `turn_end`, `tool_call` (can block), `tool_result` (can modify), `branch`.

- **Hook UI primitives**: `ctx.ui.select()`, `ctx.ui.confirm()`, `ctx.ui.input()`, `ctx.ui.notify()` for interactive prompts from hooks.

- **Hooks documentation**: Full API reference at `docs/hooks.md`, shipped with npm package.

## [0.17.0] - 2025-12-09

### Changed

- **Simplified compaction flow**: Removed proactive compaction (aborting mid-turn when threshold approached). Compaction now triggers in two cases only: (1) overflow error from LLM, which compacts and auto-retries, or (2) threshold crossed after a successful turn, which compacts without retry.

- **Compaction retry uses `Agent.continue()`**: Auto-retry after overflow now uses the new `continue()` API instead of re-sending the user message, preserving exact context state.

- **Merged turn prefix summary**: When a turn is split during compaction, the turn prefix summary is now merged into the main history summary instead of being stored separately.

### Added

- **`isCompacting` property on AgentSession**: Check if auto-compaction is currently running.

- **Session compaction indicator**: When resuming a compacted session, displays "Session compacted N times" status message.

### Fixed

- **Block input during compaction**: User input is now blocked while auto-compaction is running to prevent race conditions.

- **Skip error messages in usage calculation**: Context size estimation now skips both aborted and error messages, as neither have valid usage data.

## [0.16.0] - 2025-12-09

### Breaking Changes

- **New RPC protocol**: The RPC mode (`--mode rpc`) has been completely redesigned with a new JSON protocol. The old protocol is no longer supported. See [`docs/rpc.md`](docs/rpc.md) for the new protocol documentation and [`test/rpc-example.ts`](test/rpc-example.ts) for a working example. Includes `RpcClient` TypeScript class for easy integration. ([#91](https://github.com/badlogic/pi-mono/issues/91))

### Changed

- **README restructured**: Reorganized documentation from 30+ flat sections into 10 logical groups. Converted verbose subsections to scannable tables. Consolidated philosophy sections. Reduced size by ~60% while preserving all information.

## [0.15.0] - 2025-12-09

### Changed

- **Major code refactoring**: Restructured codebase for better maintainability and separation of concerns. Moved files into organized directories (`core/`, `modes/`, `utils/`, `cli/`). Extracted `AgentSession` class as central session management abstraction. Split `main.ts` and `tui-renderer.ts` into focused modules. See `DEVELOPMENT.md` for the new code map. ([#153](https://github.com/badlogic/pi-mono/issues/153))

## [0.14.2] - 2025-12-08

### Added

- `/debug` command now includes agent messages as JSONL in the output

### Fixed

- Fix crash when bash command outputs binary data (e.g., `curl` downloading a video file)

## [0.14.1] - 2025-12-08

### Fixed

- Fix build errors with tsgo 7.0.0-dev.20251208.1 by properly importing `ReasoningEffort` type

## [0.14.0] - 2025-12-08

### Breaking Changes

- **Custom themes require new color tokens**: Themes must now include `thinkingXhigh` and `bashMode` color tokens. The theme loader provides helpful error messages listing missing tokens. See built-in themes (dark.json, light.json) for reference values.

### Added

- **OpenAI compatibility overrides in models.json**: Custom models using `openai-completions` API can now specify a `compat` object to override provider quirks (`supportsStore`, `supportsDeveloperRole`, `supportsReasoningEffort`, `maxTokensField`). Useful for LiteLLM, custom proxies, and other non-standard endpoints. ([#133](https://github.com/badlogic/pi-mono/issues/133), thanks @fink-andreas for the initial idea and PR)

- **xhigh thinking level**: Added `xhigh` thinking level for OpenAI codex-max models. Cycle through thinking levels with Shift+Tab; `xhigh` appears only when using a codex-max model. ([#143](https://github.com/badlogic/pi-mono/issues/143))

- **Collapse changelog setting**: Add `"collapseChangelog": true` to `~/.omp/agent/settings.json` to show a condensed "Updated to vX.Y.Z" message instead of the full changelog after updates. Use `/changelog` to view the full changelog. ([#148](https://github.com/badlogic/pi-mono/issues/148))

- **Bash mode**: Execute shell commands directly from the editor by prefixing with `!` (e.g., `!ls -la`). Output streams in real-time, is added to the LLM context, and persists in session history. Supports multiline commands, cancellation (Escape), truncation for large outputs, and preview/expand toggle (Ctrl+O). Also available in RPC mode via `{"type":"bash","command":"..."}`. ([#112](https://github.com/badlogic/pi-mono/pull/112), original implementation by [@markusylisiurunen](https://github.com/markusylisiurunen))

## [0.13.2] - 2025-12-07

### Changed

- **Tool output truncation**: All tools now enforce consistent truncation limits with actionable notices for the LLM. ([#134](https://github.com/badlogic/pi-mono/issues/134))
  - **Limits**: 2000 lines OR 50KB (whichever hits first), never partial lines
  - **read**: Shows `[Showing lines X-Y of Z. Use offset=N to continue]`. If first line exceeds 50KB, suggests bash command
  - **bash**: Tail truncation with temp file. Shows `[Showing lines X-Y of Z. Full output: /tmp/...]`
  - **grep**: Pre-truncates match lines to 500 chars. Shows match limit and line truncation notices
  - **find/ls**: Shows result/entry limit notices
  - TUI displays truncation warnings in yellow at bottom of tool output (visible even when collapsed)

## [0.13.1] - 2025-12-06

### Added

- **Flexible Windows shell configuration**: The bash tool now supports multiple shell sources beyond Git Bash. Resolution order: (1) custom `shellPath` in settings.json, (2) Git Bash in standard locations, (3) any bash.exe on PATH. This enables Cygwin, MSYS2, and other bash environments. Configure with `~/.omp/agent/settings.json`: `{"shellPath": "C:\\cygwin64\\bin\\bash.exe"}`.

### Fixed

- **Windows binary detection**: Fixed Bun compiled binary detection on Windows by checking for URL-encoded `%7EBUN` in addition to `$bunfs` and `~BUN` in `import.meta.url`. This ensures the binary correctly locates supporting files (package.json, themes, etc.) next to the executable.

## [0.12.15] - 2025-12-06

### Fixed

- **Editor crash with emojis/CJK characters**: Fixed crash when pasting or typing text containing wide characters (emojis like ✅, CJK characters) that caused line width to exceed terminal width. The editor now uses grapheme-aware text wrapping with proper visible width calculation.

## [0.12.14] - 2025-12-06

### Added

- **Double-Escape Branch Shortcut**: Press Escape twice with an empty editor to quickly open the `/branch` selector for conversation branching.

## [0.12.13] - 2025-12-05

### Changed

- **Faster startup**: Version check now runs in parallel with TUI initialization instead of blocking startup for up to 1 second. Update notifications appear in chat when the check completes.

## [0.12.12] - 2025-12-05

### Changed

- **Footer display**: Token counts now use M suffix for millions (e.g., `10.2M` instead of `10184k`). Context display shortened from `61.3% of 200k` to `61.3%/200k`.

### Fixed

- **Multi-key sequences in inputs**: Inputs like model search now handle multi-key sequences identically to the main prompt editor. ([#122](https://github.com/badlogic/pi-mono/pull/122) by [@markusylisiurunen](https://github.com/markusylisiurunen))
- **Line wrapping escape codes**: Fixed underline style bleeding into padding when wrapping long URLs. ANSI codes now attach to the correct content, and line-end resets only turn off underline (preserving background colors). ([#109](https://github.com/badlogic/pi-mono/issues/109))

### Added

- **Fuzzy search models and sessions**: Implemented a simple fuzzy search for models and sessions (e.g., `codexmax` now finds `gpt-5.1-codex-max`). ([#122](https://github.com/badlogic/pi-mono/pull/122) by [@markusylisiurunen](https://github.com/markusylisiurunen))
- **Prompt History Navigation**: Browse previously submitted prompts using Up/Down arrow keys when the editor is empty. Press Up to cycle through older prompts, Down to return to newer ones or clear the editor. Similar to shell history and Claude Code's prompt history feature. History is session-scoped and stores up to 100 entries. ([#121](https://github.com/badlogic/pi-mono/pull/121) by [@nicobailon](https://github.com/nicobailon))
- **`/resume` Command**: Switch to a different session mid-conversation. Opens an interactive selector showing all available sessions. Equivalent to the `--resume` CLI flag but can be used without restarting the agent. ([#117](https://github.com/badlogic/pi-mono/pull/117) by [@hewliyang](https://github.com/hewliyang))

## [0.12.11] - 2025-12-05

### Changed

- **Compaction UI**: Simplified collapsed compaction indicator to show warning-colored text with token count instead of styled banner. Removed redundant success message after compaction. ([#108](https://github.com/badlogic/pi-mono/issues/108))

### Fixed

- **Print mode error handling**: `-p` flag now outputs error messages and exits with code 1 when requests fail, instead of silently producing no output.
- **Branch selector crash**: Fixed TUI crash when user messages contained Unicode characters (like `✔` or `›`) that caused line width to exceed terminal width. Now uses proper `truncateToWidth` instead of `substring`.
- **Bash output escape sequences**: Fixed incomplete stripping of terminal escape sequences in bash tool output. `stripAnsi` misses some sequences like standalone String Terminator (`ESC \`), which could cause rendering issues when displaying captured TUI output.
- **Footer overflow crash**: Fixed TUI crash when terminal width is too narrow for the footer stats line. The footer now truncates gracefully instead of overflowing.

### Added

- **`authHeader` option in models.json**: Custom providers can set `"authHeader": true` to automatically add `Authorization: Bearer <apiKey>` header. Useful for providers that require explicit auth headers. ([#81](https://github.com/badlogic/pi-mono/issues/81))
- **`--append-system-prompt` Flag**: Append additional text or file contents to the system prompt. Supports both inline text and file paths. Complements `--system-prompt` for layering custom instructions without replacing the base system prompt. ([#114](https://github.com/badlogic/pi-mono/pull/114) by [@markusylisiurunen](https://github.com/markusylisiurunen))
- **Thinking Block Toggle**: Added `Ctrl+T` shortcut to toggle visibility of LLM thinking blocks. When toggled off, shows a static "Thinking..." label instead of full content. Useful for reducing visual clutter during long conversations. ([#113](https://github.com/badlogic/pi-mono/pull/113) by [@markusylisiurunen](https://github.com/markusylisiurunen))

## [0.12.10] - 2025-12-04

### Added

- Added `gpt-5.1-codex-max` model support

## [0.12.9] - 2025-12-04

### Added

- **`/copy` Command**: Copy the last agent message to clipboard. Works cross-platform (macOS, Windows, Linux). Useful for extracting text from rendered Markdown output. ([#105](https://github.com/badlogic/pi-mono/pull/105) by [@markusylisiurunen](https://github.com/markusylisiurunen))

## [0.12.8] - 2025-12-04

- Fix: Use CTRL+O consistently for compaction expand shortcut (not CMD+O on Mac)

## [0.12.7] - 2025-12-04

### Added

- **Context Compaction**: Long sessions can now be compacted to reduce context usage while preserving recent conversation history. ([#92](https://github.com/badlogic/pi-mono/issues/92), [docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md#context-compaction))
  - `/compact [instructions]`: Manually compact context with optional custom instructions for the summary
  - `/autocompact`: Toggle automatic compaction when context exceeds threshold
  - Compaction summarizes older messages while keeping recent messages (default 20k tokens) verbatim
  - Auto-compaction triggers when context reaches `contextWindow - reserveTokens` (default 16k reserve)
  - Compacted sessions show a collapsible summary in the TUI (toggle with `o` key)
  - HTML exports include compaction summaries as collapsible sections
  - RPC mode supports `{"type":"compact"}` command and auto-compaction (emits compaction events)
- **Branch Source Tracking**: Branched sessions now store `branchedFrom` in the session header, containing the path to the original session file. Useful for tracing session lineage.

## [0.12.5] - 2025-12-03

### Added

- **Forking/Rebranding Support**: All branding (app name, config directory, environment variable names) is now configurable via `ompConfig` in `package.json`. Forks can change `ompConfig.name` and `ompConfig.configDir` to rebrand the CLI without code changes. Affects CLI banner, help text, config paths, and error messages. ([#95](https://github.com/badlogic/pi-mono/pull/95))

### Fixed

- **Bun Binary Detection**: Fixed Bun compiled binary failing to start after Bun updated its virtual filesystem path format from `%7EBUN` to `$bunfs`. ([#95](https://github.com/badlogic/pi-mono/pull/95))

## [0.12.4] - 2025-12-02

### Added

- **RPC Termination Safeguard**: When running as an RPC worker (stdin pipe detected), the CLI now exits immediately if the parent process terminates unexpectedly. Prevents orphaned RPC workers from persisting indefinitely and consuming system resources.

## [0.12.3] - 2025-12-02

### Fixed

- **Rate limit handling**: Anthropic rate limit errors now trigger automatic retry with exponential backoff (base 10s, max 5 retries). Previously these errors would abort the request immediately.
- **Usage tracking during retries**: Retried requests now correctly accumulate token usage from all attempts, not just the final successful one. Fixes artificially low token counts when requests were retried.

## [0.12.2] - 2025-12-02

### Changed

- Removed support for gpt-4.5-preview and o3 models (not yet available)

## [0.12.1] - 2025-12-02

### Added

- **Models**: Added support for OpenAI's new models:
  - `gpt-4.1` (128K context)
  - `gpt-4.1-mini` (128K context)
  - `gpt-4.1-nano` (128K context)
  - `o3` (200K context, reasoning model)
  - `o4-mini` (200K context, reasoning model)

## [0.12.0] - 2025-12-02

### Added

- **`-p, --print` Flag**: Run in non-interactive batch mode. Processes input message or piped stdin without TUI, prints agent response directly to stdout. Ideal for scripting, piping, and CI/CD integration. Exits after first response.
- **`-P, --print-streaming` Flag**: Like `-p`, but streams response tokens as they arrive. Use `--print-streaming --no-markdown` for raw unformatted output.
- **`--print-turn` Flag**: Continue processing tool calls and agent turns until the agent naturally finishes or requires user input. Combine with `-p` for complete multi-turn conversations.
- **`--no-markdown` Flag**: Output raw text without Markdown formatting. Useful when piping output to tools that expect plain text.
- **Streaming Print Mode**: Added internal `printStreaming` option for streaming output in non-TUI mode.
- **RPC Mode `print` Command**: Send `{"type":"print","content":"text"}` to get formatted print output via `print_output` events.
- **Auto-Save in Print Mode**: Print mode conversations are automatically saved to the session directory, allowing later resumption with `--continue`.
- **Thinking level options**: Added `--thinking-off`, `--thinking-minimal`, `--thinking-low`, `--thinking-medium`, `--thinking-high` flags for directly specifying thinking level without the selector UI.

### Changed

- **Simplified RPC Protocol**: Replaced the `prompt` wrapper command with direct message objects. Send `{"role":"user","content":"text"}` instead of `{"type":"prompt","message":"text"}`. Better aligns with message format throughout the codebase.
- **RPC Message Handling**: Agent now processes raw message objects directly, with `timestamp` auto-populated if missing.

## [0.11.9] - 2025-12-02

### Changed

- Change Ctrl+I to Ctrl+P for model cycling shortcut to avoid collision with Tab key in some terminals

## [0.11.8] - 2025-12-01

### Fixed

- Absolute glob patterns (e.g., `/Users/foo/**/*.ts`) are now handled correctly. Previously the leading `/` was being stripped, causing the pattern to be interpreted relative to the current directory.

## [0.11.7] - 2025-12-01

### Fixed

- Fix read path traversal vulnerability. Paths are now validated to prevent reading outside the working directory or its parents. The `read` tool can read from `cwd`, its ancestors (for config files), and all descendants. Symlinks are resolved before validation.

## [0.11.6] - 2025-12-01

### Fixed

- Fix `--system-prompt <path>` allowing the path argument to be captured by the message collection, causing "file not found" errors.

## [0.11.5] - 2025-11-30

### Fixed

- Fixed fatal error "Cannot set properties of undefined (setting '0')" when editing empty files in the `edit` tool.
- Simplified `edit` tool output: Shows only "Edited file.txt" for successful edits instead of verbose search/replace details.
- Fixed fatal error in footer rendering when token counts contain NaN values due to missing usage data.

## [0.11.4] - 2025-11-30

### Fixed

- Fixed chat rendering crash when messages contain preformatted/styled text (e.g., thinking traces with gray italic styling). The markdown renderer now preserves existing ANSI escape codes when they appear before inline elements.

## [0.11.3] - 2025-11-29

### Fixed

- Fix file drop functionality for absolute paths

## [0.11.2] - 2025-11-29

### Fixed

- Fixed TUI crash when pasting content containing tab characters. Tabs are now converted to 4 spaces before insertion.
- Fixed terminal corruption after exit when shell integration sequences (OSC 133) appeared in bash output. These sequences are now stripped along with other ANSI codes.

## [0.11.1] - 2025-11-29

### Added

- Added `fd` integration for file path autocompletion. Now uses `fd` for faster fuzzy file search

### Fixed

- Fixed keyboard shortcuts Ctrl+A, Ctrl+E, Ctrl+K, Ctrl+U, Ctrl+W, and word navigation (Option+Arrow) not working in VS Code integrated terminal and some other terminal emulators

## [0.11.0] - 2025-11-29

### Added

- **File-based Slash Commands**: Create custom reusable prompts as `.txt` files in `~/.omp/slash-commands/`. Files become `/filename` commands with first-line descriptions. Supports `{{selection}}` placeholder for referencing selected/attached content.
- **`/branch` Command**: Create conversation branches from any previous user message. Opens a selector to pick a message, then creates a new session file starting from that point. Original message text is placed in the editor for modification.
- **Unified Content References**: Both `@path` in messages and `--file path` CLI arguments now use the same attachment system with consistent MIME type detection.
- **Drag & Drop Files**: Drop files onto the terminal to attach them to your message. Supports multiple files and both text and image content.

### Changed

- **Model Selector with Search**: The `/model` command now opens a searchable list. Type to filter models by name, use arrows to navigate, Enter to select.
- **Improved File Autocomplete**: File path completion after `@` now supports fuzzy matching and shows file/directory indicators.
- **Session Selector with Search**: The `--resume` and `--session` flags now open a searchable session list with fuzzy filtering.
- **Attachment Display**: Files added via `@path` are now shown as "Attached: filename" in the user message, separate from the prompt text.
- **Tab Completion**: Tab key now triggers file path autocompletion anywhere in the editor, not just after `@` symbol.

### Fixed

- Fixed autocomplete z-order issue where dropdown could appear behind chat messages
- Fixed cursor position when navigating through wrapped lines in the editor
- Fixed attachment handling for continued sessions to preserve file references

## [0.10.6] - 2025-11-28

### Changed

- Show base64-truncated indicator for large images in tool output

### Fixed

- Fixed image dimensions not being read correctly from PNG/JPEG/GIF files
- Fixed PDF images being incorrectly base64-truncated in display
- Allow reading files from ancestor directories (needed for monorepo configs)

## [0.10.5] - 2025-11-28

### Added

- Full multimodal support: attach images (PNG, JPEG, GIF, WebP) and PDFs to prompts using `@path` syntax or `--file` flag

### Fixed

- `@`-references now handle special characters in file names (spaces, quotes, unicode)
- Fixed cursor positioning issues with multi-byte unicode characters in editor

## [0.10.4] - 2025-11-28

### Fixed

- Removed padding on first user message in TUI to improve visual consistency.

## [0.10.3] - 2025-11-28

### Added

- Added RPC mode (`--rpc`) for programmatic integration. Accepts JSON commands on stdin, emits JSON events on stdout. See [RPC mode documentation](https://github.com/nicobailon/pi-mono/blob/main/packages/coding-agent/README.md#rpc-mode) for protocol details.

### Changed

- Refactored internal architecture to support multiple frontends (TUI, RPC) with shared agent logic.

## [0.10.2] - 2025-11-26

### Added

- Added thinking level persistence. Default level stored in `~/.omp/settings.json`, restored on startup. Per-session overrides saved in session files.
- Added model cycling shortcut: `Ctrl+I` cycles through available models (or scoped models with `-m` flag).
- Added automatic retry with exponential backoff for transient API errors (network issues, 500s, overload).
- Cumulative token usage now shown in footer (total tokens used across all messages in session).
- Added `--system-prompt` flag to override default system prompt with custom text or file contents.
- Footer now shows estimated total cost in USD based on model pricing.

### Changed

- Replaced `--models` flag with `-m/--model` supporting multiple values. Specify models as `provider/model@thinking` (e.g., `anthropic/claude-sonnet-4-20250514@high`). Multiple `-m` flags scope available models for the session.
- Thinking level border now persists visually after selector closes.
- Improved tool result display with collapsible output (default collapsed, expand with `Ctrl+O`).

## [0.10.1] - 2025-11-25

### Added

- Add custom model configuration via `~/.omp/models.json`

## [0.10.0] - 2025-11-25

Initial public release.

### Added

- Interactive TUI with streaming responses
- Conversation session management with `--continue`, `--resume`, and `--session` flags
- Multi-line input support (Shift+Enter or Option+Enter for new lines)
- Tool execution: `read`, `write`, `edit`, `bash`, `glob`, `grep`, `think`
- Thinking mode support for Claude with visual indicator and `/thinking` selector
- File path autocompletion with `@` prefix
- Slash command autocompletion
- `/export` command for HTML session export
- `/model` command for runtime model switching
- `/session` command for session statistics
- Model provider support: Anthropic (Claude), OpenAI, Google (Gemini)
- Git branch display in footer
- Message queueing during streaming responses
- OAuth integration for Gmail and Google Calendar access
- HTML export with syntax highlighting and collapsible sections