import * as path from "node:path";
import { isRecord } from "@oh-my-pi/pi-utils";
import { hasRootMarkers, resolveCommand } from "../lsp/config";
import DEFAULTS from "./defaults.json" with { type: "json" };
import type { DapAdapterConfig, DapResolvedAdapter } from "./types";

const EXTENSIONLESS_DEBUGGER_ORDER = ["gdb", "lldb-dap"] as const;

function normalizeStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function normalizeObject(value: unknown): Record<string, unknown> {
	return isRecord(value) ? { ...value } : {};
}

function normalizeAdapterConfig(config: unknown): DapAdapterConfig | null {
	if (!isRecord(config)) return null;
	if (typeof config.command !== "string" || config.command.length === 0) return null;
	return {
		command: config.command,
		args: normalizeStringArray(config.args),
		languages: normalizeStringArray(config.languages),
		fileTypes: normalizeStringArray(config.fileTypes).map(entry => entry.toLowerCase()),
		rootMarkers: normalizeStringArray(config.rootMarkers),
		launchDefaults: normalizeObject(config.launchDefaults),
		attachDefaults: normalizeObject(config.attachDefaults),
	};
}

function getDefaults(): Record<string, DapAdapterConfig> {
	const adapters: Record<string, DapAdapterConfig> = {};
	for (const [name, config] of Object.entries(DEFAULTS)) {
		const normalized = normalizeAdapterConfig(config);
		if (normalized) {
			adapters[name] = normalized;
		}
	}
	return adapters;
}

const DEFAULT_ADAPTERS = getDefaults();

export function getAdapterConfigs(): Record<string, DapAdapterConfig> {
	return { ...DEFAULT_ADAPTERS };
}

export function resolveAdapter(adapterName: string, cwd: string): DapResolvedAdapter | null {
	const config = DEFAULT_ADAPTERS[adapterName];
	if (!config) return null;
	const resolvedCommand = resolveCommand(config.command, cwd);
	if (!resolvedCommand) return null;
	return {
		name: adapterName,
		command: config.command,
		args: config.args ?? [],
		resolvedCommand,
		languages: config.languages ?? [],
		fileTypes: config.fileTypes ?? [],
		rootMarkers: config.rootMarkers ?? [],
		launchDefaults: config.launchDefaults ?? {},
		attachDefaults: config.attachDefaults ?? {},
	};
}

export function getAvailableAdapters(cwd: string): DapResolvedAdapter[] {
	return Object.keys(DEFAULT_ADAPTERS)
		.map(name => resolveAdapter(name, cwd))
		.filter((adapter): adapter is DapResolvedAdapter => adapter !== null);
}

function getMatchingAdapters(program: string, cwd: string): DapResolvedAdapter[] {
	const extension = path.extname(program).toLowerCase();
	const available = getAvailableAdapters(cwd);
	if (!extension) return available;
	const exactMatches = available.filter(adapter => adapter.fileTypes.includes(extension));
	if (exactMatches.length > 0) {
		return exactMatches;
	}
	return available;
}

function sortAdaptersForLaunch(program: string, cwd: string, adapters: DapResolvedAdapter[]): DapResolvedAdapter[] {
	const extension = path.extname(program).toLowerCase();
	const rootAware = adapters.map(adapter => ({
		adapter,
		hasExtensionMatch: extension.length > 0 && adapter.fileTypes.includes(extension),
		hasRootMatch: adapter.rootMarkers.length > 0 && hasRootMarkers(cwd, adapter.rootMarkers),
	}));
	rootAware.sort((left, right) => {
		if (left.hasExtensionMatch !== right.hasExtensionMatch) {
			return left.hasExtensionMatch ? -1 : 1;
		}
		if (left.hasRootMatch !== right.hasRootMatch) {
			return left.hasRootMatch ? -1 : 1;
		}
		const leftDebuggerRank = EXTENSIONLESS_DEBUGGER_ORDER.indexOf(
			left.adapter.name as (typeof EXTENSIONLESS_DEBUGGER_ORDER)[number],
		);
		const rightDebuggerRank = EXTENSIONLESS_DEBUGGER_ORDER.indexOf(
			right.adapter.name as (typeof EXTENSIONLESS_DEBUGGER_ORDER)[number],
		);
		const normalizedLeftRank = leftDebuggerRank === -1 ? Number.MAX_SAFE_INTEGER : leftDebuggerRank;
		const normalizedRightRank = rightDebuggerRank === -1 ? Number.MAX_SAFE_INTEGER : rightDebuggerRank;
		if (normalizedLeftRank !== normalizedRightRank) {
			return normalizedLeftRank - normalizedRightRank;
		}
		return left.adapter.name.localeCompare(right.adapter.name);
	});
	return rootAware.map(entry => entry.adapter);
}

export function selectLaunchAdapter(program: string, cwd: string, adapterName?: string): DapResolvedAdapter | null {
	if (adapterName) {
		return resolveAdapter(adapterName, cwd);
	}
	const matches = getMatchingAdapters(program, cwd);
	const sorted = sortAdaptersForLaunch(program, cwd, matches);
	return sorted[0] ?? null;
}

export function selectAttachAdapter(cwd: string, adapterName?: string, port?: number): DapResolvedAdapter | null {
	if (adapterName) {
		return resolveAdapter(adapterName, cwd);
	}
	const available = getAvailableAdapters(cwd);
	if (port !== undefined) {
		const debugpy = available.find(adapter => adapter.name === "debugpy");
		if (debugpy) return debugpy;
	}
	for (const preferred of EXTENSIONLESS_DEBUGGER_ORDER) {
		const match = available.find(adapter => adapter.name === preferred);
		if (match) return match;
	}
	return available[0] ?? null;
}
