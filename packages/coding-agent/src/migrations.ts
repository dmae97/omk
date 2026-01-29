/**
 * One-time migrations that run on startup.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { isEnoent, logger } from "@oh-my-pi/pi-utils";
import chalk from "chalk";
import { getAgentDbPath, getAgentDir } from "./config";
import { AgentStorage } from "./session/agent-storage";
import type { AuthCredential } from "./session/auth-storage";

type SessionHeader = {
	type: "session";
	cwd: string;
};

function isSessionHeader(value: unknown): value is SessionHeader {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return record.type === "session" && typeof record.cwd === "string" && record.cwd.length > 0;
}

/**
 * Migrate legacy oauth.json and settings.json apiKeys to agent.db.
 *
 * @returns Array of provider names that were migrated
 */
export async function migrateAuthToAgentDb(): Promise<string[]> {
	const agentDir = getAgentDir();
	const oauthPath = path.join(agentDir, "oauth.json");
	const settingsPath = path.join(agentDir, "settings.json");
	const storage = await AgentStorage.open(getAgentDbPath(agentDir));

	const migrated: Record<string, AuthCredential[]> = {};
	const providers: string[] = [];

	try {
		const oauth = await Bun.file(oauthPath).json();
		try {
			for (const [provider, cred] of Object.entries(oauth)) {
				if (storage.listAuthCredentials(provider).length > 0) {
					continue;
				}
				migrated[provider] = [{ type: "oauth", ...(cred as object) } as AuthCredential];
				providers.push(provider);
			}
			await fs.promises.rename(oauthPath, `${oauthPath}.migrated`);
		} catch (error) {
			logger.warn("Failed to migrate oauth.json", { path: oauthPath, error: String(error) });
		}
	} catch (err) {
		if (!isEnoent(err)) {
			logger.warn("Failed to read oauth.json", { path: oauthPath, error: String(err) });
		}
	}

	try {
		const settings = await Bun.file(settingsPath).json();
		try {
			if (settings.apiKeys && typeof settings.apiKeys === "object") {
				for (const [provider, key] of Object.entries(settings.apiKeys)) {
					if (typeof key !== "string") continue;
					if (migrated[provider]) continue;
					if (storage.listAuthCredentials(provider).length > 0) continue;
					migrated[provider] = [{ type: "api_key", key }];
					providers.push(provider);
				}
				delete settings.apiKeys;
				await Bun.write(settingsPath, JSON.stringify(settings, null, 2));
			}
		} catch (error) {
			logger.warn("Failed to migrate settings.json apiKeys", { path: settingsPath, error: String(error) });
		}
	} catch (err) {
		if (!isEnoent(err)) {
			logger.warn("Failed to read settings.json", { path: settingsPath, error: String(err) });
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
export async function migrateSessionsFromAgentRoot(): Promise<void> {
	const agentDir = getAgentDir();

	// Find all .jsonl files directly in agentDir (not in subdirectories)
	let files: string[];
	try {
		const entries = await fs.promises.readdir(agentDir);
		files = entries.filter(f => f.endsWith(".jsonl")).map(f => path.join(agentDir, f));
	} catch (error) {
		logger.warn("Failed to read agent directory for session migration", { path: agentDir, error: String(error) });
		return;
	}

	if (files.length === 0) return;

	for (const file of files) {
		try {
			// Read first line to get session header
			let content: string;
			try {
				content = await Bun.file(file).text();
			} catch (err) {
				if (isEnoent(err)) continue;
				throw err;
			}
			const entries: unknown[] = Bun.JSONL.parse(content);
			const header = entries[0];
			if (!isSessionHeader(header)) continue;

			const cwd = header.cwd;

			// Compute the correct session directory (same encoding as session-manager.ts)
			const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
			const correctDir = path.join(agentDir, "sessions", safePath);

			// Create directory if needed
			await fs.promises.mkdir(correctDir, { recursive: true });

			// Move the file
			const fileName = file.split("/").pop() || file.split("\\").pop();
			const newPath = path.join(correctDir, fileName!);

			if (fs.existsSync(newPath)) continue; // Skip if target exists

			await fs.promises.rename(file, newPath);
		} catch (error) {
			logger.warn("Failed to migrate session file", { path: file, error: String(error) });
		}
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
	const migratedAuthProviders = await migrateAuthToAgentDb();
	await migrateSessionsFromAgentRoot();

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
