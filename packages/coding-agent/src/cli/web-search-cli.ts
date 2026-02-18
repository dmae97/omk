/**
 * Web search CLI command handlers.
 *
 * Handles `omp q`/`omp web-search` subcommands for testing web search providers.
 */

import { APP_NAME } from "@oh-my-pi/pi-utils/dirs";
import chalk from "chalk";
import { initTheme, theme } from "../modes/theme/theme";
import { runSearchQuery, type SearchParams } from "../web/search/index";
import { renderSearchResult } from "../web/search/render";
import type { SearchProviderId } from "../web/search/types";

export interface SearchCommandArgs {
	query: string;
	provider?: SearchProviderId | "auto";
	recency?: "day" | "week" | "month" | "year";
	limit?: number;
	expanded: boolean;
}

const PROVIDERS: Array<SearchProviderId | "auto"> = [
	"auto",
	"anthropic",
	"perplexity",
	"exa",
	"brave",
	"jina",
	"zai",
	"gemini",
	"codex",
	"synthetic",
];

const RECENCY_OPTIONS: SearchCommandArgs["recency"][] = ["day", "week", "month", "year"];

/**
 * Parse web search subcommand arguments.
 * Returns undefined if not a web search command.
 */
export function parseSearchArgs(args: string[]): SearchCommandArgs | undefined {
	if (args.length === 0 || (args[0] !== "q" && args[0] !== "web-search")) {
		return undefined;
	}

	const result: SearchCommandArgs = {
		query: "",
		expanded: true,
	};

	const positional: string[] = [];

	for (let i = 1; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--provider") {
			result.provider = args[++i] as SearchCommandArgs["provider"];
		} else if (arg === "--recency") {
			result.recency = args[++i] as SearchCommandArgs["recency"];
		} else if (arg === "--limit" || arg === "-l") {
			result.limit = Number.parseInt(args[++i], 10);
		} else if (arg === "--compact") {
			result.expanded = false;
		} else if (!arg.startsWith("-")) {
			positional.push(arg);
		}
	}

	if (positional.length > 0) {
		result.query = positional.join(" ");
	}

	return result;
}

export async function runSearchCommand(cmd: SearchCommandArgs): Promise<void> {
	if (!cmd.query) {
		writeStderr(chalk.red("Error: Query is required"));
		process.exit(1);
	}

	if (cmd.provider && !PROVIDERS.includes(cmd.provider)) {
		writeStderr(chalk.red(`Error: Unknown provider "${cmd.provider}"`));
		writeStderr(chalk.dim(`Valid providers: ${PROVIDERS.join(", ")}`));
		process.exit(1);
	}

	if (cmd.recency && !RECENCY_OPTIONS.includes(cmd.recency)) {
		writeStderr(chalk.red(`Error: Invalid recency "${cmd.recency}"`));
		writeStderr(chalk.dim(`Valid recency values: ${RECENCY_OPTIONS.join(", ")}`));
		process.exit(1);
	}

	if (cmd.limit !== undefined && Number.isNaN(cmd.limit)) {
		writeStderr(chalk.red("Error: --limit must be a number"));
		process.exit(1);
	}

	await initTheme();

	const params: SearchParams = {
		query: cmd.query,
		provider: cmd.provider,
		recency: cmd.recency,
		limit: cmd.limit,
		no_fallback: cmd.provider !== undefined && cmd.provider !== "auto",
	};

	const result = await runSearchQuery(params);
	const component = renderSearchResult(result, { expanded: cmd.expanded, isPartial: false }, theme, {
		query: cmd.query,
		provider: cmd.provider,
		allowLongAnswer: true,
		maxAnswerLines: cmd.expanded ? undefined : 6,
	});

	const width = Math.max(60, process.stdout.columns ?? 100);
	writeStdout(component.render(width).join("\n"));

	if (result.details?.error) {
		process.exitCode = 1;
	}
}

export function printSearchHelp(): void {
	writeStdout(`${chalk.bold(`${APP_NAME} q`)} - Test web search providers

${chalk.bold("Usage:")}
  ${APP_NAME} q [options] <query>
  ${APP_NAME} web-search [options] <query>

${chalk.bold("Arguments:")}
  query      Search query text

${chalk.bold("Options:")}
  --provider <name>   Provider: ${PROVIDERS.join(", ")}
  --recency <value>   Recency filter (Brave/Perplexity): ${RECENCY_OPTIONS.join(", ")}
  -l, --limit <n>     Max results to return
  --compact           Render condensed output
  -h, --help          Show this help

${chalk.bold("Examples:")}
  ${APP_NAME} q --provider=exa "what's the color of the sky"
  ${APP_NAME} q --provider=brave --recency=week "latest TypeScript 5.7 changes"
`);
}

function writeStdout(message: string): void {
	process.stdout.write(`${message}\n`);
}

function writeStderr(message: string): void {
	process.stderr.write(`${message}\n`);
}
