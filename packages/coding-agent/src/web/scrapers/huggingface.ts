import type { SpecialHandler } from "./types";
import { finalizeOutput, formatCount, loadPage } from "./types";

interface HfModelData {
	modelId: string;
	pipeline_tag?: string;
	library_name?: string;
	tags?: string[];
	downloads?: number;
	likes?: number;
	private?: boolean;
	gated?: boolean | string;
	cardData?: {
		license?: string;
		language?: string | string[];
		datasets?: string[];
		metrics?: string[];
	};
}

interface HfDatasetData {
	id: string;
	tags?: string[];
	downloads?: number;
	likes?: number;
	private?: boolean;
	gated?: boolean | string;
	cardData?: {
		license?: string;
		language?: string | string[];
		task_categories?: string[];
		size_categories?: string[];
	};
	description?: string;
}

interface HfSpaceData {
	id: string;
	author?: string;
	title?: string;
	sdk?: string;
	tags?: string[];
	likes?: number;
	private?: boolean;
	cardData?: {
		license?: string;
		sdk?: string;
		app_file?: string;
	};
}

interface HfUserData {
	avatarUrl?: string;
	fullname?: string;
	user?: string;
	orgs?: Array<{ name: string }>;
	numModels?: number;
	numDatasets?: number;
	numSpaces?: number;
}

/**
 * Parse Hugging Face URL and determine type
 */
function parseHuggingFaceUrl(url: string): {
	type: "model" | "dataset" | "space" | "model_or_user";
	id: string; // Full ID (org/name or just name)
} | null {
	try {
		const parsed = new URL(url);
		if (parsed.hostname !== "huggingface.co") return null;

		const parts = parsed.pathname.split("/").filter(Boolean);
		if (parts.length === 0) return null;

		// huggingface.co/datasets/{org}/{dataset} or huggingface.co/datasets/{dataset}
		if (parts[0] === "datasets" && parts.length >= 2) {
			const id = parts.slice(1).join("/");
			return { type: "dataset", id };
		}

		// huggingface.co/spaces/{org}/{space}
		if (parts[0] === "spaces" && parts.length >= 3) {
			return { type: "space", id: `${parts[1]}/${parts[2]}` };
		}

		// Skip non-resource paths
		const reservedPaths = ["docs", "blog", "pricing", "enterprise", "join", "login", "settings"];
		if (reservedPaths.includes(parts[0])) {
			return null;
		}

		// huggingface.co/{org}/{model} (two parts = definitely a model)
		if (parts.length >= 2) {
			return { type: "model", id: `${parts[0]}/${parts[1]}` };
		}

		// huggingface.co/{id} (single part = could be model or user, try model first)
		if (parts.length === 1) {
			return { type: "model_or_user", id: parts[0] };
		}

		return null;
	} catch {
		return null;
	}
}

