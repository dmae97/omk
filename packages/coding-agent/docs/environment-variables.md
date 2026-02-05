# Environment Variables Reference

This document lists all environment variables used by the coding agent.

## API Keys

### Multi-Provider Support

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key for GPT models | - |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude models | - |
| `ANTHROPIC_OAUTH_TOKEN` | Anthropic OAuth token (takes precedence over `ANTHROPIC_API_KEY`) | - |
| `GOOGLE_API_KEY` | Google Gemini API key | - |
| `COPILOT_GITHUB_TOKEN` | GitHub Copilot personal access token | `$GH_TOKEN` or `$GITHUB_TOKEN` |
| `GH_TOKEN` | GitHub CLI token (fallback for Copilot) | - |
| `GITHUB_TOKEN` | GitHub token (fallback for Copilot and API access) | - |
| `EXA_API_KEY` | Exa search API key | - |
| `GROQ_API_KEY` | Groq API key for Llama and other models | - |
| `CEREBRAS_API_KEY` | Cerebras API key | - |
| `XAI_API_KEY` | xAI API key for Grok models | - |
| `OPENROUTER_API_KEY` | OpenRouter aggregated models API key | - |
| `MISTRAL_API_KEY` | Mistral AI API key | - |
| `ZAI_API_KEY` | z.ai API key (ZhipuAI/GLM models) | - |
| `MINIMAX_API_KEY` | MiniMax API key | - |
| `OPENCODE_API_KEY` | OpenCode API key | - |
| `CURSOR_ACCESS_TOKEN` | Cursor AI access token | - |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway API key | - |
| `PERPLEXITY_API_KEY` | Perplexity search API key | - |

### Provider-Specific Configuration

#### AWS Bedrock

| Variable | Description | Default |
|----------|-------------|---------|
| `AWS_REGION` | AWS region for Bedrock | `$AWS_DEFAULT_REGION` or `us-east-1` |
| `AWS_DEFAULT_REGION` | AWS default region | - |
| `AWS_PROFILE` | AWS CLI profile name | - |
| `AWS_ACCESS_KEY_ID` | AWS access key ID | - |
| `AWS_SECRET_ACCESS_KEY` | AWS secret access key | - |
| `AWS_BEARER_TOKEN_BEDROCK` | AWS bearer token for Bedrock | - |
| `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` | ECS container credentials URI | - |
| `AWS_CONTAINER_CREDENTIALS_FULL_URI` | ECS container credentials full URI | - |
| `AWS_WEB_IDENTITY_TOKEN_FILE` | Web identity token file path | - |
| `AWS_ROLE_ARN` | IAM role ARN for web identity | - |

#### Azure OpenAI

| Variable | Description | Default |
|----------|-------------|---------|
| `AZURE_OPENAI_API_KEY` | Azure OpenAI API key (required) | - |
| `AZURE_OPENAI_API_VERSION` | Azure OpenAI API version | `2024-10-01-preview` |
| `AZURE_OPENAI_BASE_URL` | Azure OpenAI base URL | Constructed from resource name |
| `AZURE_OPENAI_RESOURCE_NAME` | Azure OpenAI resource name | - |
| `AZURE_OPENAI_DEPLOYMENT_NAME_MAP` | JSON map of model IDs to deployment names | `{}` |

#### Google Cloud (Vertex AI)

| Variable | Description | Default |
|----------|-------------|---------|
| `GOOGLE_CLOUD_PROJECT` | Google Cloud project ID (required for Vertex AI) | `$GCLOUD_PROJECT` |
| `GCLOUD_PROJECT` | Google Cloud project ID (alternative) | - |
| `GOOGLE_CLOUD_PROJECT_ID` | Google Cloud project ID (used during OAuth discovery) | `$GOOGLE_CLOUD_PROJECT` |
| `GOOGLE_CLOUD_LOCATION` | Google Cloud location (required for Vertex AI) | - |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to Google service account JSON | - |

#### Anthropic Search & Custom Base URLs

