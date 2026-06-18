/**
 * One-time migrations that run on startup.
 */

import { createHash } from "node:crypto";
import chalk from "chalk";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "fs";
import { basename, dirname, join, relative, resolve, sep } from "path";
import { CONFIG_DIR_NAME, getAgentDir, getBinDir } from "./config.ts";
import { recordHarnessControlEvent } from "./core/harness-control-events.ts";
import { migrateKeybindingsConfig } from "./core/keybindings.ts";
import { isLegacyEnvVarNameConfigValue } from "./core/resolve-config-value.ts";
import { runHarnessControlTransactionSync } from "./core/transaction-coordinator.ts";
import { stripJsonComments } from "./utils/json.ts";

const MIGRATION_GUIDE_URL =
	"https://github.com/dmae97/open-multi-agent-kit/blob/main/packages/coding-agent/CHANGELOG.md#extensions-migration";
const EXTENSIONS_DOC_URL =
	"https://github.com/dmae97/open-multi-agent-kit/blob/main/packages/coding-agent/docs/extensions.md";

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
 *
 * See: https://github.com/dmae97/open-multi-agent-kit/issues/320
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
 * Check for deprecated hooks/ and tools/ directories.
 * Note: tools/ may contain fd/rg binaries extracted by pi, so only warn if it has other files.
 */
const EXTENSION_SOURCE_EXTENSIONS = new Set([".ts", ".js", ".mts", ".cts", ".mjs", ".cjs", ".tsx", ".jsx"]);
const LEGACY_MANIFEST_FIELDS = ["hooks", "customTools", "extensions"] as const;
const MAX_LEGACY_EXTENSION_SCAN_DEPTH = 8;

export type LegacyExtensionClassification = "legacy" | "not-legacy" | "unknown";

export interface ExtensionDeprecationDiagnostic {
	code: "LEGACY_EXTENSION_ENTRYPOINT" | "LEGACY_EXTENSION_UNKNOWN";
	scope: "global" | "project";
	path: string;
	classification: LegacyExtensionClassification;
	confidence: number;
	evidence: string[];
	recommendedAction: "move-to-extensions" | "inspect-manifest";
}

export interface ExtensionMigrationAction {
	action: "move";
	scope: "global" | "project";
	from: string;
	to: string;
	status: "ready" | "blocked" | "applied" | "rolled_back" | "in_doubt";
	reason: string;
	blocker?: string;
	sourceStatHash?: string;
	sourceStat?: {
		isDirectory: boolean;
		size: number;
		mtimeMs: number;
		mode: number;
	};
}

export interface ExtensionMigrationPlan {
	diagnostics: ExtensionDeprecationDiagnostic[];
	actions: ExtensionMigrationAction[];
}

function extensionName(name: string): string {
	const dotIndex = name.lastIndexOf(".");
	return dotIndex >= 0 ? name.slice(dotIndex) : "";
}

