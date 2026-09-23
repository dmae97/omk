/**
 * `omk provider adopt [<provider-id>] [--from <source>] [--dry-run] [--json] [--status]`
 *
 * Copies credentials this machine already holds (an OpenAI Codex CLI login, a Claude Code CLI
 * login) into OMK's own credential store, so a subscription does not have to be signed in twice.
 * `--status` only reports what the store holds; it never refreshes, writes or contacts a provider.
 *
 * Exit codes: 0 = adopted, already current, or status reported; 1 = no usable source or the store
 * is unreadable; 2 = usage error. No output contains token material.
 */

import { join } from "node:path";
import { APP_NAME, getAgentDir } from "../config.ts";
import { AuthStorage } from "../core/auth-storage.ts";
import {
	credentialSourcePath,
	credentialSourcesFor,
	EXTERNAL_CREDENTIAL_SOURCE_LABELS,
	type ExternalCredentialIo,
	type ExternalCredentialSourceId,
	readExternalCredential,
} from "../core/external-credential-sources.ts";
import { readAuthStoreFile, storedProviderIds, writeStatusReport } from "./provider-adopt-status.ts";

const USAGE = `Usage: ${APP_NAME} provider adopt [<provider-id>] [--from <source>] [--dry-run] [--json] [--status]`;
const HELP = [
	"Provider adopt: copy credentials that already exist on this machine into OMK's store.",
	"",
	USAGE,
	"",
	"  --from <source>  credential store to read: codex-cli | claude-code",
	"  --dry-run        report what would change without writing auth.json",
	"  --json           print one JSON document instead of the text report",
	"  --status         report the stored accounts (valid/expired) and exit; writes nothing",
	"",
	"Sources: codex-cli = ~/.codex/auth.json (Codex CLI), claude-code = ~/.claude/.credentials.json.",
	"Providers: openai-codex <- codex-cli, anthropic <- claude-code.",
	"Exit codes: 0 = adopted or nothing to change, 1 = source unusable or store unreadable, 2 = usage error.",
].join("\n");

export interface ProviderAdoptCliDependencies {
	readonly agentDir?: string;
	readonly env?: Readonly<Record<string, string | undefined>>;
	readonly readFile?: (path: string) => string;
	readonly now?: () => number;
	readonly home?: string;
	readonly writeLine?: (line: string) => void;
}

export interface ProviderAdoptCliOutcome {
	readonly handled: boolean;
	readonly exitCode: number;
}

type ParsedAdoptArgs = {
	readonly providerId?: string;
	readonly from?: ExternalCredentialSourceId;
	readonly dryRun: boolean;
	readonly json: boolean;
	readonly status: boolean;
};

type ParseOutcome =
	| { readonly kind: "absent" }
	| { readonly kind: "help" }
	| { readonly kind: "error"; readonly message: string }
	| { readonly kind: "ok"; readonly parsed: ParsedAdoptArgs };

const SOURCE_IDS: readonly ExternalCredentialSourceId[] = ["codex-cli", "claude-code"];

function parseArgs(args: readonly string[]): ParseOutcome {
	if (args[0] !== "provider" || args[1] !== "adopt") return { kind: "absent" };
	if (args.includes("--help") || args.includes("-h")) return { kind: "help" };
	let providerId: string | undefined;
	let from: ExternalCredentialSourceId | undefined;
	let dryRun = false;
	let json = false;
	let status = false;
	for (let index = 2; index < args.length; index += 1) {
		const arg = args[index] ?? "";
		if (arg === "--dry-run") dryRun = true;
		else if (arg === "--json") json = true;
		else if (arg === "--status") status = true;
		else if (arg === "--from") {
			const value = args[index + 1];
			if (value === undefined || value.startsWith("-"))
				return { kind: "error", message: "Missing value for --from." };
			if (!SOURCE_IDS.includes(value as ExternalCredentialSourceId)) {
				return { kind: "error", message: `Unknown --from value. Use one of: ${SOURCE_IDS.join(", ")}.` };
			}
			from = value as ExternalCredentialSourceId;
			index += 1;
		} else if (arg.startsWith("-")) return { kind: "error", message: "Unknown option for provider adopt." };
		else if (providerId === undefined) providerId = arg;
		else return { kind: "error", message: "Unexpected extra argument." };
	}
	if (!status && providerId === undefined) return { kind: "error", message: "Missing provider id." };
	return { kind: "ok", parsed: { providerId, from, dryRun, json, status } };
}

/**
 * Sources to try for one provider. `--from` narrows the provider's own mapping; it must never
 * broaden it, or a foreign provider's OAuth grant would be stored under this provider id.
 */
function sourcesForAdoption(
	providerId: string,
	from: ExternalCredentialSourceId | undefined,
): readonly ExternalCredentialSourceId[] {
	const mapped = credentialSourcesFor(providerId);
	return from === undefined ? mapped : mapped.filter((source) => source === from);
}