| Variable | Description | Default |
|----------|-------------|---------|
| `ANTHROPIC_BASE_URL` | Custom Anthropic API base URL | - |
| `ANTHROPIC_SEARCH_API_KEY` | API key for Anthropic search (separate from main API) | - |
| `ANTHROPIC_SEARCH_BASE_URL` | Custom base URL for Anthropic search | - |
| `ANTHROPIC_SEARCH_MODEL` | Model to use for web search | `claude-sonnet-4` |

#### Kimi

| Variable | Description | Default |
|----------|-------------|---------|
| `KIMI_CODE_BASE_URL` | Kimi Code API base URL | `https://kimi.moonshot.cn` |
| `KIMI_CODE_OAUTH_HOST` | Kimi Code OAuth host | `$KIMI_OAUTH_HOST` or `https://kimi.moonshot.cn` |
| `KIMI_OAUTH_HOST` | Kimi OAuth host (fallback) | - |

## Model Configuration

### Model Role Overrides

Override model roles via environment variables (ephemeral, not persisted):

| Variable | Description | CLI Flag |
|----------|-------------|----------|
| `PI_SMOL_MODEL` | Fast model for lightweight tasks | `--smol` |
| `PI_SLOW_MODEL` | Reasoning model for thorough analysis | `--slow` |
| `PI_PLAN_MODEL` | Model for architectural planning | `--plan` |

## Agent Configuration

### Core Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `PI_CODING_AGENT_DIR` | Directory for agent data (sessions, auth, cache) | `~/.omp/agent` |
| `PI_SUBPROCESS_CMD` | Custom command for spawning subagents | Auto-detected |
| `PI_NO_TITLE` | Disable automatic session title generation | `false` |
| `NULL_PROMPT` | Use empty system prompt (testing) | `false` |
| `PI_BLOCKED_AGENT` | Override agent type in task tool | - |

### Caching

| Variable | Description | Default |
|----------|-------------|---------|
| `PI_CACHE_RETENTION` | Prompt cache retention (`long` = 24h for OpenAI) | - |

## Python Configuration

### Python Kernel

| Variable | Description | Default |
|----------|-------------|---------|
| `VIRTUAL_ENV` | Python virtual environment path | Auto-detected (`.venv` or `venv`) |
| `PI_PY` | Python tool mode (`per-session`, `per-call`, `off`) | `per-session` |
| `PI_PYTHON_SKIP_CHECK` | Skip Python availability check (testing) | `false` |

### External Python Gateway

| Variable | Description | Default |
|----------|-------------|---------|
| `PI_PYTHON_GATEWAY_URL` | External Python gateway URL | - |
| `PI_PYTHON_GATEWAY_TOKEN` | Authentication token for gateway | - |

### Debugging

| Variable | Description | Default |
|----------|-------------|---------|
| `PI_PYTHON_IPC_TRACE` | Trace Python IPC messages (`1` = enabled) | `false` |

## Task & Subagent Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PI_TASK_MAX_OUTPUT_BYTES` | Maximum output bytes per subagent | `500000` |
| `PI_TASK_MAX_OUTPUT_LINES` | Maximum output lines per subagent | `5000` |

## TUI & Terminal Configuration

### Terminal Capabilities

| Variable | Description | Auto-Detected |
|----------|-------------|---------------|
| `COLORTERM` | Terminal color support (`truecolor`, `24bit`) | Yes |
| `COLORFGBG` | Terminal foreground/background colors | Yes |
| `TERM` | Terminal type | Yes |
| `TERM_PROGRAM` | Terminal program name | Yes |
| `TERM_PROGRAM_VERSION` | Terminal program version | Yes |
| `TERMINAL_EMULATOR` | Terminal emulator name | Yes |
| `WT_SESSION` | Windows Terminal session ID | Yes |

### TUI Behavior

| Variable | Description | Default |
|----------|-------------|---------|
| `PI_NOTIFICATIONS` | Desktop notifications (`off`, `0`, `false` = disabled) | Enabled |
| `PI_TUI_WRITE_LOG` | Log all TUI write operations to file | - |
| `PI_HARDWARE_CURSOR` | Show hardware cursor (`1` = enabled) | `false` |

