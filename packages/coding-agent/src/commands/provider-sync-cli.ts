/**
 * `omk provider sync <provider-id>`: refresh a codex-chatgpt-web provider's models.json rows from
 * the launcher's live catalog.
 *
 * The bridge's `/v1/models` is forwarded to the Codex backend, so the request carries OMK's own
 * Codex OAuth and a `client_version`; the placeholder bearer in models.json cannot authenticate
 * there. Prints a change report (or one JSON document with `--json`) and exits 0 = synced or
 * already current, 1 = sync failed, 2 = usage error. Usage errors never echo argument values.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APP_NAME, getAgentDir } from "../config.ts";
import { AuthStorage } from "../core/auth-storage.ts";
import {
	type BridgeSyncPlan,
	CODEX_CHATGPT_WEB_FALLBACK_CLIENT_VERSION,
	CODEX_CHATGPT_WEB_MODEL_PREFIX,
} from "../core/codex-chatgpt-web-bridge.ts";
import {
	BridgeSyncFailure,
	type BridgeSyncIo,
	type BridgeSyncReport,
	hasBridgeSyncChanges,
	syncCodexChatGptWebProvider,
} from "../core/codex-chatgpt-web-sync.ts";
import { spawnProcessSync } from "../utils/child-process.ts";

const USAGE = `Usage: ${APP_NAME} provider sync <provider-id> [--dry-run] [--json] [--timeout <ms>] [--client-version <x.y.z>]`;
const HELP = [
	"Provider sync: rewrite a codex-chatgpt-web provider's models.json rows from the launcher's live catalog.",
	"",
	USAGE,
	"",
	"  --dry-run                 report the changes without writing models.json",
	"  --json                    print one JSON document instead of the text report",
	"  --timeout <ms>            network timeout per request (default 15000)",
	"  --client-version <x.y.z>  Codex client version sent to the catalog (default: OMK_CODEX_CLIENT_VERSION,",
	"                            then `codex --version`, then the version OMK last verified)",
	"",
	"The bridge forwards /v1/models to the Codex backend with OMK's openai-codex OAuth (/login openai-codex).",
	"Exit codes: 0 = synced or already current, 1 = sync failed, 2 = usage error.",
].join("\n");
const DEFAULT_TIMEOUT_MS = 15_000;
const CODEX_VERSION_PROBE_TIMEOUT_MS = 5_000;

export interface ProviderSyncCliDependencies {
	readonly agentDir?: string;
	readonly env?: Readonly<Record<string, string | undefined>>;
	readonly readFile?: BridgeSyncIo["readFile"];
	readonly writeFile?: BridgeSyncIo["writeFile"];
	readonly fetch?: BridgeSyncIo["fetch"];
	readonly getCodexAccessToken?: BridgeSyncIo["getCodexAccessToken"];
	readonly detectCodexVersion?: () => string | undefined;
	readonly now?: BridgeSyncIo["now"];
	readonly writeLine?: (line: string) => void;
}

export interface ProviderSyncCliOutcome {
	readonly handled: boolean;
	readonly exitCode: number;
}

interface ParsedSyncArgs {
	readonly providerId: string;
	readonly dryRun: boolean;
	readonly json: boolean;
	readonly timeoutMs: number;
	readonly clientVersion: string | undefined;
}

type ParseOutcome =
	| { readonly kind: "absent" }
	| { readonly kind: "help" }
	| { readonly kind: "error"; readonly message: string }
	| { readonly kind: "ok"; readonly parsed: ParsedSyncArgs };

function parseOption(arg: string, value: string | undefined): { kind: "error"; message: string } | undefined {
	if (value === undefined || value.startsWith("-")) return { kind: "error", message: `Missing value for ${arg}.` };
	if (arg === "--timeout" && !/^[1-9]\d*$/.test(value)) {
		return { kind: "error", message: "--timeout must be a positive integer of milliseconds." };
	}
	return undefined;
}

function parseArgs(args: readonly string[]): ParseOutcome {
	if (args[0] !== "provider" || args[1] !== "sync") return { kind: "absent" };
	let providerId: string | undefined;
	let dryRun = false;
	let json = false;
	let timeoutMs = DEFAULT_TIMEOUT_MS;
	let clientVersion: string | undefined;
	for (let index = 2; index < args.length; index += 1) {
		const arg = args[index] ?? "";
		if (arg === "--help" || arg === "-h") return { kind: "help" };
		if (arg === "--dry-run") dryRun = true;
		else if (arg === "--json") json = true;
		else if (arg === "--timeout" || arg === "--client-version") {
			const value = args[index + 1];
			const invalid = parseOption(arg, value);
			if (invalid) return invalid;
			if (arg === "--timeout") timeoutMs = Number(value);
			else clientVersion = value;
			index += 1;
		} else if (arg.startsWith("-")) return { kind: "error", message: "Unknown option for provider sync." };
		else if (providerId === undefined) providerId = arg;
		else return { kind: "error", message: "Unexpected extra argument." };
	}
	if (providerId === undefined) return { kind: "error", message: "Missing provider id." };
	return { kind: "ok", parsed: { providerId, dryRun, json, timeoutMs, clientVersion } };
}

function detectCodexVersion(): string | undefined {
	const result = spawnProcessSync("codex", ["--version"], {
		encoding: "utf8",
		stdio: "pipe",
		shell: false,
		windowsHide: true,
		timeout: CODEX_VERSION_PROBE_TIMEOUT_MS,
	});
	if (result.error !== undefined || result.status !== 0) return undefined;
	return /\d+\.\d+\.\d+/.exec(result.stdout)?.[0];
}

function writeFileAtomically(path: string, text: string): void {
	const staging = `${path}.${process.pid}.tmp`;
	writeFileSync(staging, text, "utf8");
	renameSync(staging, path);
}

function planLines(plan: BridgeSyncPlan): readonly string[] {
	return [
		...plan.changes.map(
			(change) => `  ~ ${change.id} ${change.field} ${JSON.stringify(change.from)} -> ${JSON.stringify(change.to)}`,
		),
		...plan.added.map((id) => `  + ${id} (added)`),
		...plan.removed.map((id) => `  - ${id} (removed: the bridge no longer serves it)`),
	];
}

function printReport(parsed: ParsedSyncArgs, report: BridgeSyncReport, writeLine: (line: string) => void): void {
	const { modelsPath, baseUrl, health, clientVersion, plan, bridgeCatalog, written } = report;
	if (parsed.json) {
		const { models: _models, ...delta } = plan;
		const bridge = { ...health, baseUrl };
		const document = {
			provider: parsed.providerId,
			bridge,
			clientVersion,
			bridgeCatalog,
			...delta,
			written,
			modelsPath,
		};
		writeLine(JSON.stringify(document, null, 2));
		return;
	}
	const turns = health.acceptingTurns ? "accepting turns" : "draining";
	const served = plan.models.filter((model) => model.id.startsWith(CODEX_CHATGPT_WEB_MODEL_PREFIX)).length;
	const ceilings = Object.entries(bridgeCatalog.contextCeilings)
		.map(([id, ceiling]) => `${id.slice(CODEX_CHATGPT_WEB_MODEL_PREFIX.length)}=${ceiling}`)
		.join(" ");
	writeLine(`codex-chatgpt-web bridge ${health.version} (${health.mode} mode, ${turns}) at ${baseUrl}`);
	writeLine(`catalog: ${served} chatgpt-web/* models (client_version ${clientVersion})`);
	writeLine(`contextWindow follows the bridge's auto_compact_token_limit; rejection ceilings: ${ceilings}`);
	for (const line of planLines(plan)) writeLine(line);
	if (!hasBridgeSyncChanges(plan) && !written) writeLine(`${modelsPath} already matches the bridge.`);
	else writeLine(written ? `wrote ${modelsPath}` : `dry run: ${modelsPath} not written`);
}

export async function runProviderSyncCli(
	args: readonly string[],
	overrides: ProviderSyncCliDependencies = {},
): Promise<ProviderSyncCliOutcome> {
	const outcome = parseArgs(args);
	if (outcome.kind === "absent") return { handled: false, exitCode: 0 };
	const agentDir = overrides.agentDir ?? getAgentDir();
	const env = overrides.env ?? process.env;
	const writeLine = overrides.writeLine ?? ((line: string) => process.stdout.write(`${line}\n`));
	if (outcome.kind === "help") {
		writeLine(HELP);
		return { handled: true, exitCode: 0 };
	}
	if (outcome.kind === "error") {
		writeLine(`${outcome.message}\n${USAGE}`);
		return { handled: true, exitCode: 2 };
	}
	const io: BridgeSyncIo = {
		readFile: overrides.readFile ?? ((path) => (existsSync(path) ? readFileSync(path, "utf8") : "")),
		writeFile: overrides.writeFile ?? writeFileAtomically,
		fetch: overrides.fetch ?? ((url, init) => fetch(url, init)),
		getCodexAccessToken:
			overrides.getCodexAccessToken ??
			(() => AuthStorage.create(join(agentDir, "auth.json")).getApiKey("openai-codex")),
		now: overrides.now ?? (() => new Date().toISOString()),
	};
	const { parsed } = outcome;
	const clientVersion =
		parsed.clientVersion ??
		env.OMK_CODEX_CLIENT_VERSION ??
		(overrides.detectCodexVersion ?? detectCodexVersion)() ??
		CODEX_CHATGPT_WEB_FALLBACK_CLIENT_VERSION;
	try {
		const report = await syncCodexChatGptWebProvider(
			{ ...parsed, modelsPath: join(agentDir, "models.json"), clientVersion },
			io,
		);
		printReport(parsed, report, writeLine);
		return { handled: true, exitCode: 0 };
	} catch (error) {
		if (error instanceof BridgeSyncFailure) {
			writeLine(error.message);
			return { handled: true, exitCode: 1 };
		}
		throw error;
	}
}
