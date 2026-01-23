import type { RenderResult, SpecialHandler } from "./types";
import { finalizeOutput, formatCount, htmlToBasicMarkdown, loadPage } from "./types";

interface PluginVendor {
	name?: string;
	publicName?: string;
	url?: string;
}

interface PluginTag {
	name?: string;
}

type PluginRating =
	| number
	| {
			rating?: number;
			value?: number;
			score?: number;
			votes?: number;
			totalVotes?: number;
			count?: number;
	  };

interface PluginData {
	id?: number;
	name?: string;
	description?: string;
	preview?: string;
	vendor?: PluginVendor;
	rating?: PluginRating;
	ratingCount?: number;
	downloads?: number;
	tags?: PluginTag[];
	urls?: {
		url?: string;
		docUrl?: string;
		sourceCodeUrl?: string;
		bugtrackerUrl?: string;
	};
}

interface UpdateData {
	version?: string;
	since?: string;
	until?: string;
	sinceUntil?: string;
	channel?: string;
	downloads?: number;
	compatibleVersions?: Record<string, string>;
	cdate?: string | number;
}

const MARKETPLACE_HOSTS = new Set(["plugins.jetbrains.com"]);

function extractRating(plugin: PluginData): { value: number | null; votes: number | null } {
	const rating = plugin.rating;
	if (typeof rating === "number" && Number.isFinite(rating)) {
		return { value: rating, votes: plugin.ratingCount ?? null };
	}
	if (rating && typeof rating === "object") {
		const value = rating.rating ?? rating.value ?? rating.score ?? null;
		const votes = rating.votes ?? rating.totalVotes ?? rating.count ?? plugin.ratingCount ?? null;
		return { value: typeof value === "number" ? value : null, votes: typeof votes === "number" ? votes : null };
	}
	return { value: null, votes: plugin.ratingCount ?? null };
}

function formatBuildCompatibility(update: UpdateData): string | null {
	if (update.sinceUntil) return update.sinceUntil;
	if (update.since && update.until) return `${update.since} - ${update.until}`;
	if (update.since) return `${update.since}+`;
	return null;
}

export const handleJetBrainsMarketplace: SpecialHandler = async (
	url: string,
	timeout: number,
	signal?: AbortSignal,
): Promise<RenderResult | null> => {
	try {
		const parsed = new URL(url);
		if (!MARKETPLACE_HOSTS.has(parsed.hostname)) return null;

		const match = parsed.pathname.match(/^\/plugin\/(\d+)(?:-[^/]+)?(?:\/|$)/);
		if (!match) return null;

		const pluginId = match[1];
		const fetchedAt = new Date().toISOString();

		const pluginUrl = `https://plugins.jetbrains.com/api/plugins/${pluginId}`;
		const updatesUrl = `https://plugins.jetbrains.com/api/plugins/${pluginId}/updates?size=1`;

		const [pluginResult, updatesResult] = await Promise.all([
			loadPage(pluginUrl, { timeout, signal }),
			loadPage(updatesUrl, { timeout, signal }),
		]);

		if (!pluginResult.ok || !updatesResult.ok) return null;

		let plugin: PluginData;
		let updates: UpdateData[];

		try {
			plugin = JSON.parse(pluginResult.content) as PluginData;
			updates = JSON.parse(updatesResult.content) as UpdateData[];
		} catch {
			return null;
		}

		const update = updates[0];
		if (!plugin?.name) return null;

		const vendorName = plugin.vendor?.name ?? plugin.vendor?.publicName;
		const descriptionSource = plugin.description ?? plugin.preview ?? "";
		const description = descriptionSource ? htmlToBasicMarkdown(descriptionSource) : "";
		const tags = (plugin.tags ?? []).map((tag) => tag.name).filter(Boolean) as string[];
		const rating = extractRating(plugin);
		const buildCompatibility = update ? formatBuildCompatibility(update) : null;

		let md = `# ${plugin.name}\n\n`;
		if (description) md += `${description}\n\n`;

		md += `**Plugin ID:** ${pluginId}\n`;
		if (vendorName) md += `**Vendor:** ${vendorName}\n`;
		if (plugin.downloads !== undefined) {
			md += `**Downloads:** ${formatCount(plugin.downloads)}\n`;
		}
		if (rating.value !== null) {
			md += `**Rating:** ${rating.value.toFixed(2)}`;
			if (rating.votes !== null) md += ` (${formatCount(rating.votes)} votes)`;
			md += "\n";
		}
		if (tags.length) md += `**Tags:** ${tags.join(", ")}\n`;

		if (update) {
			md += "\n## Latest Release\n\n";
			if (update.version) md += `**Version:** ${update.version}\n`;
			if (update.channel) md += `**Channel:** ${update.channel}\n`;
			if (buildCompatibility) md += `**Build Compatibility:** ${buildCompatibility}\n`;
			if (update.downloads !== undefined) {
				md += `**Release Downloads:** ${formatCount(update.downloads)}\n`;
			}
		}

		const compatibility = update?.compatibleVersions ?? {};
		const compatibilityEntries = Object.entries(compatibility).sort(([a], [b]) => a.localeCompare(b));
		if (compatibilityEntries.length) {
			md += "\n## IDE Compatibility\n\n";
			for (const [product, version] of compatibilityEntries) {
				md += `- ${product}: ${version}\n`;
			}
		}

		const output = finalizeOutput(md);
		return {
			url,
			finalUrl: url,
			contentType: "text/markdown",
			method: "jetbrains-marketplace",
			content: output.content,
			fetchedAt,
			truncated: output.truncated,
			notes: ["Fetched via JetBrains Marketplace API"],
		};
	} catch {}

	return null;
};
