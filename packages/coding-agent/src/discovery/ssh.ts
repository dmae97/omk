/**
 * SSH JSON Provider
 *
 * Discovers SSH hosts from ssh.json or .ssh.json in the project root.
 * Priority: 5 (low, project-level only)
 */

import { join } from "node:path";
import { readFile } from "$c/capability/fs";
import { registerProvider } from "$c/capability/index";
import { type SSHHost, sshCapability } from "$c/capability/ssh";
import type { LoadContext, LoadResult, SourceMeta } from "$c/capability/types";
import { createSourceMeta, expandEnvVarsDeep, parseJSON } from "./helpers";

const PROVIDER_ID = "ssh-json";
const DISPLAY_NAME = "SSH Config";

interface SSHConfigFile {
	hosts?: Record<
		string,
		{
			host?: string;
			username?: string;
			port?: number | string;
			compat?: boolean | string;
			key?: string;
			keyPath?: string;
			description?: string;
		}
	>;
}

function expandTilde(value: string, home: string): string {
	if (value === "~") return home;
	if (value.startsWith("~/") || value.startsWith("~\\")) {
		return `${home}${value.slice(1)}`;
	}
	return value;
}

function parsePort(value: number | string | undefined): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
	const parsed = Number.parseInt(value, 10);
	return Number.isNaN(parsed) ? undefined : parsed;
}

function parseCompat(value: boolean | string | undefined): boolean | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "boolean") return value;
	const normalized = value.trim().toLowerCase();
	if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
	if (normalized === "false" || normalized === "0" || normalized === "no") return false;
	return undefined;
}

function normalizeHost(
	name: string,
	raw: NonNullable<SSHConfigFile["hosts"]>[string],
	source: SourceMeta,
	home: string,
	warnings: string[],
): SSHHost | null {
	if (!raw.host) {
		warnings.push(`Missing host for SSH entry: ${name}`);
		return null;
	}

	const port = parsePort(raw.port);
	if (raw.port !== undefined && port === undefined) {
		warnings.push(`Invalid port for SSH entry ${name}: ${String(raw.port)}`);
	}

	const compat = parseCompat(raw.compat);
	if (raw.compat !== undefined && compat === undefined) {
		warnings.push(`Invalid compat flag for SSH entry ${name}: ${String(raw.compat)}`);
	}

	const keyValue = raw.keyPath ?? raw.key;
	const keyPath = keyValue ? expandTilde(keyValue, home) : undefined;

	return {
		name,
		host: raw.host,
		username: raw.username,
		port,
		keyPath,
		description: raw.description,
		compat,
		_source: source,
	};
}

async function loadSshJsonFile(_ctx: LoadContext, path: string): Promise<LoadResult<SSHHost>> {
	const items: SSHHost[] = [];
	const warnings: string[] = [];

	const content = await readFile(path);
	if (content === null) {
		return { items, warnings };
	}

	const parsed = parseJSON<SSHConfigFile>(content);
	if (!parsed) {
		warnings.push(`Failed to parse JSON in ${path}`);
		return { items, warnings };
	}

	const config = expandEnvVarsDeep(parsed);
	if (!config.hosts || typeof config.hosts !== "object") {
		warnings.push(`Missing hosts in ${path}`);
		return { items, warnings };
	}

	const source = createSourceMeta(PROVIDER_ID, path, "project");
	for (const [name, rawHost] of Object.entries(config.hosts)) {
		if (!name.trim()) {
			warnings.push(`Invalid SSH host name in ${path}`);
			continue;
		}
		if (!rawHost || typeof rawHost !== "object") {
			warnings.push(`Invalid host entry in ${path}: ${name}`);
			continue;
		}
		const host = normalizeHost(name, rawHost, source, _ctx.home, warnings);
		if (host) items.push(host);
	}

	return {
		items,
		warnings: warnings.length > 0 ? warnings : undefined,
	};
}

async function load(ctx: LoadContext): Promise<LoadResult<SSHHost>> {
	const filenames = ["ssh.json", ".ssh.json"];
	const results = await Promise.all(filenames.map((filename) => loadSshJsonFile(ctx, join(ctx.cwd, filename))));

	const allItems = results.flatMap((r) => r.items);
	const allWarnings = results.flatMap((r) => r.warnings ?? []);

	return {
		items: allItems,
		warnings: allWarnings.length > 0 ? allWarnings : undefined,
	};
}

registerProvider(sshCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Load SSH hosts from ssh.json or .ssh.json in the project root",
	priority: 5,
	load,
});
