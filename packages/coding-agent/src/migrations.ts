/**
 * One-time migrations that run on startup.
 */

import chalk from "chalk";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { CONFIG_DIR_NAME, getAgentDir, getBinDir } from "./config.ts";
import { migrateKeybindingsConfig } from "./core/keybindings.ts";
import { isLegacyEnvVarNameConfigValue } from "./core/resolve-config-value.ts";
import { stripJsonComments } from "./utils/json.ts";

const MIGRATION_GUIDE_URL =
	"https://github.com/dmae97/omk/blob/main/packages/coding-agent/CHANGELOG.md#extensions-migration";
const EXTENSIONS_DOC_URL = "https://github.com/dmae97/omk/blob/main/packages/coding-agent/docs/extensions.md";

/**
 * Migrate legacy oauth.json and settings.json apiKeys to auth.json.
 *
 * @returns Array of provider names that were migrated
 */
export function migrateAuthToAuthJson(): string[] {
	const agentDir = getAgentDir();
	const authPath = join(agentDir, "auth.json");
	const oauthPath = join(agentDir, "oauth.json");
	const settingsPath = join(agentDir, "settings.json");

	// Skip if auth.json already exists
	if (existsSync(authPath)) return [];

	const migrated: Record<string, unknown> = {};
	const providers: string[] = [];

	// Migrate oauth.json
	if (existsSync(oauthPath)) {
		try {
			const oauth = JSON.parse(readFileSync(oauthPath, "utf-8"));
			for (const [provider, cred] of Object.entries(oauth)) {
				migrated[provider] = { type: "oauth", ...(cred as object) };
				providers.push(provider);
			}
			renameSync(oauthPath, `${oauthPath}.migrated`);
		} catch {
			// Skip on error
		}
	}

	// Migrate settings.json apiKeys
	if (existsSync(settingsPath)) {
		try {
			const content = readFileSync(settingsPath, "utf-8");
			const settings = JSON.parse(content);
			if (settings.apiKeys && typeof settings.apiKeys === "object") {
				for (const [provider, key] of Object.entries(settings.apiKeys)) {
					if (!migrated[provider] && typeof key === "string") {
						migrated[provider] = { type: "api_key", key };
						providers.push(provider);
					}
				}
				delete settings.apiKeys;
				writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
			}
		} catch {
			// Skip on error
		}
	}

	if (Object.keys(migrated).length > 0) {
		mkdirSync(dirname(authPath), { recursive: true });
		writeFileSync(authPath, JSON.stringify(migrated, null, 2), { mode: 0o600 });
	}

	return providers;
}

interface ConfigValueMigration {
	location: string;
	from: string;
	to: string;
}

function migrateLegacyEnvVarString(value: string): string | undefined {
	return isLegacyEnvVarNameConfigValue(value) ? `$${value}` : undefined;
}

function migrateStringProperty(
	record: Record<string, unknown>,
	key: string,
	location: string,
	migrations: ConfigValueMigration[],
): boolean {
	const value = record[key];
	if (typeof value !== "string") return false;
	const migrated = migrateLegacyEnvVarString(value);
	if (migrated === undefined) return false;
	record[key] = migrated;
	migrations.push({ location, from: value, to: migrated });
	return true;
}

function migrateHeadersConfig(headers: unknown, location: string, migrations: ConfigValueMigration[]): boolean {
	if (typeof headers !== "object" || headers === null || Array.isArray(headers)) return false;
	const headerRecord = headers as Record<string, unknown>;
	let migrated = false;
	for (const [key, value] of Object.entries(headerRecord)) {
		if (typeof value !== "string") continue;
		const migratedValue = migrateLegacyEnvVarString(value);
		if (migratedValue === undefined) continue;
		headerRecord[key] = migratedValue;
		migrations.push({ location: `${location}[${JSON.stringify(key)}]`, from: value, to: migratedValue });
		migrated = true;
	}
	return migrated;
}

