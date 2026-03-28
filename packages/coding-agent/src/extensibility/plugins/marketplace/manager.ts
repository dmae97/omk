/**
 * MarketplaceManager — orchestrates registry, fetcher, resolver, and cache.
 *
 * Constructor takes explicit paths for testability (same pattern as registry.ts).
 * The `clearPluginRootsCache` dependency is injected so callers can provide
 * the real `clearClaudePluginRootsCache` while tests supply a counter stub.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { isEnoent, logger, pathIsWithin } from "@oh-my-pi/pi-utils";

import { cachePlugin } from "./cache";
import { classifySource, fetchMarketplace, parseMarketplaceCatalog } from "./fetcher";
import {
	addInstalledPlugin,
	addMarketplaceEntry,
	getInstalledPlugin,
	getMarketplaceEntry,
	readInstalledPluginsRegistry,
	readMarketplacesRegistry,
	removeInstalledPlugin,
	removeMarketplaceEntry,
	writeInstalledPluginsRegistry,
	writeMarketplacesRegistry,
} from "./registry";
import { resolvePluginSource } from "./source-resolver";
import type {
	InstalledPluginEntry,
	MarketplaceCatalog,
	MarketplacePluginEntry,
	MarketplaceRegistryEntry,
} from "./types";
import { buildPluginId, parsePluginId } from "./types";

// ── Options ──────────────────────────────────────────────────────────────────

export interface MarketplaceManagerOptions {
	marketplacesRegistryPath: string;
	installedRegistryPath: string;
	marketplacesCacheDir: string;
	pluginsCacheDir: string;
	/** Injected for testing; production callers pass clearClaudePluginRootsCache. */
	clearPluginRootsCache?: () => void;
}

// ── Manager ──────────────────────────────────────────────────────────────────

export class MarketplaceManager {
	#opts: MarketplaceManagerOptions;

	constructor(options: MarketplaceManagerOptions) {
		this.#opts = options;
	}

	// ── Marketplace lifecycle ─────────────────────────────────────────────────

