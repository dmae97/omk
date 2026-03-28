import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { MarketplaceManager } from "@oh-my-pi/pi-coding-agent/extensibility/plugins/marketplace";

// Fixture: the valid-marketplace directory used across all tests.
const FIXTURE_DIR = path.join(import.meta.dir, "fixtures", "valid-marketplace");

// ── Test helper ───────────────────────────────────────────────────────────────

interface TestContext {
	manager: MarketplaceManager;
	tmpDir: string;
	/** Incremented each time clearPluginRootsCache is called. */
	clearCount: () => number;
}

function createTestContext(): TestContext {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-mgr-test-"));

	const dirs = {
		mktRegistry: path.join(tmpDir, "marketplaces.json"),
		instRegistry: path.join(tmpDir, "installed_plugins.json"),
		mktCache: path.join(tmpDir, "cache", "marketplaces"),
		plugCache: path.join(tmpDir, "cache", "plugins"),
	};

	let count = 0;

	const manager = new MarketplaceManager({
		marketplacesRegistryPath: dirs.mktRegistry,
		installedRegistryPath: dirs.instRegistry,
		marketplacesCacheDir: dirs.mktCache,
		pluginsCacheDir: dirs.plugCache,
		clearPluginRootsCache: () => {
			count++;
		},
	});

	return { manager, tmpDir, clearCount: () => count };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MarketplaceManager", () => {
	let ctx: TestContext;

	beforeEach(() => {
		ctx = createTestContext();
	});

	afterEach(() => {
		fs.rmSync(ctx.tmpDir, { recursive: true, force: true });
	});

	// ── Marketplace lifecycle ──────────────────────────────────────────────

	it("addMarketplace with local fixture → appears in listMarketplaces", async () => {
		const entry = await ctx.manager.addMarketplace(FIXTURE_DIR);

		expect(entry.name).toBe("test-marketplace");
		expect(entry.sourceType).toBe("local");
		expect(entry.sourceUri).toBe(FIXTURE_DIR);

		const list = await ctx.manager.listMarketplaces();
		expect(list).toHaveLength(1);
		expect(list[0].name).toBe("test-marketplace");
	});

	it("addMarketplace with duplicate name → throws", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		await expect(ctx.manager.addMarketplace(FIXTURE_DIR)).rejects.toThrow(/already exists/);
	});

	it("removeMarketplace → gone from list and catalog cache removed", async () => {
		const entry = await ctx.manager.addMarketplace(FIXTURE_DIR);

		// Catalog file should exist in cache
		expect(fs.existsSync(entry.catalogPath)).toBe(true);

		await ctx.manager.removeMarketplace("test-marketplace");

		const list = await ctx.manager.listMarketplaces();
		expect(list).toHaveLength(0);

		// Catalog cache dir should be gone
		const catalogDir = path.dirname(entry.catalogPath);
		expect(fs.existsSync(catalogDir)).toBe(false);
	});

	it("updateMarketplace on nonexistent marketplace → throws", async () => {
		await expect(ctx.manager.updateMarketplace("ghost")).rejects.toThrow(/not found/);
	});

	it("updateMarketplace re-fetches and updates updatedAt", async () => {
		const added = await ctx.manager.addMarketplace(FIXTURE_DIR);

		// Small sleep so clock advances
		await Bun.sleep(5);

		const updated = await ctx.manager.updateMarketplace("test-marketplace");
		expect(updated.name).toBe("test-marketplace");
		expect(updated.addedAt).toBe(added.addedAt);
		// updatedAt must be at or after addedAt
		expect(new Date(updated.updatedAt) >= new Date(added.addedAt)).toBe(true);
	});

	// ── Plugin discovery ───────────────────────────────────────────────────

	it("listAvailablePlugins → returns catalog entries", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		const plugins = await ctx.manager.listAvailablePlugins();
		expect(plugins).toHaveLength(1);
		expect(plugins[0].name).toBe("hello-plugin");
	});

	it("listAvailablePlugins(marketplace) → filtered to that marketplace", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		const plugins = await ctx.manager.listAvailablePlugins("test-marketplace");
		expect(plugins).toHaveLength(1);
		expect(plugins[0].name).toBe("hello-plugin");
	});

	it("listAvailablePlugins(unknown) → throws", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		await expect(ctx.manager.listAvailablePlugins("no-such")).rejects.toThrow(/not found/);
	});

	// ── Install ────────────────────────────────────────────────────────────

	it("installPlugin → plugin in cache + in registry", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		const instEntry = await ctx.manager.installPlugin("hello-plugin", "test-marketplace");

		expect(instEntry.scope).toBe("user");
		expect(instEntry.version).toBe("1.0.0");
		expect(fs.existsSync(instEntry.installPath)).toBe(true);

		const installed = await ctx.manager.listInstalledPlugins();
		expect(installed).toHaveLength(1);
		expect(installed[0].id).toBe("hello-plugin@test-marketplace");
	});

	it("installPlugin already installed → throws without force", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		await ctx.manager.installPlugin("hello-plugin", "test-marketplace");
		await expect(ctx.manager.installPlugin("hello-plugin", "test-marketplace")).rejects.toThrow(/already installed/);
	});

	it("installPlugin with force:true → replaces existing", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		const first = await ctx.manager.installPlugin("hello-plugin", "test-marketplace");
		const second = await ctx.manager.installPlugin("hello-plugin", "test-marketplace", {
			force: true,
		});

		expect(second.installPath).toBe(first.installPath);
		expect(fs.existsSync(second.installPath)).toBe(true);

		const installed = await ctx.manager.listInstalledPlugins();
		expect(installed).toHaveLength(1);
	});

	it("installPlugin with nonexistent marketplace → clear error", async () => {
		await expect(ctx.manager.installPlugin("hello-plugin", "no-such-market")).rejects.toThrow(
			/Marketplace "no-such-market" not found/,
		);
	});

	it("installPlugin with nonexistent plugin in catalog → clear error", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		await expect(ctx.manager.installPlugin("ghost-plugin", "test-marketplace")).rejects.toThrow(
			/Plugin "ghost-plugin" not found in marketplace "test-marketplace"/,
		);
	});

	it("installPlugin calls clearPluginRootsCache", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		const before = ctx.clearCount();
		await ctx.manager.installPlugin("hello-plugin", "test-marketplace");
		expect(ctx.clearCount()).toBe(before + 1);
	});

	// ── Uninstall ──────────────────────────────────────────────────────────

	it("uninstallPlugin → cache removed + deregistered", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		const instEntry = await ctx.manager.installPlugin("hello-plugin", "test-marketplace");

		await ctx.manager.uninstallPlugin("hello-plugin@test-marketplace");

		expect(fs.existsSync(instEntry.installPath)).toBe(false);

		const installed = await ctx.manager.listInstalledPlugins();
		expect(installed).toHaveLength(0);
	});

	it("uninstallPlugin nonexistent → throws", async () => {
		await expect(ctx.manager.uninstallPlugin("ghost-plugin@nowhere")).rejects.toThrow(/not installed/);
	});

	it("uninstallPlugin with invalid ID format → throws clear error", async () => {
		await expect(ctx.manager.uninstallPlugin("no-at-sign")).rejects.toThrow(/Invalid plugin ID format/);
	});

	it("uninstallPlugin calls clearPluginRootsCache", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		await ctx.manager.installPlugin("hello-plugin", "test-marketplace");
		const before = ctx.clearCount();
		await ctx.manager.uninstallPlugin("hello-plugin@test-marketplace");
		expect(ctx.clearCount()).toBe(before + 1);
	});

	// ── setPluginEnabled ───────────────────────────────────────────────────

	it("setPluginEnabled → persisted in registry", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		await ctx.manager.installPlugin("hello-plugin", "test-marketplace");

		await ctx.manager.setPluginEnabled("hello-plugin@test-marketplace", false);

		const installed = await ctx.manager.listInstalledPlugins();
		expect(installed[0].entries[0].enabled).toBe(false);

		await ctx.manager.setPluginEnabled("hello-plugin@test-marketplace", true);
		const updated = await ctx.manager.listInstalledPlugins();
		expect(updated[0].entries[0].enabled).toBe(true);
	});

	it("setPluginEnabled on nonexistent plugin → throws", async () => {
		await expect(ctx.manager.setPluginEnabled("ghost@nowhere", true)).rejects.toThrow(/not installed/);
	});

	it("setPluginEnabled calls clearPluginRootsCache", async () => {
		await ctx.manager.addMarketplace(FIXTURE_DIR);
		await ctx.manager.installPlugin("hello-plugin", "test-marketplace");
		const before = ctx.clearCount();
		await ctx.manager.setPluginEnabled("hello-plugin@test-marketplace", false);
		expect(ctx.clearCount()).toBe(before + 1);
	});

	// ── version fallback ───────────────────────────────────────────────────

	it("installPlugin falls back to plugin.json version when catalog version is missing", async () => {
		// Write a catalog without a version field on the plugin
		await ctx.manager.addMarketplace(FIXTURE_DIR);

		// Mutate the cached catalog to remove version
		const list = await ctx.manager.listMarketplaces();
		const catalogPath = list[0].catalogPath;
		const content = await Bun.file(catalogPath).text();
		const catalog = JSON.parse(content) as {
			plugins: Array<Record<string, unknown>>;
		};
		catalog.plugins[0] = { ...catalog.plugins[0] };
		delete catalog.plugins[0].version;
		await Bun.write(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);

		const instEntry = await ctx.manager.installPlugin("hello-plugin", "test-marketplace");
		// No catalog version, but fixture's .claude-plugin/plugin.json has version "1.0.0"
		expect(instEntry.version).toBe("1.0.0");
	});
});