function migrateAuthJsonConfigValues(agentDir: string): ConfigValueMigration[] {
	const authPath = join(agentDir, "auth.json");
	if (!existsSync(authPath)) return [];

	try {
		const parsed = JSON.parse(readFileSync(authPath, "utf-8")) as unknown;
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];
		const authData = parsed as Record<string, unknown>;

		const migrations: ConfigValueMigration[] = [];
		for (const [provider, credential] of Object.entries(authData)) {
			if (typeof credential !== "object" || credential === null || Array.isArray(credential)) continue;
			const credentialRecord = credential as Record<string, unknown>;
			if (credentialRecord.type !== "api_key") continue;
			migrateStringProperty(credentialRecord, "key", `auth.json[${JSON.stringify(provider)}].key`, migrations);
		}

		if (migrations.length === 0) return [];
		writeFileSync(authPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
		chmodSync(authPath, 0o600);
		return migrations;
	} catch {
		return [];
	}
}

function migrateModelsJsonConfigValues(agentDir: string): ConfigValueMigration[] {
	const modelsPath = join(agentDir, "models.json");
	if (!existsSync(modelsPath)) return [];

	const parsed = JSON.parse(stripJsonComments(readFileSync(modelsPath, "utf-8"))) as unknown;
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];
	const modelsData = parsed as Record<string, unknown>;
	const providers = modelsData.providers;
	if (typeof providers !== "object" || providers === null || Array.isArray(providers)) return [];

	const migrations: ConfigValueMigration[] = [];
	for (const [provider, providerConfig] of Object.entries(providers)) {
		if (typeof providerConfig !== "object" || providerConfig === null || Array.isArray(providerConfig)) continue;
		const providerRecord = providerConfig as Record<string, unknown>;
		const providerLocation = `models.json.providers[${JSON.stringify(provider)}]`;
		migrateStringProperty(providerRecord, "apiKey", `${providerLocation}.apiKey`, migrations);
		migrateHeadersConfig(providerRecord.headers, `${providerLocation}.headers`, migrations);

		if (Array.isArray(providerRecord.models)) {
			for (let index = 0; index < providerRecord.models.length; index++) {
				const modelConfig = providerRecord.models[index];
				if (typeof modelConfig !== "object" || modelConfig === null || Array.isArray(modelConfig)) continue;
				const modelRecord = modelConfig as Record<string, unknown>;
				const modelKey = typeof modelRecord.id === "string" ? JSON.stringify(modelRecord.id) : String(index);
				migrateHeadersConfig(modelRecord.headers, `${providerLocation}.models[${modelKey}].headers`, migrations);
			}
		}

		const modelOverrides = providerRecord.modelOverrides;
		if (typeof modelOverrides === "object" && modelOverrides !== null && !Array.isArray(modelOverrides)) {
			for (const [modelId, modelOverride] of Object.entries(modelOverrides)) {
				if (typeof modelOverride !== "object" || modelOverride === null || Array.isArray(modelOverride)) continue;
				const modelOverrideRecord = modelOverride as Record<string, unknown>;
				migrateHeadersConfig(
					modelOverrideRecord.headers,
					`${providerLocation}.modelOverrides[${JSON.stringify(modelId)}].headers`,
					migrations,
				);
			}
		}
	}

	if (migrations.length === 0) return [];
	writeFileSync(modelsPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
	return migrations;
}

function migrateExplicitEnvVarConfigValues(): void {
	const agentDir = getAgentDir();
	const migrations = [...migrateAuthJsonConfigValues(agentDir), ...migrateModelsJsonConfigValues(agentDir)];
	if (migrations.length === 0) return;

	const details = migrations.map((migration) => `  - ${migration.location}: ${migration.from} -> ${migration.to}`);
	console.log(
		chalk.yellow(
			[
				"Warning: Migrated API key/header environment references to explicit $ENV_VAR syntax. Plain strings will be treated as literals.",
				...details,
			].join("\n"),
		),
	);
}

/**
 * Migrate sessions from ~/.omk/agent/*.jsonl to proper session directories.
 *
 * Bug in v0.30.0: Sessions were saved to ~/.omk/agent/ instead of
 * ~/.omk/agent/sessions/<encoded-cwd>/. This migration moves them
 * to the correct location based on the cwd in their session header.
 */