	async addMarketplace(source: string): Promise<MarketplaceRegistryEntry> {
		const { catalog } = await fetchMarketplace(source, this.#opts.marketplacesCacheDir);
		const sourceType = classifySource(source);

		const catalogPath = path.join(this.#opts.marketplacesCacheDir, catalog.name, "marketplace.json");

		// Persist the fetched catalog so subsequent reads don't require re-fetching.
		await Bun.write(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);

		const now = new Date().toISOString();
		const entry: MarketplaceRegistryEntry = {
			name: catalog.name,
			sourceType,
			sourceUri: source,
			catalogPath,
			addedAt: now,
			updatedAt: now,
		};

		const reg = await readMarketplacesRegistry(this.#opts.marketplacesRegistryPath);
		// addMarketplaceEntry throws if name already exists — propagate to caller.
		const updated = addMarketplaceEntry(reg, entry);
		await writeMarketplacesRegistry(this.#opts.marketplacesRegistryPath, updated);

		logger.debug("Marketplace added", { name: catalog.name, sourceType });
		return entry;
	}

	async removeMarketplace(name: string): Promise<void> {
		const reg = await readMarketplacesRegistry(this.#opts.marketplacesRegistryPath);
		// removeMarketplaceEntry throws if not found — propagate to caller.
		const updated = removeMarketplaceEntry(reg, name);
		await writeMarketplacesRegistry(this.#opts.marketplacesRegistryPath, updated);

		await fs.rm(path.join(this.#opts.marketplacesCacheDir, name), {
			recursive: true,
			force: true,
		});

		logger.debug("Marketplace removed", { name });
	}

	async updateMarketplace(name: string): Promise<MarketplaceRegistryEntry> {
		const reg = await readMarketplacesRegistry(this.#opts.marketplacesRegistryPath);
		const existing = getMarketplaceEntry(reg, name);
		if (!existing) {
			throw new Error(`Marketplace "${name}" not found`);
		}

		const { catalog } = await fetchMarketplace(existing.sourceUri, this.#opts.marketplacesCacheDir);

		// Overwrite cached catalog
		await Bun.write(existing.catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);

		const updatedEntry: MarketplaceRegistryEntry = {
			...existing,
			updatedAt: new Date().toISOString(),
		};

		const updatedReg = {
			...reg,
			marketplaces: reg.marketplaces.map(m => (m.name === name ? updatedEntry : m)),
		};
		await writeMarketplacesRegistry(this.#opts.marketplacesRegistryPath, updatedReg);

		logger.debug("Marketplace updated", { name });
		return updatedEntry;
	}

	async updateAllMarketplaces(): Promise<MarketplaceRegistryEntry[]> {
		const marketplaces = await this.listMarketplaces();
		const results: MarketplaceRegistryEntry[] = [];
		for (const m of marketplaces) {
			const updated = await this.updateMarketplace(m.name);
			results.push(updated);
		}
		return results;
	}

	async listMarketplaces(): Promise<MarketplaceRegistryEntry[]> {
		const reg = await readMarketplacesRegistry(this.#opts.marketplacesRegistryPath);
		return reg.marketplaces;
	}

	// ── Plugin discovery ──────────────────────────────────────────────────────

	async listAvailablePlugins(marketplace?: string): Promise<MarketplacePluginEntry[]> {
		const reg = await readMarketplacesRegistry(this.#opts.marketplacesRegistryPath);

		if (marketplace !== undefined) {
			const entry = reg.marketplaces.find(m => m.name === marketplace);
			if (!entry) {
				throw new Error(`Marketplace "${marketplace}" not found`);
			}
			const catalog = await this.#readCatalog(entry);
			return catalog.plugins;
		}

		const all: MarketplacePluginEntry[] = [];
		for (const entry of reg.marketplaces) {
			const catalog = await this.#readCatalog(entry);
			all.push(...catalog.plugins);
		}
		return all;
	}

	async getPluginInfo(name: string, marketplace: string): Promise<MarketplacePluginEntry | null> {
		const plugins = await this.listAvailablePlugins(marketplace);
		return plugins.find(p => p.name === name) ?? null;
	}

	// ── Install / uninstall ───────────────────────────────────────────────────

	async installPlugin(
		name: string,
		marketplace: string,
		options?: { force?: boolean },
	): Promise<InstalledPluginEntry> {
		const force = options?.force ?? false;

		// 1. Find marketplace entry
		const mktReg = await readMarketplacesRegistry(this.#opts.marketplacesRegistryPath);
		const mktEntry = getMarketplaceEntry(mktReg, marketplace);
		if (!mktEntry) {
			throw new Error(`Marketplace "${marketplace}" not found`);
		}

		// 2. Find plugin in catalog
		const catalog = await this.#readCatalog(mktEntry);
		const pluginEntry = catalog.plugins.find(p => p.name === name);
		if (!pluginEntry) {
			throw new Error(`Plugin "${name}" not found in marketplace "${marketplace}"`);
		}

		const pluginId = buildPluginId(name, marketplace);

		// 3. Check if already installed
		const instReg = await readInstalledPluginsRegistry(this.#opts.installedRegistryPath);
		const existing = getInstalledPlugin(instReg, pluginId);
		if (existing && existing.length > 0) {
			if (!force) {
				throw new Error(`Plugin "${pluginId}" is already installed. Use force option to reinstall.`);
			}
			// Remove all cached entries for this plugin (there may be multiple versions)
			for (const entry of existing) {
				await fs.rm(entry.installPath, { recursive: true, force: true });
			}
			const prunedReg = removeInstalledPlugin(instReg, pluginId);
			await writeInstalledPluginsRegistry(this.#opts.installedRegistryPath, prunedReg);
			this.#opts.clearPluginRootsCache?.();
		}

		// 4. Resolve source path.
		// marketplaceClonePath is the marketplace root — the directory containing .claude-plugin/
		// catalogPath is <marketplacesCacheDir>/<name>/marketplace.json, so the root is two levels up.
		// For local sources the content was fetched from a local path; the stored catalog is a copy
		// under marketplacesCacheDir. We need the original source root for resolving relative paths.
		// Use: path.dirname(catalogPath) is <cacheDir>/<name>/, and that IS the stored copy root,
		// so `path.resolve(mktEntry.catalogPath, "../..")` = parent of <name>/ inside cacheDir
		// which is wrong for local sources. Instead, derive from the stored catalog directory:
		// stored at: <marketplacesCacheDir>/<catalogName>/marketplace.json
		// The marketplace root for local sources should be the actual local path, but we only have
		// sourceUri. For local sources, use path.resolve of sourceUri; for others use the cache dir.
		const marketplaceClonePath = this.#resolveMarketplaceRoot(mktEntry);

		const sourcePath = await resolvePluginSource(pluginEntry, {
			marketplaceClonePath,
			catalogMetadata: catalog.metadata,
			tmpDir: os.tmpdir(),
		});
		const isTemp = pathIsWithin(os.tmpdir(), sourcePath);

		// 5. Determine version: catalog entry > plugin manifest > git SHA > fallback
		let version!: string;
		let cachePath!: string;
		try {
			version = await this.#resolvePluginVersion(pluginEntry, sourcePath);
			cachePath = await cachePlugin(sourcePath, this.#opts.pluginsCacheDir, marketplace, name, version);
		} finally {
			// Clean up temp clone dirs created by resolvePluginSource; leave user-supplied local dirs alone
			if (isTemp) {
				// For git-subdir, sourcePath may be a subdir of the temp clone — clean the whole clone root.
				const rel = path.relative(os.tmpdir(), sourcePath);
				const tempRoot = path.join(os.tmpdir(), rel.split(path.sep)[0]);
				await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
			}
		}

		// 6. Build and register the entry
		const now = new Date().toISOString();
		const installedEntry: InstalledPluginEntry = {
			scope: "user",
			installPath: cachePath,
			version,
			installedAt: now,
			lastUpdated: now,
		};

		const freshInstReg = await readInstalledPluginsRegistry(this.#opts.installedRegistryPath);
		const newInstReg = addInstalledPlugin(freshInstReg, pluginId, installedEntry);
		await writeInstalledPluginsRegistry(this.#opts.installedRegistryPath, newInstReg);

		this.#opts.clearPluginRootsCache?.();

		logger.debug("Plugin installed", { pluginId, version, cachePath });
		return installedEntry;
	}

	/**
	 * Resolve plugin version from multiple sources:
	 * 1. Catalog entry version (if set)
	 * 2. Plugin manifest (.claude-plugin/plugin.json or package.json)
	 * 3. Git SHA from source (truncated to 7 chars)
	 * 4. Fallback "0.0.0"
	 */
	async #resolvePluginVersion(entry: MarketplacePluginEntry, sourcePath: string): Promise<string> {
		// 1. Catalog entry version
		if (entry.version) return entry.version;

		// 2. Plugin manifest
		for (const manifestPath of [
			path.join(sourcePath, ".claude-plugin", "plugin.json"),
			path.join(sourcePath, "package.json"),
		]) {
			try {
				const content = await Bun.file(manifestPath).json();
				if (typeof content?.version === "string" && content.version) {
					return content.version;
				}
			} catch {
				// Missing or invalid — try next
			}
		}

		// 3. Git SHA from source definition
		if (typeof entry.source === "object" && "sha" in entry.source && entry.source.sha) {
			return entry.source.sha.slice(0, 7);
		}

		return "0.0.0";
	}

	async uninstallPlugin(pluginId: string): Promise<void> {
		const parsed = parsePluginId(pluginId);
		if (!parsed) {
			throw new Error(`Invalid plugin ID format: "${pluginId}". Expected "name@marketplace".`);
		}

		const reg = await readInstalledPluginsRegistry(this.#opts.installedRegistryPath);
		const entries = getInstalledPlugin(reg, pluginId);
		if (!entries || entries.length === 0) {
			throw new Error(`Plugin "${pluginId}" is not installed`);
		}

		// Remove all install paths from disk
		for (const entry of entries) {
			await fs.rm(entry.installPath, { recursive: true, force: true });
		}

		const updated = removeInstalledPlugin(reg, pluginId);
		await writeInstalledPluginsRegistry(this.#opts.installedRegistryPath, updated);

		this.#opts.clearPluginRootsCache?.();

		logger.debug("Plugin uninstalled", { pluginId });
	}

	// ── Plugin state ──────────────────────────────────────────────────────────

	async listInstalledPlugins(): Promise<Array<{ id: string; entries: InstalledPluginEntry[] }>> {
		const reg = await readInstalledPluginsRegistry(this.#opts.installedRegistryPath);
		return Object.entries(reg.plugins).map(([id, entries]) => ({ id, entries }));
	}

	async setPluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
		const reg = await readInstalledPluginsRegistry(this.#opts.installedRegistryPath);
		const entries = getInstalledPlugin(reg, pluginId);
		if (!entries || entries.length === 0) {
			throw new Error(`Plugin "${pluginId}" is not installed`);
		}

		const updated = {
			...reg,
			plugins: {
				...reg.plugins,
				[pluginId]: entries.map(e => ({ ...e, enabled })),
			},
		};
		await writeInstalledPluginsRegistry(this.#opts.installedRegistryPath, updated);

		this.#opts.clearPluginRootsCache?.();

		logger.debug("Plugin enabled state changed", { pluginId, enabled });
	}

	// ── Update / upgrade ─────────────────────────────────────────────────────

	// Refresh marketplace catalogs that haven't been updated in more than 24 h.
	// Per-marketplace failures are silently swallowed — offline is fine.
	async refreshStaleMarketplaces(): Promise<void> {
		const reg = await readMarketplacesRegistry(this.#opts.marketplacesRegistryPath);
		const staleMs = 24 * 60 * 60 * 1000;
		for (const entry of reg.marketplaces) {
			if (Date.now() - Date.parse(entry.updatedAt) >= staleMs) {
				try {
					await this.updateMarketplace(entry.name);
				} catch {
					// Network or parse failure — leave stale, try next time.
				}
			}
		}
	}

	// Compare installed plugin versions against their catalog entries.
	// Returns only plugins where the catalog declares a newer semver version.
	// Catalog entries without a version field are skipped.
	async checkForUpdates(): Promise<Array<{ pluginId: string; from: string; to: string }>> {
		const instReg = await readInstalledPluginsRegistry(this.#opts.installedRegistryPath);
		const mktReg = await readMarketplacesRegistry(this.#opts.marketplacesRegistryPath);
		const updates: Array<{ pluginId: string; from: string; to: string }> = [];

		for (const [pluginId, entries] of Object.entries(instReg.plugins)) {
			const parsed = parsePluginId(pluginId);
			if (!parsed) continue;
			const installed = entries[0];
			if (!installed) continue;

			const mktEntry = mktReg.marketplaces.find(m => m.name === parsed.marketplace);
			if (!mktEntry) continue;

			let catalogVersion: string | undefined;
			try {
				const catalog = await this.#readCatalog(mktEntry);
				catalogVersion = catalog.plugins.find(p => p.name === parsed.name)?.version;
			} catch {
				continue;
			}

			if (!catalogVersion || catalogVersion === installed.version) continue;

			// Treat newer semver as an update; fall back to inequality for non-semver tags.
			let isNewer: boolean;
			try {
				isNewer = Bun.semver.order(catalogVersion, installed.version) > 0;
			} catch {
				isNewer = catalogVersion !== installed.version;
			}

			if (isNewer) {
				updates.push({ pluginId, from: installed.version, to: catalogVersion });
			}
		}

		return updates;
	}

	// Re-install a specific plugin at the latest catalog version (force-overwrites).
	async upgradePlugin(pluginId: string): Promise<InstalledPluginEntry> {
		const parsed = parsePluginId(pluginId);
		if (!parsed) {
			throw new Error(`Invalid plugin ID: "${pluginId}". Expected "name@marketplace".`);
		}
		return this.installPlugin(parsed.name, parsed.marketplace, { force: true });
	}

	// Upgrade every plugin that checkForUpdates reports as outdated.
	// Per-plugin failures are skipped — partial success is returned.
	async upgradeAllPlugins(): Promise<Array<{ pluginId: string; from: string; to: string }>> {
		const updates = await this.checkForUpdates();
		const results: Array<{ pluginId: string; from: string; to: string }> = [];
		for (const update of updates) {
			try {
				await this.upgradePlugin(update.pluginId);
				results.push(update);
			} catch {
				// Skip this plugin; partial upgrades are better than none.
			}
		}
		return results;
	}

	// ── Private helpers ───────────────────────────────────────────────────────

	async #readCatalog(entry: MarketplaceRegistryEntry): Promise<MarketplaceCatalog> {
		try {
			const content = await Bun.file(entry.catalogPath).text();
			return parseMarketplaceCatalog(content, entry.catalogPath);
		} catch (err) {
			if (isEnoent(err)) {
				throw new Error(
					`Marketplace catalog not found at ${entry.catalogPath}. Try: /marketplace update ${entry.name}`,
				);
			}
			throw err;
		}
	}

	/**
	 * Compute the marketplace root directory for source resolution.
	 *
	 * For local sources: sourceUri IS the local path, so resolve it directly.
	 * This gives the directory containing `.claude-plugin/marketplace.json`,
	 * which is what resolvePluginSource expects as `marketplaceClonePath`.
	 *
	 * For remote sources (git/github/url): the catalog was cloned into
	 * `<marketplacesCacheDir>/<name>/`, so the root is the parent of catalogPath.
	 */
	#resolveMarketplaceRoot(entry: MarketplaceRegistryEntry): string {
		if (entry.sourceType === "local") {
			// expandHome already happened in fetcher; resolve to ensure absolute.
			const expanded = entry.sourceUri.startsWith("~/")
				? path.join(os.homedir(), entry.sourceUri.slice(2))
				: entry.sourceUri;
			return path.resolve(expanded);
		}
		// For git/github/url sources, the catalog lives at <cloneDir>/marketplace.json
		// under marketplacesCacheDir/<name>/; parent = <marketplacesCacheDir>/<name>/
		return path.dirname(entry.catalogPath);
	}
}