## Bash & Shell Configuration

### Shell Detection

| Variable | Description | Auto-Detected |
|----------|-------------|---------------|
| `SHELL` | User's default shell | Yes (Unix) |
| `ComSpec` | Command processor | Yes (Windows) |

### Editor

| Variable | Description | Fallback |
|----------|-------------|----------|
| `VISUAL` | Visual editor for external editing (Ctrl+G) | `$EDITOR` |
| `EDITOR` | Default text editor | - |

### Bash Tool Behavior

| Variable | Description | Default |
|----------|-------------|---------|
| `PI_BASH_NO_CI` | Don't set `CI=true` in bash environment | `$CLAUDE_BASH_NO_CI` |
| `CLAUDE_BASH_NO_CI` | Legacy name for `PI_BASH_NO_CI` | - |
| `PI_BASH_NO_LOGIN` | Don't use login shell for bash | `$CLAUDE_BASH_NO_LOGIN` |
| `CLAUDE_BASH_NO_LOGIN` | Legacy name for `PI_BASH_NO_LOGIN` | - |
| `PI_SHELL_PREFIX` | Prefix for bash commands | `$CLAUDE_CODE_SHELL_PREFIX` |
| `CLAUDE_CODE_SHELL_PREFIX` | Legacy name for `PI_SHELL_PREFIX` | - |

## Desktop Environment Detection

These are auto-detected for system prompt context:

| Variable | Purpose |
|----------|---------|
| `KDE_FULL_SESSION` | Detect KDE desktop |
| `XDG_CURRENT_DESKTOP` | Current desktop environment |
| `DESKTOP_SESSION` | Desktop session name |
| `XDG_SESSION_DESKTOP` | XDG desktop session |
| `GDMSESSION` | GDM session type |
| `WINDOWMANAGER` | Window manager name |
| `XDG_CONFIG_HOME` | User config directory |
| `APPDATA` | Windows app data directory |
| `HOME` | User home directory |

## LSP Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PI_DISABLE_LSPMUX` | Disable lspmux integration (`1` = disabled) | `false` |

## Debugging & Development

### General Debugging

| Variable | Description | Default |
|----------|-------------|---------|
| `DEBUG` | Enable debug logging | `false` |
| `PI_DEV` | Development mode (verbose native addon loading) | `false` |
| `PI_TIMING` | Log tool factory and operation timings (`1` = enabled) | `false` |

### Startup Debugging

| Variable | Description | Default |
|----------|-------------|---------|
| `PI_DEBUG_STARTUP` | Print startup stage timings to stderr | `false` |

### Provider-Specific Debugging

| Variable | Description | Default |
|----------|-------------|---------|
| `DEBUG_CURSOR` | Cursor provider debug logging (`1` = basic, `2` or `verbose` = detailed) | `false` |
| `DEBUG_CURSOR_LOG` | Path to write Cursor debug log file | - |
| `PI_CODEX_DEBUG` | OpenAI Codex debug logging (`1` or `true` = enabled) | `false` |

## Commit Message Generation

| Variable | Description | Default |
|----------|-------------|---------|
| `PI_COMMIT_TEST_FALLBACK` | Force fallback commit generation (testing) | `false` |
| `PI_COMMIT_NO_FALLBACK` | Disable fallback commit generation | `false` |
| `PI_COMMIT_MAP_REDUCE` | Enable/disable map-reduce for large diffs (`false` = disabled) | Enabled |

## Testing & CI

These are auto-detected but documented for completeness:

| Variable | Description |
|----------|-------------|
| `BUN_ENV` | Bun environment (`test` skips certain checks) |
| `NODE_ENV` | Node environment (`test` skips certain checks) |
| `E2E` | Enable end-to-end tests (`1` or `true`) |
| `PI_NO_LOCAL_LLM` | Skip local LLM tests (Ollama, LM Studio) |