function isExtensionSourceFile(name: string): boolean {
	return EXTENSION_SOURCE_EXTENSIONS.has(extensionName(name));
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function manifestEntrypointReferencesSource(value: unknown): boolean {
	if (typeof value === "string") return isExtensionSourceFile(value);
	if (Array.isArray(value)) return value.some((entry) => manifestEntrypointReferencesSource(entry));
	if (isObjectRecord(value)) return Object.values(value).some((entry) => manifestEntrypointReferencesSource(entry));
	return false;
}

function inspectLegacyExtensionManifest(
	dir: string,
	scope: "global" | "project",
): ExtensionDeprecationDiagnostic | undefined {
	const packageJsonPath = join(dir, "package.json");
	if (!existsSync(packageJsonPath)) return undefined;

	try {
		const parsed = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as unknown;
		if (!isObjectRecord(parsed)) return undefined;
		const manifests = [parsed.pi, parsed.omk].filter(isObjectRecord);
		const hasLegacyManifestArray = manifests.some((manifest) =>
			LEGACY_MANIFEST_FIELDS.some((field) => Array.isArray(manifest[field])),
		);
		const hasManifestEntrypoint = [parsed.main, parsed.module, parsed.exports].some(
			manifestEntrypointReferencesSource,
		);
		if (!hasLegacyManifestArray && !hasManifestEntrypoint) return undefined;
		return {
			code: "LEGACY_EXTENSION_ENTRYPOINT",
			scope,
			path: packageJsonPath,
			classification: "legacy",
			confidence: hasLegacyManifestArray ? 0.96 : 0.82,
			evidence: [hasLegacyManifestArray ? "manifest legacy array" : "manifest entrypoint"],
			recommendedAction: "move-to-extensions",
		};
	} catch {
		return {
			code: "LEGACY_EXTENSION_UNKNOWN",
			scope,
			path: packageJsonPath,
			classification: "unknown",
			confidence: 0.5,
			evidence: ["package.json parse failed"],
			recommendedAction: "inspect-manifest",
		};
	}
}

function isPathWithin(parent: string, child: string): boolean {
	const resolvedParent = resolve(parent);
	const resolvedChild = resolve(child);
	return resolvedChild === resolvedParent || resolvedChild.startsWith(`${resolvedParent}${sep}`);
}

function addLegacySourceDiagnostic(
	diagnostics: ExtensionDeprecationDiagnostic[],
	scope: "global" | "project",
	entryPath: string,
	evidence: string,
): void {
	diagnostics.push({
		code: "LEGACY_EXTENSION_ENTRYPOINT",
		scope,
		path: entryPath,
		classification: "legacy",
		confidence: 0.98,
		evidence: [evidence],
		recommendedAction: "move-to-extensions",
	});
}

function addUnknownExtensionDiagnostic(
	diagnostics: ExtensionDeprecationDiagnostic[],
	scope: "global" | "project",
	entryPath: string,
	evidence: string,
	confidence = 0.4,
): void {
	diagnostics.push({
		code: "LEGACY_EXTENSION_UNKNOWN",
		scope,
		path: entryPath,
		classification: "unknown",
		confidence,
		evidence: [evidence],
		recommendedAction: "inspect-manifest",
	});
}

function collectLegacyExtensionDiagnostics(
	entryPath: string,
	hooksRealPath: string,
	scope: "global" | "project",
	depth: number,
	visitedRealPaths: Set<string>,
	diagnostics: ExtensionDeprecationDiagnostic[],
): void {
	if (depth > MAX_LEGACY_EXTENSION_SCAN_DEPTH) {
		addUnknownExtensionDiagnostic(diagnostics, scope, entryPath, "maximum scan depth exceeded");
		return;
	}

	let currentPath = entryPath;
	let stats: ReturnType<typeof lstatSync>;
	try {
		stats = lstatSync(currentPath);
		if (stats.isSymbolicLink()) {
			const targetPath = realpathSync(currentPath);
			if (!isPathWithin(hooksRealPath, targetPath)) {
				addUnknownExtensionDiagnostic(
					diagnostics,
					scope,
					currentPath,
					"symlink target outside hooks directory",
					0.6,
				);
				return;
			}
			currentPath = targetPath;
			stats = lstatSync(currentPath);
		}
	} catch {
		addUnknownExtensionDiagnostic(diagnostics, scope, entryPath, "path stat failed");
		return;
	}

	if (stats.isFile()) {
		if (isExtensionSourceFile(entryPath) || isExtensionSourceFile(currentPath)) {
			addLegacySourceDiagnostic(diagnostics, scope, entryPath, basename(entryPath));
		}
		return;
	}

	if (!stats.isDirectory()) return;

	let directoryRealPath: string;
	try {
		directoryRealPath = realpathSync(currentPath);
	} catch {
		addUnknownExtensionDiagnostic(diagnostics, scope, entryPath, "directory realpath failed");
		return;
	}
	if (visitedRealPaths.has(directoryRealPath)) return;
	visitedRealPaths.add(directoryRealPath);

	const manifestDiagnostic = inspectLegacyExtensionManifest(currentPath, scope);
	if (manifestDiagnostic) diagnostics.push({ ...manifestDiagnostic, path: join(entryPath, "package.json") });

	let entries: Array<{ name: string }>;
	try {
		entries = readdirSync(currentPath, { withFileTypes: true });
	} catch {
		addUnknownExtensionDiagnostic(diagnostics, scope, entryPath, "directory read failed");
		return;
	}

	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue;
		collectLegacyExtensionDiagnostics(
			join(entryPath, entry.name),
			hooksRealPath,
			scope,
			depth + 1,
			visitedRealPaths,
			diagnostics,
		);
	}
}

function getLegacyExtensionDiagnosticsForHooksDir(
	hooksDir: string,
	scope: "global" | "project",
): ExtensionDeprecationDiagnostic[] {
	if (!existsSync(hooksDir)) return [];

	try {
		const hooksRealPath = realpathSync(hooksDir);
		const diagnostics: ExtensionDeprecationDiagnostic[] = [];
		const visitedRealPaths = new Set<string>();
		for (const entry of readdirSync(hooksDir, { withFileTypes: true })) {
			if (entry.name.startsWith(".")) continue;
			collectLegacyExtensionDiagnostics(
				join(hooksDir, entry.name),
				hooksRealPath,
				scope,
				1,
				visitedRealPaths,
				diagnostics,
			);
		}
		return diagnostics;
	} catch {
		return [
			{
				code: "LEGACY_EXTENSION_UNKNOWN",
				scope,
				path: hooksDir,
				classification: "unknown",
				confidence: 0.4,
				evidence: ["directory read failed"],
				recommendedAction: "inspect-manifest",
			},
		];
	}
}