/** Adopt one provider's credential from the first source that yields a usable token. */
function adoptProvider(
	args: ParsedAdoptArgs,
	dependencies: ProviderAdoptCliDependencies,
	storage: AuthStorage,
	authPath: string,
	writeLine: (line: string) => void,
): number {
	const providerId = args.providerId ?? "";
	const io: ExternalCredentialIo = {
		readFile: dependencies.readFile,
		now: dependencies.now,
		env: dependencies.env,
		home: dependencies.home,
	};
	const sources = sourcesForAdoption(providerId, args.from);
	if (sources.length === 0) {
		writeLine(`No external credential source is mapped to "${providerId}".`);
		writeLine(`Known mappings: openai-codex <- codex-cli, anthropic <- claude-code.`);
		return 2;
	}

	let failure: { source: ExternalCredentialSourceId; path: string; reason: string } | undefined;
	for (const source of sources) {
		const lookup = readExternalCredential(source, io);
		if (lookup.status !== "found") {
			failure = { source, path: lookup.path, reason: lookup.reason };
			continue;
		}
		const preview = args.dryRun
			? storage.previewOAuthAccountImport(providerId, lookup.candidate.credentials)
			: storage.addOAuthAccount(providerId, lookup.candidate.credentials);
		if (args.json) {
			writeLine(
				JSON.stringify(
					{
						provider: providerId,
						source,
						path: lookup.candidate.path,
						detail: lookup.candidate.detail,
						action: preview.action,
						accountIndex: preview.accountIndex,
						reason: preview.reason,
						dryRun: args.dryRun,
					},
					null,
					2,
				),
			);
		} else {
			writeLine(`${providerId} <- ${EXTERNAL_CREDENTIAL_SOURCE_LABELS[source]}`);
			writeLine(`  found: ${lookup.candidate.detail}`);
			const where = preview.accountIndex === undefined ? "" : ` account[${preview.accountIndex}]`;
			const suffix = preview.reason ? ` (${preview.reason})` : "";
			writeLine(`  ${args.dryRun ? "would be" : "result"}: ${preview.action}${where}${suffix}`);
			writeLine(args.dryRun ? `  dry run: ${authPath} not written` : `  wrote ${authPath}`);
		}
		if (preview.action === "blocked") return 1;
		// A write swallowed into the error queue still prints "wrote auth.json" above; check the
		// queue so adopt cannot report success while nothing persisted.
		const writeErrors = storage.drainErrors();
		if (writeErrors.length > 0) {
			writeLine(`  warning: the credential store reported an error: ${writeErrors[0]?.message}`);
			return 1;
		}
		return 0;
	}

	const reason = failure ? `${failure.reason}` : "no source produced a credential";
	const failedSource = failure?.source ?? sources[0] ?? "codex-cli";
	const path = failure?.path ?? credentialSourcePath(failedSource, io);
	if (args.json) {
		writeLine(
			JSON.stringify({ provider: providerId, source: failedSource, path, action: "unavailable", reason }, null, 2),
		);
	} else {
		writeLine(`${providerId}: no usable credential to adopt from ${EXTERNAL_CREDENTIAL_SOURCE_LABELS[failedSource]}`);
		writeLine(`  ${path}`);
		writeLine(`  ${reason}`);
	}
	return 1;
}

export async function runProviderAdoptCli(
	args: readonly string[],
	overrides: ProviderAdoptCliDependencies = {},
): Promise<ProviderAdoptCliOutcome> {
	const outcome = parseArgs(args);
	if (outcome.kind === "absent") return { handled: false, exitCode: 0 };
	const writeLine = overrides.writeLine ?? ((line: string) => process.stdout.write(`${line}\n`));
	if (outcome.kind === "help") {
		writeLine(HELP);
		return { handled: true, exitCode: 0 };
	}
	if (outcome.kind === "error") {
		writeLine(outcome.message);
		writeLine(USAGE);
		return { handled: true, exitCode: 2 };
	}

	const authPath = join(overrides.agentDir ?? getAgentDir(), "auth.json");
	const storage = AuthStorage.create(authPath);
	const now = (overrides.now ?? Date.now)();
	const readFile = overrides.readFile ?? readAuthStoreFile;

	if (outcome.parsed.status) {
		// An unreadable store is not an empty store: report the load failure instead of
		// "no stored credential", the same distinction the request path enforces.
		if (storage.hasLoadError()) {
			writeLine(`The credential store could not be read: ${authPath}`);
			writeLine(`  Another session may hold the lock. Retry shortly.`);
			return { handled: true, exitCode: 1 };
		}
		const providerIds = outcome.parsed.providerId
			? [outcome.parsed.providerId]
			: storedProviderIds(authPath, readFile);
		writeStatusReport({ storage, providerIds, json: outcome.parsed.json, authPath, writeLine, now });
		return { handled: true, exitCode: 0 };
	}

	return { handled: true, exitCode: adoptProvider(outcome.parsed, overrides, storage, authPath, writeLine) };
}
