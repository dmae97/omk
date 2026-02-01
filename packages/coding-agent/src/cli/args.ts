/**
 * CLI argument parsing and help display
 */
import type { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import chalk from "chalk";
import { APP_NAME, CONFIG_DIR_NAME, ENV_AGENT_DIR } from "../config";
import { BUILTIN_TOOLS } from "../tools";

export type Mode = "text" | "json" | "rpc";

export interface Args {
	cwd?: string;
	allowHome?: boolean;
	provider?: string;
	model?: string;
	smol?: string;
	slow?: string;
	plan?: string;
	apiKey?: string;
	systemPrompt?: string;
	appendSystemPrompt?: string;
	thinking?: ThinkingLevel;
	continue?: boolean;
	resume?: boolean;
	help?: boolean;
	version?: boolean;
	mode?: Mode;
	noSession?: boolean;
	session?: string;
	sessionDir?: string;
	models?: string[];
	tools?: string[];
	noTools?: boolean;
	noLsp?: boolean;
	hooks?: string[];
	extensions?: string[];
	noExtensions?: boolean;
	print?: boolean;
	export?: string;
	noSkills?: boolean;
	skills?: string[];
	listModels?: string | true;
	noTitle?: boolean;
	messages: string[];
	fileArgs: string[];
	/** Unknown flags (potentially extension flags) - map of flag name to value */
	unknownFlags: Map<string, boolean | string>;
}

const VALID_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

export function isValidThinkingLevel(level: string): level is ThinkingLevel {
	return VALID_THINKING_LEVELS.includes(level as ThinkingLevel);
}

export function parseArgs(args: string[], extensionFlags?: Map<string, { type: "boolean" | "string" }>): Args {
	const result: Args = {
		messages: [],
		fileArgs: [],
		unknownFlags: new Map(),
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		if (arg === "--help" || arg === "-h") {
			result.help = true;
		} else if (arg === "--version" || arg === "-v") {
			result.version = true;
		} else if (arg === "--allow-home") {
			result.allowHome = true;
		} else if (arg === "--mode" && i + 1 < args.length) {
			const mode = args[++i];
			if (mode === "text" || mode === "json" || mode === "rpc") {
				result.mode = mode;
			}
		} else if (arg === "--continue" || arg === "-c") {
			result.continue = true;
		} else if (arg === "--resume" || arg === "-r") {
			result.resume = true;
		} else if (arg === "--provider" && i + 1 < args.length) {
			result.provider = args[++i];
		} else if (arg === "--model" && i + 1 < args.length) {
			result.model = args[++i];
		} else if (arg === "--smol" && i + 1 < args.length) {
			result.smol = args[++i];
		} else if (arg === "--slow" && i + 1 < args.length) {
			result.slow = args[++i];
		} else if (arg === "--plan" && i + 1 < args.length) {
			result.plan = args[++i];
		} else if (arg === "--api-key" && i + 1 < args.length) {
			result.apiKey = args[++i];
		} else if (arg === "--system-prompt" && i + 1 < args.length) {
			result.systemPrompt = args[++i];
		} else if (arg === "--append-system-prompt" && i + 1 < args.length) {
			result.appendSystemPrompt = args[++i];
		} else if (arg === "--no-session") {
			result.noSession = true;
		} else if (arg === "--session" && i + 1 < args.length) {
			result.session = args[++i];
		} else if (arg === "--session-dir" && i + 1 < args.length) {
			result.sessionDir = args[++i];
		} else if (arg === "--models" && i + 1 < args.length) {
			result.models = args[++i].split(",").map(s => s.trim());
		} else if (arg === "--no-tools") {
			result.noTools = true;
		} else if (arg === "--no-lsp") {
			result.noLsp = true;
		} else if (arg === "--tools" && i + 1 < args.length) {
			const toolNames = args[++i].split(",").map(s => s.trim());
			const validTools: string[] = [];
			for (const name of toolNames) {
				if (name in BUILTIN_TOOLS) {
					validTools.push(name);
				} else {
					console.error(
						chalk.yellow(
							`Warning: Unknown tool "${name}". Valid tools: ${Object.keys(BUILTIN_TOOLS).join(", ")}`,
						),
					);
				}
			}
			result.tools = validTools;
		} else if (arg === "--thinking" && i + 1 < args.length) {
			const level = args[++i];
			if (isValidThinkingLevel(level)) {
				result.thinking = level;
			} else {
				console.error(
					chalk.yellow(
						`Warning: Invalid thinking level "${level}". Valid values: ${VALID_THINKING_LEVELS.join(", ")}`,
					),
				);
			}
		} else if (arg === "--print" || arg === "-p") {
			result.print = true;
		} else if (arg === "--export" && i + 1 < args.length) {
			result.export = args[++i];
		} else if (arg === "--hook" && i + 1 < args.length) {
			result.hooks = result.hooks ?? [];
			result.hooks.push(args[++i]);
		} else if ((arg === "--extension" || arg === "-e") && i + 1 < args.length) {
			result.extensions = result.extensions ?? [];
			result.extensions.push(args[++i]);
		} else if (arg === "--no-extensions") {
			result.noExtensions = true;
		} else if (arg === "--no-skills") {
			result.noSkills = true;
		} else if (arg === "--no-title") {
			result.noTitle = true;
		} else if (arg === "--skills" && i + 1 < args.length) {
			// Comma-separated glob patterns for skill filtering
			result.skills = args[++i].split(",").map(s => s.trim());
		} else if (arg === "--list-models") {
			// Check if next arg is a search pattern (not a flag or file arg)
			if (i + 1 < args.length && !args[i + 1].startsWith("-") && !args[i + 1].startsWith("@")) {
				result.listModels = args[++i];
			} else {
				result.listModels = true;
			}
		} else if (arg.startsWith("@")) {
			result.fileArgs.push(arg.slice(1)); // Remove @ prefix
		} else if (arg.startsWith("--") && extensionFlags) {
			// Check if it's an extension-registered flag
			const flagName = arg.slice(2);
			const extFlag = extensionFlags.get(flagName);
			if (extFlag) {
				if (extFlag.type === "boolean") {
					result.unknownFlags.set(flagName, true);
				} else if (extFlag.type === "string" && i + 1 < args.length) {
					result.unknownFlags.set(flagName, args[++i]);
				}
			}
			// Unknown flags without extensionFlags are silently ignored (first pass)
		} else if (!arg.startsWith("-")) {
			result.messages.push(arg);
		}
	}

	return result;
}

export function printHelp(): void {
	console.log(`${chalk.bold(APP_NAME)} - AI coding assistant with read, bash, edit, write tools

${chalk.bold("Usage:")}
  ${APP_NAME} [options] [@files...] [messages...]

${chalk.bold("Subcommands:")}
  plugin    Manage plugins (install, uninstall, list, etc.)
  update    Check for and install updates
  config    Manage configuration settings
  setup     Install dependencies for optional features
  shell     Interactive shell console (brush-core test)

${chalk.bold("Options:")}
  --model <pattern>              Model to use (fuzzy match: "opus", "gpt-5.2", or "p-openai/gpt-5.2")
   --smol <id>                    Smol/fast model for lightweight tasks (or OMP_SMOL_MODEL env)
   --slow <id>                    Slow/reasoning model for thorough analysis (or OMP_SLOW_MODEL env)
   --plan <id>                    Plan model for architectural planning (or OMP_PLAN_MODEL env)
  --api-key <key>                API key (defaults to env vars)
  --system-prompt <text>         System prompt (default: coding assistant prompt)
  --append-system-prompt <text>  Append text or file contents to the system prompt
  --allow-home                   Allow starting in ~ without auto-switching to a temp dir
  --mode <mode>                  Output mode: text (default), json, or rpc
  --print, -p                    Non-interactive mode: process prompt and exit
  --continue, -c                 Continue previous session
  --resume, -r                   Select a session to resume
  --session <path>               Use specific session file
  --session-dir <dir>            Directory for session storage and lookup
  --no-session                   Don't save session (ephemeral)
  --models <patterns>            Comma-separated model patterns for Ctrl+P cycling
                                 Supports globs (anthropic/*, *sonnet*) and fuzzy matching
  --no-tools                     Disable all built-in tools
  --no-lsp                       Disable LSP tools, formatting, and diagnostics
  --tools <tools>                Comma-separated list of tools to enable (default: read,bash,edit,write)
                                 Available: read, bash, edit, write, grep, find, ls
  --thinking <level>             Set thinking level: off, minimal, low, medium, high, xhigh
  --hook <path>                  Load a hook/extension file (can be used multiple times)
  --extension, -e <path>         Load an extension file (can be used multiple times)
  --no-extensions                Disable extension discovery (explicit -e paths still work)
  --no-skills                    Disable skills discovery and loading
  --skills <patterns>            Comma-separated glob patterns to filter skills (e.g., git-*,docker)
  --export <file>                Export session file to HTML and exit
  --list-models [search]         List available models (with optional fuzzy search)
  --help, -h                     Show this help
  --version, -v                  Show version number

${chalk.bold("Examples:")}
  # Interactive mode
  ${APP_NAME}

  # Interactive mode with initial prompt
  ${APP_NAME} "List all .ts files in src/"

  # Include files in initial message
  ${APP_NAME} @prompt.md @image.png "What color is the sky?"

  # Non-interactive mode (process and exit)
  ${APP_NAME} -p "List all .ts files in src/"

  # Multiple messages (interactive)
  ${APP_NAME} "Read package.json" "What dependencies do we have?"

  # Continue previous session
  ${APP_NAME} --continue "What did we discuss?"

  # Use different model (fuzzy matching)
  ${APP_NAME} --model opus "Help me refactor this code"

  # Limit model cycling to specific models
  ${APP_NAME} --models claude-sonnet,claude-haiku,gpt-4o

  # Limit to a specific provider with glob pattern
  ${APP_NAME} --models "github-copilot/*"

  # Cycle models with fixed thinking levels
  ${APP_NAME} --models sonnet:high,haiku:low

  # Start with a specific thinking level
  ${APP_NAME} --thinking high "Solve this complex problem"

  # Read-only mode (no file modifications possible)
  ${APP_NAME} --tools read,grep,find,ls -p "Review the code in src/"

  # Export a session file to HTML
  ${APP_NAME} --export ~/${CONFIG_DIR_NAME}/agent/sessions/--path--/session.jsonl
  ${APP_NAME} --export session.jsonl output.html

${chalk.bold("Environment Variables:")}
  ${chalk.dim("# Model providers")}
  ANTHROPIC_API_KEY       - Anthropic Claude API key
  ANTHROPIC_OAUTH_TOKEN   - Anthropic OAuth token (alternative to API key)
  OPENAI_API_KEY          - OpenAI GPT API key
  GEMINI_API_KEY          - Google Gemini API key
  GROQ_API_KEY            - Groq API key
  CEREBRAS_API_KEY        - Cerebras API key
  XAI_API_KEY             - xAI Grok API key
  OPENROUTER_API_KEY      - OpenRouter API key
  MISTRAL_API_KEY         - Mistral API key
  ZAI_API_KEY             - ZAI API key
  GITHUB_TOKEN            - GitHub Copilot models (or GH_TOKEN, COPILOT_GITHUB_TOKEN)

  ${chalk.dim("# Web search providers")}
  EXA_API_KEY             - Exa search API key
  PERPLEXITY_API_KEY      - Perplexity search API key

  ${chalk.dim("# Configuration")}
  ${ENV_AGENT_DIR.padEnd(23)} - Session storage directory (default: ~/${CONFIG_DIR_NAME}/agent)

${chalk.bold("Available Tools (all enabled by default):")}
  read       - Read file contents
  bash       - Execute bash commands
  edit       - Edit files with find/replace
  write      - Write files (creates/overwrites)
  grep       - Search file contents
  find       - Find files by glob pattern
  ls         - List directory contents
  lsp        - Language server protocol (code intelligence)
  python     - Execute Python code (requires: ${APP_NAME} setup python)
  notebook   - Edit Jupyter notebooks
  task       - Launch sub-agents for parallel tasks
  fetch      - Fetch and process URLs
  web_search - Search the web
  ask        - Ask user questions (interactive mode only)
`);
}