export function migrateSessionsFromAgentRoot(): void {
	const agentDir = getAgentDir();

	// Find all .jsonl files directly in agentDir (not in subdirectories)
	let files: string[];
	try {
		files = readdirSync(agentDir)
			.filter((f) => f.endsWith(".jsonl"))
			.map((f) => join(agentDir, f));
	} catch {
		return;
	}

	if (files.length === 0) return;

	for (const file of files) {
		try {
			// Read first line to get session header
			const content = readFileSync(file, "utf8");
			const firstLine = content.split("\n")[0];
			if (!firstLine?.trim()) continue;

			const header = JSON.parse(firstLine);
			if (header.type !== "session" || !header.cwd) continue;

			const cwd: string = header.cwd;

			// Compute the correct session directory (same encoding as session-manager.ts)
			const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
			const correctDir = join(agentDir, "sessions", safePath);

			// Create directory if needed
			if (!existsSync(correctDir)) {
				mkdirSync(correctDir, { recursive: true });
			}

			// Move the file
			const fileName = file.split("/").pop() || file.split("\\").pop();
			const newPath = join(correctDir, fileName!);

			if (existsSync(newPath)) continue; // Skip if target exists

			renameSync(file, newPath);
		} catch {
			// Skip files that can't be migrated
		}
	}
}

/**
 * Migrate commands/ to prompts/ if needed.
 * Works for both regular directories and symlinks.
 */
function migrateCommandsToPrompts(baseDir: string, label: string): boolean {
	const commandsDir = join(baseDir, "commands");
	const promptsDir = join(baseDir, "prompts");

	if (existsSync(commandsDir) && !existsSync(promptsDir)) {
		try {
			renameSync(commandsDir, promptsDir);
			console.log(chalk.green(`Migrated ${label} commands/ → prompts/`));
			return true;
		} catch (err) {
			console.log(
				chalk.yellow(
					`Warning: Could not migrate ${label} commands/ to prompts/: ${err instanceof Error ? err.message : err}`,
				),
			);
		}
	}
	return false;
}

function migrateKeybindingsConfigFile(): void {
	const configPath = join(getAgentDir(), "keybindings.json");
	if (!existsSync(configPath)) return;

	try {
		const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as unknown;
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			return;
		}
		const { config, migrated } = migrateKeybindingsConfig(parsed as Record<string, unknown>);
		if (!migrated) return;
		writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
	} catch {
		// Ignore malformed files during migration
	}
}

/**
 * Move fd/rg binaries from tools/ to bin/ if they exist.
 */
function migrateToolsToBin(): void {
	const agentDir = getAgentDir();
	const toolsDir = join(agentDir, "tools");
	const binDir = getBinDir();

	if (!existsSync(toolsDir)) return;

	const binaries = ["fd", "rg", "fd.exe", "rg.exe"];
	let movedAny = false;

	for (const bin of binaries) {
		const oldPath = join(toolsDir, bin);
		const newPath = join(binDir, bin);

		if (existsSync(oldPath)) {
			if (!existsSync(binDir)) {
				mkdirSync(binDir, { recursive: true });
			}
			if (!existsSync(newPath)) {
				try {
					renameSync(oldPath, newPath);
					movedAny = true;
				} catch {
					// Ignore errors
				}
			} else {
				// Target exists, just delete the old one
				try {
					rmSync?.(oldPath, { force: true });
				} catch {
					// Ignore
				}
			}
		}
	}

	if (movedAny) {
		console.log(chalk.green(`Migrated managed binaries tools/ → bin/`));
	}
}

/**
 * Archive a legacy `hooks/` directory by renaming it to `hooks.migrated/`.
 *
 * Used for project-level hooks, which are never loaded or executed: the shell-hook
 * inventory only scans the global agent directory, and built-in hooks take precedence
 * on name collisions. Renaming is reversible and preserves the scripts.
 *
 * @returns The archived directory path, or null if there was nothing to archive (or the rename failed).
 */
