import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { APP_NAME, getAgentDir } from "./config.ts";
import {
	CodexBarJsonError,
	CodexBarUnsafeOutputError,
	type CodexBarUsageWindowSummary,
	parseCodexBarCostJson,
	parseCodexBarUsageJson,
} from "./core/codexbar-adapter.ts";
import { spawnProcessSync } from "./utils/child-process.ts";
import { ensureTool } from "./utils/tools-manager.ts";

const CONNECTOR_FILE = "codexbar-connector.json";
const PRIVACY_ACK_VERSION = 1;
const USAGE = `${APP_NAME} quota <connect|disconnect|status|usage|cost> ...`;

type RunCommand = {
	readonly kind: "run";
	readonly metric: "usage" | "cost";
	readonly provider?: string;
	readonly json: boolean;
};

export type CodexBarQuotaCommand =
	| { readonly kind: "help" }
	| { readonly kind: "connect" }
	| { readonly kind: "disconnect" }
	| RunCommand
	| { readonly kind: "error"; readonly message: string };

export type CodexBarQuotaSpawnResult = {
	readonly stdout: string;
	readonly status: number | null;
	readonly signal: string | null;
	readonly error?: Error;
};

type CodexBarQuotaDeps = {
	readonly getAgentDir: () => string;
	readonly exists: (path: string) => boolean;
	readonly read: (path: string) => string;
	readonly write: (path: string, value: string) => void;
	readonly mkdir: (path: string) => void;
	readonly remove: (path: string) => void;
	readonly ensure: (tool: "codexbar", silent: true) => Promise<string | undefined>;
	readonly spawn: (command: string, args: readonly string[]) => CodexBarQuotaSpawnResult;
	readonly stdout: (text: string) => void;
	readonly stderr: (text: string) => void;
};

export type CodexBarQuotaCommandDeps = Partial<CodexBarQuotaDeps>;

const DEFAULT_DEPS: CodexBarQuotaDeps = {
	getAgentDir,
	exists: existsSync,
	read: (path) => readFileSync(path, "utf8"),
	write: (path, value) => writeFileSync(path, value, "utf8"),
	mkdir: (path) => mkdirSync(path, { recursive: true }),
	remove: (path) => rmSync(path, { force: true }),
	ensure: ensureTool,
	spawn: (command, args) =>
		spawnProcessSync(command, [...args], { encoding: "utf8", stdio: "pipe", shell: false, windowsHide: true }),
	stdout: (text) => process.stdout.write(text),
	stderr: (text) => process.stderr.write(text),
};

export function parseCodexBarQuotaCommand(args: readonly string[]): CodexBarQuotaCommand | undefined {
	if (args[0] !== "quota") return undefined;
	const subcommand = args[1];
	const rest = args.slice(2);
	if (subcommand === undefined) return { kind: "error", message: "Missing quota command." };
	if (subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
		return rest.length === 0 ? { kind: "help" } : { kind: "error", message: "Unexpected argument." };
	}
	if (subcommand === "connect" || subcommand === "disconnect") {
		if (rest[0] === undefined)
			return { kind: "error", message: `Missing target for quota ${subcommand}. Expected codexbar.` };
		if (rest[0] !== "codexbar") return { kind: "error", message: "Unexpected quota target. Expected codexbar." };
		return rest[1] === undefined ? { kind: subcommand } : { kind: "error", message: "Unexpected argument." };
	}
	if (subcommand === "status" || subcommand === "usage" || subcommand === "cost") {
		return parseRunCommand(subcommand === "cost" ? "cost" : "usage", rest);
	}
	return { kind: "error", message: "Unexpected quota command." };
}

export async function handleCodexBarQuotaCommand(
	args: readonly string[],
	deps: CodexBarQuotaCommandDeps = {},
): Promise<boolean> {
	const command = parseCodexBarQuotaCommand(args);
	if (command === undefined) return false;
	const d: CodexBarQuotaDeps = { ...DEFAULT_DEPS, ...deps };

	try {
		switch (command.kind) {
			case "help":
				printHelp(d);
				return true;
			case "error":
				return fail(d, 1, `${command.message}\n${chalk.dim(`Usage: ${USAGE}`)}`);
			case "connect":
				return connect(d);
			case "disconnect":
				return disconnect(d);
			case "run":
				return await run(command, d);
		}
	} catch (error) {
		if (error instanceof Error) return fail(d, 1, "CodexBar quota command failed.");
		throw error;
	}
}

function parseRunCommand(metric: RunCommand["metric"], args: readonly string[]): CodexBarQuotaCommand {
	let provider: string | undefined;
	let json = false;
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--json") {
			json = true;
			continue;
		}
		if (arg === "--provider") {
			const value = args[index + 1];
			if (value === undefined || value.startsWith("-") || value.trim().length === 0) {
				return { kind: "error", message: "Missing value for --provider." };
			}
			if (provider !== undefined) return { kind: "error", message: "--provider can only be provided once." };
			provider = value;
			index++;
			continue;
		}
		if (arg.startsWith("-")) return { kind: "error", message: "Unknown option for quota command." };
		return { kind: "error", message: "Unexpected argument." };
	}
	return { kind: "run", metric, provider, json };
}

function connect(d: CodexBarQuotaDeps): boolean {
	const dir = d.getAgentDir();
	const acknowledgement = {
		codexbar: { enabled: true, privacyAck: PRIVACY_ACK_VERSION, connectedAt: new Date().toISOString() },
	};
	d.mkdir(dir);
	d.write(connectorPath(d), `${JSON.stringify(acknowledgement, null, 2)}\n`);
	d.stdout(`${chalk.green("CodexBar quota connector enabled.")}\n`);
	return true;
}