function getExtensionDeprecationScanTargets(cwd: string): Array<{
	scope: "global" | "project";
	hooksDir: string;
	extensionsDir: string;
}> {
	const agentDir = getAgentDir();
	const projectDir = join(cwd, CONFIG_DIR_NAME);
	return [
		{
			scope: "global",
			hooksDir: join(agentDir, "hooks"),
			extensionsDir: join(agentDir, "extensions"),
		},
		{
			scope: "project",
			hooksDir: join(projectDir, "hooks"),
			extensionsDir: join(projectDir, "extensions"),
		},
	];
}

export function getExtensionDeprecationDiagnostics(cwd: string): ExtensionDeprecationDiagnostic[] {
	return getExtensionDeprecationScanTargets(cwd).flatMap((target) =>
		getLegacyExtensionDiagnosticsForHooksDir(target.hooksDir, target.scope),
	);
}

function getMigrationSourcePath(diagnostic: ExtensionDeprecationDiagnostic): string {
	const name = basename(diagnostic.path);
	if (name === "package.json" || /^index\.[cm]?[tj]sx?$/.test(name)) {
		return dirname(diagnostic.path);
	}
	return diagnostic.path;
}

function createMigrationSourceStat(path: string): ExtensionMigrationAction["sourceStat"] | undefined {
	try {
		const stats = lstatSync(path);
		return {
			isDirectory: stats.isDirectory(),
			size: stats.size,
			mtimeMs: stats.mtimeMs,
			mode: stats.mode,
		};
	} catch {
		return undefined;
	}
}

function createMigrationSourceStatTree(path: string, depth = 0): unknown {
	const sourceStat = createMigrationSourceStat(path);
	if (!sourceStat) return undefined;
	if (!sourceStat.isDirectory || depth >= MAX_LEGACY_EXTENSION_SCAN_DEPTH) {
		return { name: basename(path), sourceStat };
	}
	const children = readdirSync(path)
		.filter((entry) => !entry.startsWith("."))
		.sort()
		.map((entry) => createMigrationSourceStatTree(join(path, entry), depth + 1));
	return { name: basename(path), sourceStat, children };
}

function hashMigrationSourceStat(path: string): string | undefined {
	const tree = createMigrationSourceStatTree(path);
	if (!tree) return undefined;
	return createHash("sha256").update(JSON.stringify(tree)).digest("hex");
}

function addMigrationSourceStat(action: ExtensionMigrationAction): ExtensionMigrationAction {
	const sourceStat = createMigrationSourceStat(action.from);
	return {
		...action,
		sourceStat,
		sourceStatHash: hashMigrationSourceStat(action.from),
	};
}

export function createExtensionMigrationPlan(cwd: string): ExtensionMigrationPlan {
	const diagnostics = getExtensionDeprecationDiagnostics(cwd);
	const targets = getExtensionDeprecationScanTargets(cwd);
	const actions: ExtensionMigrationAction[] = [];
	const seenSources = new Set<string>();

	for (const diagnostic of diagnostics) {
		if (diagnostic.classification !== "legacy") continue;
		const target = targets.find((candidate) => candidate.scope === diagnostic.scope);
		if (!target) continue;
		const sourcePath = getMigrationSourcePath(diagnostic);
		if (!isPathWithin(target.hooksDir, sourcePath)) continue;
		if ([...seenSources].some((seenSource) => isPathWithin(seenSource, sourcePath))) continue;
		for (const seenSource of [...seenSources]) {
			if (isPathWithin(sourcePath, seenSource)) {
				seenSources.delete(seenSource);
				const actionIndex = actions.findIndex((action) => action.from === seenSource);
				if (actionIndex >= 0) actions.splice(actionIndex, 1);
			}
		}
		seenSources.add(sourcePath);
		const relativeSource = relative(target.hooksDir, sourcePath);
		const destinationPath = join(target.extensionsDir, relativeSource);
		const destinationExists = existsSync(destinationPath);
		actions.push(
			addMigrationSourceStat({
				action: "move",
				scope: diagnostic.scope,
				from: sourcePath,
				to: destinationPath,
				status: destinationExists ? "blocked" : "ready",
				reason: diagnostic.evidence.join(", "),
				blocker: destinationExists ? "target already exists" : undefined,
			}),
		);
	}

	recordHarnessControlEvent("extension.migration.plan", "completed", {
		diagnostics: diagnostics.length,
		legacyDiagnostics: diagnostics.filter((diagnostic) => diagnostic.classification === "legacy").length,
		unknownDiagnostics: diagnostics.filter((diagnostic) => diagnostic.classification === "unknown").length,
		actions: actions.length,
		blockedActions: actions.filter((action) => action.status === "blocked").length,
	});
	return { diagnostics, actions };
}

