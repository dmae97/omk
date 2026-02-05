import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Parses a .env file synchronously and extracts key-value string pairs.
 * Ignores lines that are empty or start with '#'. Trims whitespace.
 * Allows values to be quoted with single or double quotes.
 * Returns an object of key-value pairs.
 */
function parseEnvFile(filePath: string): Record<string, string> {
	const result: Record<string, string> = {};
	try {
		const content = fs.readFileSync(filePath, "utf-8");
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			// Skip comments and blank lines
			if (!trimmed || trimmed.startsWith("#")) continue;

			const eqIndex = trimmed.indexOf("=");
			if (eqIndex === -1) continue;

			const key = trimmed.slice(0, eqIndex).trim();
			let value = trimmed.slice(eqIndex + 1).trim();

			// Remove surrounding quotes (" or ')
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1);
			}

			result[key] = value;
		}
	} catch {
		// File doesn't exist or can't be read - return empty result
	}
	return result;
}

// Eagerly parse the user's $HOME/.env and the current project's .env (from cwd)
const cachedHomeEnv = parseEnvFile(path.join(os.homedir(), ".env"));
const cachedProjectEnv = parseEnvFile(path.join(process.cwd(), ".env"));

/**
 * Defines the scopes by which environment variables can be fetched:
 * - "global-only": Only user's home (~/.env)
 * - "project-only": Only current working directory .env
 * - "global": Merges home + project .env + process.env (priority right-to-left)
 * - "project": Merges project .env + process.env (priority right-to-left)
 * - "process": Only process.env
 */
export type EnvScope = "global-only" | "project-only" | "global" | "project" | "process";

type ReadOnlyEnv = ReadOnlyDict<string>;

/**
 * Merges several env objects (last wins unless prior has value and later is empty string),
 * with leftmost object having lowest priority.
 */
function mergeEnvs(envs: ReadOnlyDict<string>[]): Record<string, string> {
	const joint: Record<string, string> = {};
	for (const env of envs) {
		for (const key in env) {
			const value = env[key];
			if (typeof value === "string") {
				// Overwrite unless the new value is empty string and we already have a value.
				if (!(key in joint) || value) {
					joint[key] = value;
				}
			}
		}
	}
	return joint;
}

/**
 * Utility for constructing a Proxy that merges one or more source objects, for env scopes.
 * Precedence: item at end of the array has highest priority.
 * If a higher-key is empty string, but an earlier has value, keep earlier's non-empty value.
 */
function proxyMergedEnv(...nonProcessSources: Array<ReadOnlyEnv>): ReadOnlyEnv {
	const merged = mergeEnvs(nonProcessSources);
	const keys = Object.keys(merged);

	return new Proxy<ReadOnlyEnv>({} as ReadOnlyEnv, {
		get(_target, prop: string) {
			let found = merged[prop];
			if (prop in process.env) {
				const val = process.env[prop];
				if (val && !found) {
					found = val;
				}
			}
			return found;
		},
		ownKeys(_target) {
			const result = [...keys];
			for (const key in process.env) {
				if (!(key in merged)) {
					result.push(key);
				}
			}
			return result;
		},
		getOwnPropertyDescriptor(_target, prop: string) {
			if (prop in merged) {
				return { enumerable: true, configurable: true };
			}
			if (prop in process.env) {
				return { enumerable: true, configurable: true };
			}
			return undefined;
		},
	});
}

// Constructs the environment variable maps for each scope, using proxies for merged scopes.
// process.env is always live; proxies ensure merged scopes reflect runtime changes.
const envs: Record<EnvScope, ReadOnlyEnv> = {
	"global-only": cachedHomeEnv,
	"project-only": cachedProjectEnv,
	global: proxyMergedEnv(cachedHomeEnv, cachedProjectEnv),
	project: proxyMergedEnv(cachedProjectEnv),
	process: process.env,
};

/**
 * Returns the environment variable mapping for the given scope.
 * For merged/project/global scopes, provides a dynamic proxy that reflects live process.env changes.
 */
export function getEnvMap(scope: EnvScope = "global"): ReadOnlyEnv {
	return envs[scope];
}

/**
 * Gets the value of a single environment variable from the specified scope.
 */
export function getEnv(key: string, scope: EnvScope = "global"): string | undefined {
	return envs[scope][key];
}