export function archiveLegacyHooksDir(baseDir: string): string | null {
	const hooksDir = join(baseDir, "hooks");
	if (!existsSync(hooksDir)) return null;

	let target = join(baseDir, "hooks.migrated");
	if (existsSync(target)) {
		target = join(baseDir, `hooks.migrated.${Date.now()}`);
	}

	try {
		renameSync(hooksDir, target);
		return target;
	} catch {
		return null;
	}
}

/**
 * Check for deprecated hooks/ and tools/ directories.
 * Project-level hooks/ (`autoArchiveHooks`) are archived automatically because project shell hooks
 * are never executed; global hooks/ may still be live via the hook inventory, so it stays a warning.
 * Note: tools/ may contain legacy auto-extracted fd/rg binaries, so only warn if it has other files.
 */
export function checkDeprecatedExtensionDirs(
	baseDir: string,
	label: string,
	options?: { autoArchiveHooks?: boolean },
): string[] {
	const hooksDir = join(baseDir, "hooks");
	const toolsDir = join(baseDir, "tools");
	const warnings: string[] = [];

	if (existsSync(hooksDir)) {
		const archived = options?.autoArchiveHooks ? archiveLegacyHooksDir(baseDir) : null;
		if (archived) {
			console.log(
				chalk.dim(
					`Archived legacy ${label.toLowerCase()} hooks/ directory to ${archived} (shell hooks are superseded by extensions).`,
				),
			);
		} else {
			warnings.push(`${label} hooks/ directory found. Hooks have been renamed to extensions.`);
		}
	}

	if (existsSync(toolsDir)) {
		// Check if tools/ contains anything other than fd/rg (which are auto-extracted binaries)
		try {
			const entries = readdirSync(toolsDir);
			const customTools = entries.filter((e) => {
				const lower = e.toLowerCase();
				return (
					lower !== "fd" && lower !== "rg" && lower !== "fd.exe" && lower !== "rg.exe" && !e.startsWith(".") // Ignore .DS_Store and other hidden files
				);
			});
			if (customTools.length > 0) {
				warnings.push(
					`${label} tools/ directory contains custom tools. Custom tools have been merged into extensions.`,
				);
			}
		} catch {
			// Ignore read errors
		}
	}

	return warnings;
}

/**
 * Run extension system migrations (commands→prompts) and collect warnings about deprecated directories.
 */
function migrateExtensionSystem(cwd: string): string[] {
	const agentDir = getAgentDir();
	const projectDir = join(cwd, CONFIG_DIR_NAME);

	// Migrate commands/ to prompts/
	migrateCommandsToPrompts(agentDir, "Global");
	migrateCommandsToPrompts(projectDir, "Project");

	// Check for deprecated directories. Project hooks/ are archived automatically (never executed);
	// global hooks/ may still be live, so it remains a non-blocking warning.
	const warnings = [
		...checkDeprecatedExtensionDirs(agentDir, "Global", { autoArchiveHooks: false }),
		...checkDeprecatedExtensionDirs(projectDir, "Project", { autoArchiveHooks: true }),
	];

	return warnings;
}

/**
 * Print deprecation warnings and wait for keypress.
 */
export async function showDeprecationWarnings(warnings: string[]): Promise<void> {
	if (warnings.length === 0) return;

	for (const warning of warnings) {
		console.log(chalk.yellow(`Warning: ${warning}`));
	}
	console.log(chalk.yellow(`\nMove your extensions to the extensions/ directory.`));
	console.log(chalk.yellow(`Migration guide: ${MIGRATION_GUIDE_URL}`));
	console.log(chalk.yellow(`Documentation: ${EXTENSIONS_DOC_URL}`));
	console.log();
}

/**
 * Run all migrations. Called once on startup.
 *
 * @returns Object with migration results and deprecation warnings
 */
export function runMigrations(cwd: string): {
	migratedAuthProviders: string[];
	deprecationWarnings: string[];
} {
	const migratedAuthProviders = migrateAuthToAuthJson();
	migrateExplicitEnvVarConfigValues();
	migrateSessionsFromAgentRoot();
	migrateToolsToBin();
	migrateKeybindingsConfigFile();
	const deprecationWarnings = migrateExtensionSystem(cwd);
	return { migratedAuthProviders, deprecationWarnings };
}
