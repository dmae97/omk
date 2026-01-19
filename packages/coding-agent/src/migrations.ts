/**
 * One-time migrations that run on startup.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { getAgentDbPath, getAgentDir, getBinDir } from "./config";
import { AgentStorage } from "./core/agent-storage";
import type { AuthCredential } from "./core/auth-storage";
import { logger } from "./core/logger";

/**
 * Migrate legacy oauth.json and settings.json apiKeys to agent.db.
 *
 * @returns Array of provider names that were migrated
 */
export function migrateAuthToAgentDb(): string[] {
	const agentDir = getAgentDir();
	const oauthPath = join(agentDir, "oauth.json");
	const settingsPath = join(agentDir, "settings.json");
	const storage = AgentStorage.open(getAgentDbPath(agentDir));

	const migrated: Record<string, AuthCredential[]> = {};
	const providers: string[] = [];

	if (existsSync(oauthPath)) {
		try {
			const oauth = JSON.parse(readFileSync(oauthPath, "utf-8"));
			for (const [provider, cred] of Object.entries(oauth)) {
				if (storage.listAuthCredentials(provider).length > 0) {
					continue;
				}
				migrated[provider] = [{ type: "oauth", ...(cred as object) } as AuthCredential];
				providers.push(provider);
			}
			renameSync(oauthPath, `${oauthPath}.migrated`);
		} catch (error) {
			logger.warn("Failed to migrate oauth.json", { path: oauthPath, error: String(error) });
		}
	}

	if (existsSync(settingsPath)) {
		try {
			const content = readFileSync(settingsPath, "utf-8");
			const settings = JSON.parse(content);
			if (settings.apiKeys && typeof settings.apiKeys === "object") {
				for (const [provider, key] of Object.entries(settings.apiKeys)) {
					if (typeof key !== "string") continue;
					if (migrated[provider]) continue;
					if (storage.listAuthCredentials(provider).length > 0) continue;
					migrated[provider] = [{ type: "api_key", key }];
					providers.push(provider);
				}
				delete settings.apiKeys;
				writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
			}
		} catch (error) {
			logger.warn("Failed to migrate settings.json apiKeys", { path: settingsPath, error: String(error) });
		}
	}

	for (const [provider, credentials] of Object.entries(migrated)) {
		storage.replaceAuthCredentialsForProvider(provider, credentials);
	}

	return providers;
}

/**
 * Migrate sessions from ~/.omp/agent/*.jsonl to proper session directories.
 *
 * Bug in v0.30.0: Sessions were saved to ~/.omp/agent/ instead of
 * ~/.omp/agent/sessions/<encoded-cwd>/. This migration moves them
 * to the correct location based on the cwd in their session header.
 *
 * See: https://github.com/badlogic/pi-mono/issues/320
 */
export function migrateSessionsFromAgentRoot(): void {
	const agentDir = getAgentDir();

	// Find all .jsonl files directly in agentDir (not in subdirectories)
	let files: string[];
	try {
		files = readdirSync(agentDir)
			.filter((f) => f.endsWith(".jsonl"))
			.map((f) => join(agentDir, f));
	} catch (error) {
		logger.warn("Failed to read agent directory for session migration", { path: agentDir, error: String(error) });
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
			mkdirSync(correctDir, { recursive: true });

			// Move the file
			const fileName = file.split("/").pop() || file.split("\\").pop();
			const newPath = join(correctDir, fileName!);

			if (existsSync(newPath)) continue; // Skip if target exists

			renameSync(file, newPath);
		} catch (error) {
			logger.warn("Failed to migrate session file", { path: file, error: String(error) });
		}
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
				} catch (error) {
					logger.warn("Failed to migrate binary", { from: oldPath, to: newPath, error: String(error) });
				}
			} else {
				// Target exists, just delete the old one
				try {
					rmSync(oldPath, { force: true });
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
 * Run all migrations. Called once on startup.
 *
 * @param _cwd - Current working directory (reserved for future project-local migrations)
 * @returns Object with migration results
 */
export async function runMigrations(_cwd: string): Promise<{
	migratedAuthProviders: string[];
	deprecationWarnings: string[];
}> {
	// Then: run data migrations
	const migratedAuthProviders = migrateAuthToAgentDb();
	migrateSessionsFromAgentRoot();
	migrateToolsToBin();

	return { migratedAuthProviders, deprecationWarnings: [] };
}

/**
 * Display deprecation warnings to the user in interactive mode.
 *
 * @param warnings - Array of deprecation warning messages
 */
export async function showDeprecationWarnings(warnings: string[]): Promise<void> {
	console.log(chalk.yellow("\n⚠ Deprecation Warnings:"));
	for (const warning of warnings) {
		console.log(chalk.yellow(`  • ${warning}`));
	}
	console.log();
}