function disconnect(d: CodexBarQuotaDeps): boolean {
	d.remove(connectorPath(d));
	d.stdout(`${chalk.green("CodexBar quota connector disabled.")}\n`);
	return true;
}

async function run(command: RunCommand, d: CodexBarQuotaDeps): Promise<boolean> {
	if (!connectorEnabled(d)) {
		return fail(
			d,
			1,
			`CodexBar quota connector is not enabled.\nRun \`${APP_NAME} quota connect codexbar\` to opt in before checking CodexBar quota.`,
		);
	}

	const codexbar = await d.ensure("codexbar", true);
	if (codexbar === undefined)
		return fail(d, 2, "CodexBar binary was not found.\nInstall codexbar on PATH, then rerun this command.");

	const result = d.spawn(codexbar, codexbarArgs(command));
	if (result.error !== undefined) return fail(d, 1, "Failed to run CodexBar.");
	if (result.status !== 0) {
		const reason = result.status === null ? `signal ${result.signal ?? "unknown"}` : `exit code ${result.status}`;
		return fail(d, 1, `CodexBar command failed (${reason}).`);
	}
	return printSummary(command, result.stdout, d);
}

function connectorPath(d: CodexBarQuotaDeps): string {
	return join(d.getAgentDir(), CONNECTOR_FILE);
}

function connectorEnabled(d: CodexBarQuotaDeps): boolean {
	const path = connectorPath(d);
	if (!d.exists(path)) return false;
	let parsed: unknown;
	try {
		parsed = JSON.parse(d.read(path));
	} catch (error) {
		if (error instanceof SyntaxError) return false;
		throw error;
	}
	return (
		isRecord(parsed) &&
		isRecord(parsed.codexbar) &&
		parsed.codexbar.enabled === true &&
		parsed.codexbar.privacyAck === PRIVACY_ACK_VERSION
	);
}

function codexbarArgs(command: RunCommand): readonly string[] {
	const args = command.metric === "cost" ? ["cost", "--format", "json"] : ["--format", "json"];
	return command.provider === undefined ? args : [...args, "--provider", command.provider];
}

function printSummary(command: RunCommand, stdout: string, d: CodexBarQuotaDeps): boolean {
	try {
		if (command.metric === "usage") {
			const summary = parseCodexBarUsageJson(stdout);
			d.stdout(command.json ? `${JSON.stringify(summary, null, 2)}\n` : usageText(summary));
			return true;
		}
		const summary = parseCodexBarCostJson(stdout);
		d.stdout(command.json ? `${JSON.stringify(summary, null, 2)}\n` : costText(summary));
		return true;
	} catch (error) {
		if (error instanceof CodexBarUnsafeOutputError)
			return fail(d, 3, "CodexBar returned unsafe output; refusing to display it.");
		if (error instanceof CodexBarJsonError) return fail(d, 3, "CodexBar returned invalid JSON.");
		throw error;
	}
}

function usageText(summary: ReturnType<typeof parseCodexBarUsageJson>): string {
	const lines = ["CodexBar usage", `Provider: ${summary.provider}`];
	if (summary.primary !== undefined) lines.push(windowText("Primary", summary.primary));
	if (summary.secondary !== undefined) lines.push(windowText("Secondary", summary.secondary));
	if (summary.creditsRemaining !== undefined) lines.push(`Credits remaining: ${summary.creditsRemaining}`);
	if (summary.status?.indicator !== undefined) lines.push(`Status: ${summary.status.indicator}`);
	if (summary.updatedAt !== undefined) lines.push(`Updated: ${summary.updatedAt}`);
	return `${lines.join("\n")}\n`;
}

function windowText(label: string, window: CodexBarUsageWindowSummary): string {
	const used = window.usedPercent === undefined ? "n/a" : `${window.usedPercent}% used`;
	return `${label}: ${used}${window.resetsAt === undefined ? "" : `, resets at ${window.resetsAt}`}`;
}

function costText(summary: ReturnType<typeof parseCodexBarCostJson>): string {
	if (summary.length === 0) return "CodexBar cost\nNo cost records reported.\n";
	const lines = ["CodexBar cost"];
	for (const entry of summary) {
		lines.push(`Provider: ${entry.provider}`);
		if (entry.sessionCostUSD !== undefined) lines.push(`  Session: $${entry.sessionCostUSD.toFixed(2)}`);
		if (entry.last30DaysCostUSD !== undefined) lines.push(`  Last 30 days: $${entry.last30DaysCostUSD.toFixed(2)}`);
		if (entry.totalCostUSD !== undefined) lines.push(`  Total: $${entry.totalCostUSD.toFixed(2)}`);
		if (entry.totalTokens !== undefined) lines.push(`  Total tokens: ${entry.totalTokens}`);
		if (entry.updatedAt !== undefined) lines.push(`  Updated: ${entry.updatedAt}`);
	}
	return `${lines.join("\n")}\n`;
}

function fail(d: CodexBarQuotaDeps, exitCode: number, message: string): boolean {
	d.stderr(`${chalk.red(message)}\n`);
	process.exitCode = exitCode;
	return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function printHelp(d: CodexBarQuotaDeps): void {
	d.stdout(`${chalk.bold("Usage:")}
  ${APP_NAME} quota --help
  ${APP_NAME} quota connect codexbar
  ${APP_NAME} quota disconnect codexbar
  ${APP_NAME} quota status [--provider <id|both|all>] [--json]
  ${APP_NAME} quota usage [--provider <id|both|all>] [--json]
  ${APP_NAME} quota cost [--provider <id|both|all>] [--json]

CodexBar quota commands require an explicit local opt-in acknowledgement.
The acknowledgement stores no secrets and OMK does not read or write CodexBar config.
`);
}