export function applyExtensionMigrationPlan(
	cwd: string,
	plan: ExtensionMigrationPlan = createExtensionMigrationPlan(cwd),
): ExtensionMigrationPlan {
	const readyActions = plan.actions.filter((action) => action.status === "ready");
	const preflightBlocked = plan.actions.filter((action) => action.status !== "ready");
	if (preflightBlocked.length > 0) {
		recordHarnessControlEvent("extension.migration.apply", "blocked", {
			actions: plan.actions.length,
			blockedActions: preflightBlocked.length,
			reason: "preflight blocked actions present",
		});
		return plan;
	}

	const appliedMoves: Array<{ from: string; to: string }> = [];
	let appliedPlan: ExtensionMigrationPlan = plan;
	const transaction = runHarnessControlTransactionSync({
		kind: "extension.migration.apply",
		data: {
			actions: plan.actions.length,
			readyActions: readyActions.length,
			cwd,
		},
		beforeState: plan.actions.map((action) => ({
			from: action.from,
			to: action.to,
			status: action.status,
			sourceStatHash: action.sourceStatHash,
		})),
		afterState: () =>
			appliedPlan.actions.map((action) => ({ from: action.from, to: action.to, status: action.status })),
		commit: () => {
			for (const action of readyActions) {
				if (!existsSync(action.from)) throw new Error(`source missing: ${action.from}`);
				if (existsSync(action.to)) throw new Error(`target already exists: ${action.to}`);
				const currentHash = hashMigrationSourceStat(action.from);
				if (action.sourceStatHash && currentHash !== action.sourceStatHash) {
					throw new Error(`source changed before migration: ${action.from}`);
				}
			}

			for (const action of readyActions) {
				mkdirSync(dirname(action.to), { recursive: true });
				renameSync(action.from, action.to);
				appliedMoves.push({ from: action.from, to: action.to });
			}
			appliedPlan = {
				diagnostics: plan.diagnostics,
				actions: plan.actions.map((action) =>
					action.status === "ready" ? { ...action, status: "applied" as const } : action,
				),
			};
			return appliedPlan;
		},
		rollback: () => {
			for (const move of [...appliedMoves].reverse()) {
				if (existsSync(move.to) && !existsSync(move.from)) {
					mkdirSync(dirname(move.from), { recursive: true });
					renameSync(move.to, move.from);
				}
			}
			appliedPlan = {
				diagnostics: plan.diagnostics,
				actions: plan.actions.map((action) =>
					action.status === "ready" ? { ...action, status: "rolled_back" as const } : action,
				),
			};
		},
	});

	if (transaction.status === "completed") return appliedPlan;
	return {
		diagnostics: plan.diagnostics,
		actions: plan.actions.map((action) =>
			action.status === "ready"
				? {
						...action,
						status: transaction.status === "in_doubt" ? "in_doubt" : "blocked",
						blocker: transaction.error instanceof Error ? transaction.error.message : String(transaction.error),
					}
				: action,
		),
	};
}

function checkDeprecatedExtensionDirs(baseDir: string, label: string): string[] {
	const hooksDir = join(baseDir, "hooks");
	const toolsDir = join(baseDir, "tools");
	const warnings: string[] = [];
	const scope = label === "Global" ? "global" : "project";

	if (
		getLegacyExtensionDiagnosticsForHooksDir(hooksDir, scope).some(
			(diagnostic) => diagnostic.classification === "legacy",
		)
	) {
		warnings.push(`${label} hooks/ directory found. Hooks have been renamed to extensions.`);
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

	// Check for deprecated directories
	const warnings = [
		...checkDeprecatedExtensionDirs(agentDir, "Global"),
		...checkDeprecatedExtensionDirs(projectDir, "Project"),
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
	console.log(chalk.dim(`\nPress any key to continue...`));

	await new Promise<void>((resolve) => {
		process.stdin.setRawMode?.(true);
		process.stdin.resume();
		process.stdin.once("data", () => {
			process.stdin.setRawMode?.(false);
			process.stdin.pause();
			resolve();
		});
	});
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