export const handleHuggingFace: SpecialHandler = async (url: string, timeout: number, signal?: AbortSignal) => {
	const parsed = parseHuggingFaceUrl(url);
	if (!parsed) return null;

	const fetchedAt = new Date().toISOString();
	const notes: string[] = [];

	try {
		switch (parsed.type) {
			case "model": {
				const apiUrl = `https://huggingface.co/api/models/${parsed.id}`;
				const readmeUrl = `https://huggingface.co/${parsed.id}/raw/main/README.md`;

				const [apiResult, readmeResult] = await Promise.all([
					loadPage(apiUrl, { timeout, signal }),
					loadPage(readmeUrl, { timeout: Math.min(timeout, 5), signal }),
				]);

				if (!apiResult.ok) return null;

				let model: HfModelData;
				try {
					model = JSON.parse(apiResult.content);
				} catch {
					return null;
				}

				let md = `# ${model.modelId}\n\n`;

				if (model.pipeline_tag) md += `**Task:** ${model.pipeline_tag}\n`;
				if (model.library_name) md += `**Library:** ${model.library_name}\n`;
				if (model.downloads !== undefined) md += `**Downloads:** ${formatCount(model.downloads)}\n`;
				if (model.likes !== undefined) md += `**Likes:** ${formatCount(model.likes)}\n`;
				if (model.private) md += `**Visibility:** Private\n`;
				if (model.gated) md += `**Access:** Gated\n`;

				if (model.cardData) {
					if (model.cardData.license) md += `**License:** ${model.cardData.license}\n`;
					if (model.cardData.language) {
						const langs = Array.isArray(model.cardData.language)
							? model.cardData.language.join(", ")
							: model.cardData.language;
						md += `**Language:** ${langs}\n`;
					}
					if (model.cardData.datasets?.length) {
						md += `**Datasets:** ${model.cardData.datasets.join(", ")}\n`;
					}
					if (model.cardData.metrics?.length) {
						md += `**Metrics:** ${model.cardData.metrics.join(", ")}\n`;
					}
				}

				if (model.tags?.length) {
					md += `**Tags:** ${model.tags.join(", ")}\n`;
				}

				md += "\n";

				if (readmeResult.ok && readmeResult.content.trim()) {
					md += `## Model Card\n\n${readmeResult.content}`;
				}

				const { content, truncated } = finalizeOutput(md);
				return {
					url,
					finalUrl: apiResult.finalUrl,
					contentType: "text/markdown",
					method: "huggingface",
					content,
					fetchedAt,
					truncated,
					notes,
				};
			}

			case "dataset": {
				const apiUrl = `https://huggingface.co/api/datasets/${parsed.id}`;
				const readmeUrl = `https://huggingface.co/datasets/${parsed.id}/raw/main/README.md`;

				const [apiResult, readmeResult] = await Promise.all([
					loadPage(apiUrl, { timeout, signal }),
					loadPage(readmeUrl, { timeout: Math.min(timeout, 5), signal }),
				]);

				if (!apiResult.ok) return null;

				let dataset: HfDatasetData;
				try {
					dataset = JSON.parse(apiResult.content);
				} catch {
					return null;
				}

				let md = `# ${dataset.id}\n\n`;
				if (dataset.description) md += `${dataset.description}\n\n`;

				if (dataset.downloads !== undefined) md += `**Downloads:** ${formatCount(dataset.downloads)}\n`;
				if (dataset.likes !== undefined) md += `**Likes:** ${formatCount(dataset.likes)}\n`;
				if (dataset.private) md += `**Visibility:** Private\n`;
				if (dataset.gated) md += `**Access:** Gated\n`;

				if (dataset.cardData) {
					if (dataset.cardData.license) md += `**License:** ${dataset.cardData.license}\n`;
					if (dataset.cardData.language) {
						const langs = Array.isArray(dataset.cardData.language)
							? dataset.cardData.language.join(", ")
							: dataset.cardData.language;
						md += `**Language:** ${langs}\n`;
					}
					if (dataset.cardData.task_categories?.length) {
						md += `**Tasks:** ${dataset.cardData.task_categories.join(", ")}\n`;
					}
					if (dataset.cardData.size_categories?.length) {
						md += `**Size:** ${dataset.cardData.size_categories.join(", ")}\n`;
					}
				}

				if (dataset.tags?.length) {
					md += `**Tags:** ${dataset.tags.join(", ")}\n`;
				}

				md += "\n";

				if (readmeResult.ok && readmeResult.content.trim()) {
					md += `## Dataset Card\n\n${readmeResult.content}`;
				}

				const { content, truncated } = finalizeOutput(md);
				return {
					url,
					finalUrl: apiResult.finalUrl,
					contentType: "text/markdown",
					method: "huggingface",
					content,
					fetchedAt,
					truncated,
					notes,
				};
			}

			case "space": {
				const apiUrl = `https://huggingface.co/api/spaces/${parsed.id}`;
				const readmeUrl = `https://huggingface.co/spaces/${parsed.id}/raw/main/README.md`;

				const [apiResult, readmeResult] = await Promise.all([
					loadPage(apiUrl, { timeout, signal }),
					loadPage(readmeUrl, { timeout: Math.min(timeout, 5), signal }),
				]);

				if (!apiResult.ok) return null;

				let space: HfSpaceData;
				try {
					space = JSON.parse(apiResult.content);
				} catch {
					return null;
				}

				let md = `# ${space.id}\n\n`;
				if (space.title) md += `${space.title}\n\n`;

				if (space.author) md += `**Author:** ${space.author}\n`;
				if (space.sdk) md += `**SDK:** ${space.sdk}\n`;
				if (space.likes !== undefined) md += `**Likes:** ${formatCount(space.likes)}\n`;
				if (space.private) md += `**Visibility:** Private\n`;

				if (space.cardData) {
					if (space.cardData.license) md += `**License:** ${space.cardData.license}\n`;
					if (space.cardData.app_file) md += `**App File:** ${space.cardData.app_file}\n`;
				}

				if (space.tags?.length) {
					md += `**Tags:** ${space.tags.join(", ")}\n`;
				}

				md += "\n";

				if (readmeResult.ok && readmeResult.content.trim()) {
					md += `## Space Info\n\n${readmeResult.content}`;
				}

				const { content, truncated } = finalizeOutput(md);
				return {
					url,
					finalUrl: apiResult.finalUrl,
					contentType: "text/markdown",
					method: "huggingface",
					content,
					fetchedAt,
					truncated,
					notes,
				};
			}

			case "model_or_user": {
				// Try model API first
				const modelApiUrl = `https://huggingface.co/api/models/${parsed.id}`;
				const modelResult = await loadPage(modelApiUrl, { timeout, signal });

				if (modelResult.ok) {
					let model: HfModelData | null = null;
					try {
						model = JSON.parse(modelResult.content);
					} catch {
						// Fall through to user check
					}
					if (model) {
						const readmeUrl = `https://huggingface.co/${parsed.id}/raw/main/README.md`;
						const readmeResult = await loadPage(readmeUrl, { timeout: Math.min(timeout, 5), signal });

						let md = `# ${model.modelId}\n\n`;
						if (model.pipeline_tag) md += `**Task:** ${model.pipeline_tag}\n`;
						if (model.library_name) md += `**Library:** ${model.library_name}\n`;
						if (model.downloads !== undefined) md += `**Downloads:** ${formatCount(model.downloads)}\n`;
						if (model.likes !== undefined) md += `**Likes:** ${formatCount(model.likes)}\n`;
						if (model.tags?.length) md += `**Tags:** ${model.tags.join(", ")}\n`;
						md += "\n";
						if (readmeResult.ok && readmeResult.content.trim()) {
							md += `## Model Card\n\n${readmeResult.content}`;
						}

						const { content, truncated } = finalizeOutput(md);
						return {
							url,
							finalUrl: modelResult.finalUrl,
							contentType: "text/markdown",
							method: "huggingface",
							content,
							fetchedAt,
							truncated,
							notes,
						};
					}
				}

				// Fall back to user API
				const userApiUrl = `https://huggingface.co/api/users/${parsed.id}`;
				const userResult = await loadPage(userApiUrl, { timeout, signal });
				if (!userResult.ok) return null;

				let user: HfUserData;
				try {
					user = JSON.parse(userResult.content);
				} catch {
					return null;
				}

				let md = `# ${user.user || parsed.id}\n\n`;
				if (user.fullname) md += `**Name:** ${user.fullname}\n`;
				if (user.numModels !== undefined) md += `**Models:** ${formatCount(user.numModels)}\n`;
				if (user.numDatasets !== undefined) md += `**Datasets:** ${formatCount(user.numDatasets)}\n`;
				if (user.numSpaces !== undefined) md += `**Spaces:** ${formatCount(user.numSpaces)}\n`;

				if (user.orgs?.length) {
					md += `**Organizations:** ${user.orgs.map((o) => o.name).join(", ")}\n`;
				}

				const { content, truncated } = finalizeOutput(md);
				return {
					url,
					finalUrl: userResult.finalUrl,
					contentType: "text/markdown",
					method: "huggingface",
					content,
					fetchedAt,
					truncated,
					notes,
				};
			}

			default:
				return null;
		}
	} catch {
		return null;
	}
};
