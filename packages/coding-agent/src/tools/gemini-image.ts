import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringEnum } from "@oh-my-pi/pi-ai";
import { untilAborted } from "@oh-my-pi/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import { nanoid } from "nanoid";
import { renderPromptTemplate } from "$c/config/prompt-templates";
import type { CustomTool } from "$c/extensibility/custom-tools/types";
import geminiImageDescription from "$c/prompts/tools/gemini-image.md" with { type: "text" };
import { detectSupportedImageMimeTypeFromFile } from "$c/utils/mime";
import { getEnv } from "$c/web/search/auth";
import { resolveReadPath } from "./path-utils";

const DEFAULT_MODEL = "gemini-3-pro-image-preview";
const DEFAULT_OPENROUTER_MODEL = "google/gemini-3-pro-image-preview";
const DEFAULT_TIMEOUT_SECONDS = 120;
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;

type ImageProvider = "gemini" | "openrouter";
interface ImageApiKey {
	provider: ImageProvider;
	apiKey: string;
}

const responseModalitySchema = StringEnum(["Image", "Text"]);
const aspectRatioSchema = StringEnum(["1:1", "3:4", "4:3", "9:16", "16:9"], {
	description: "Aspect ratio (1:1, 3:4, 4:3, 9:16, 16:9).",
});
const imageSizeSchema = StringEnum(["1024x1024", "1536x1024", "1024x1536"], {
	description: "Image size, mainly for gemini-3-pro-image-preview.",
});

const inputImageSchema = Type.Object(
	{
		path: Type.Optional(Type.String({ description: "Path to an input image file." })),
		data: Type.Optional(Type.String({ description: "Base64 image data or a data: URL." })),
		mime_type: Type.Optional(Type.String({ description: "Required for raw base64 data." })),
	},
	{ additionalProperties: false },
);

const baseImageSchema = Type.Object(
	{
		subject: Type.String({
			description:
				"Main subject with key descriptors (e.g., 'A stoic robot barista with glowing blue optics', 'A weathered lighthouse on a rocky cliff').",
		}),
		action: Type.Optional(
			Type.String({
				description: "What the subject is doing (e.g., 'pouring latte art', 'standing against crashing waves').",
			}),
		),
		scene: Type.Optional(
			Type.String({
				description:
					"Location or environment (e.g., 'in a futuristic café on Mars', 'during a violent thunderstorm at dusk').",
			}),
		),
		composition: Type.Optional(
			Type.String({
				description:
					"Camera angle, framing, depth of field (e.g., 'low-angle close-up, shallow depth of field', 'wide establishing shot').",
			}),
		),
		lighting: Type.Optional(
			Type.String({
				description:
					"Lighting setup and mood (e.g., 'warm rim lighting', 'golden hour backlight', 'hard noon shadows').",
			}),
		),
		style: Type.Optional(
			Type.String({
				description:
					"Artistic style, mood, color grading (e.g., 'film noir mood, cinematic color grading', 'Studio Ghibli watercolor', 'photorealistic').",
			}),
		),
		camera: Type.Optional(
			Type.String({
				description:
					"Lens and camera specs (e.g., 'Shot on 35mm, f/1.8', 'macro lens, extreme close-up', '85mm portrait lens').",
			}),
		),
		text: Type.Optional(
			Type.String({
				description:
					"Text to render in image with specs: exact wording in quotes, font style, color, placement (e.g., 'Headline \"URBAN EXPLORER\" in bold white sans-serif at top center').",
			}),
		),
		changes: Type.Optional(
			Type.Array(Type.String(), {
				description:
					"For edits: specific changes to make (e.g., ['Change the tie to green', 'Remove the car in background']). Use with input_images.",
			}),
		),
		preserve: Type.Optional(
			Type.String({
				description:
					"For edits: what to keep unchanged (e.g., 'identity, face, hairstyle, lighting'). Use with input_images and changes.",
			}),
		),
		aspect_ratio: Type.Optional(aspectRatioSchema),
		image_size: Type.Optional(imageSizeSchema),
		input_images: Type.Optional(
			Type.Array(inputImageSchema, {
				description: "Optional input images for edits or variations.",
			}),
		),
		timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (default: 120)" })),
	},
	{ additionalProperties: false },
);

export const geminiImageSchema = baseImageSchema;
export type GeminiImageParams = Static<typeof geminiImageSchema>;
export type GeminiResponseModality = Static<typeof responseModalitySchema>;

/**
 * Assembles a structured prompt from the provided parameters.
 * For generation: builds "subject, action, scene. composition. lighting. camera. style."
 * For edits: appends change instructions and preserve directives.
 */
function assemblePrompt(params: GeminiImageParams): string {
	const parts: string[] = [];

	// Core subject line: subject + action + scene
	const subjectParts = [params.subject];
	if (params.action) subjectParts.push(params.action);
	if (params.scene) subjectParts.push(params.scene);
	parts.push(subjectParts.join(", "));

	// Technical details as separate sentences
	if (params.composition) parts.push(params.composition);
	if (params.lighting) parts.push(params.lighting);
	if (params.camera) parts.push(params.camera);
	if (params.style) parts.push(params.style);

	// Join with periods for sentence structure
	let prompt = `${parts.map((p) => p.replace(/[.!,;:]+$/, "")).join(". ")}.`;

	// Text rendering specs
	if (params.text) {
		prompt += `\n\nText: ${params.text}`;
	}

	// Edit mode: changes and preserve directives
	if (params.changes?.length) {
		prompt += `\n\nChanges:\n${params.changes.map((c) => `- ${c}`).join("\n")}`;
		if (params.preserve) {
			prompt += `\n\nPreserve: ${params.preserve}`;
		}
	}

	return prompt;
}

interface GeminiInlineData {
	data?: string;
	mimeType?: string;
}

interface GeminiPart {
	text?: string;
	inlineData?: GeminiInlineData;
}

interface GeminiCandidate {
	content?: { parts?: GeminiPart[] };
}

interface GeminiSafetyRating {
	category?: string;
	probability?: string;
}

interface GeminiPromptFeedback {
	blockReason?: string;
	safetyRatings?: GeminiSafetyRating[];
}

interface GeminiUsageMetadata {
	promptTokenCount?: number;
	candidatesTokenCount?: number;
	totalTokenCount?: number;
}

interface GeminiGenerateContentResponse {
	candidates?: GeminiCandidate[];
	promptFeedback?: GeminiPromptFeedback;
	usageMetadata?: GeminiUsageMetadata;
}

interface OpenRouterImageUrl {
	url: string;
}

interface OpenRouterContentPart {
	type: "text" | "image_url";
	text?: string;
	image_url?: OpenRouterImageUrl;
}

interface OpenRouterMessage {
	content?: string | OpenRouterContentPart[];
	images?: Array<string | { image_url?: OpenRouterImageUrl }>;
}

interface OpenRouterChoice {
	message?: OpenRouterMessage;
}

interface OpenRouterResponse {
	choices?: OpenRouterChoice[];
}

interface GeminiImageToolDetails {
	provider: ImageProvider;
	model: string;
	imageCount: number;
	imagePaths: string[];
	images: InlineImageData[];
	responseText?: string;
	promptFeedback?: GeminiPromptFeedback;
	usage?: GeminiUsageMetadata;
}

interface ImageInput {
	path?: string;
	data?: string;
	mime_type?: string;
}

interface InlineImageData {
	data: string;
	mimeType: string;
}

function normalizeDataUrl(data: string): { data: string; mimeType?: string } {
	const match = data.match(/^data:([^;]+);base64,(.+)$/);
	if (!match) return { data };
	return { data: match[2] ?? "", mimeType: match[1] };
}

function resolveOpenRouterModel(model: string): string {
	return model.includes("/") ? model : `google/${model}`;
}

function toDataUrl(image: InlineImageData): string {
	return `data:${image.mimeType};base64,${image.data}`;
}

async function loadImageFromUrl(imageUrl: string, signal?: AbortSignal): Promise<InlineImageData> {
	if (imageUrl.startsWith("data:")) {
		const normalized = normalizeDataUrl(imageUrl.trim());
		if (!normalized.mimeType) {
			throw new Error("mime_type is required when providing raw base64 data.");
		}
		if (!normalized.data) {
			throw new Error("Image data is empty.");
		}
		return { data: normalized.data, mimeType: normalized.mimeType };
	}

	const response = await fetch(imageUrl, { signal });
	if (!response.ok) {
		const rawText = await response.text();
		throw new Error(`Image download failed (${response.status}): ${rawText}`);
	}
	const contentType = response.headers.get("content-type")?.split(";")[0];
	if (!contentType || !contentType.startsWith("image/")) {
		throw new Error(`Unsupported image type from URL: ${imageUrl}`);
	}
	const buffer = Buffer.from(await response.arrayBuffer());
	return { data: buffer.toString("base64"), mimeType: contentType };
}

function collectOpenRouterResponseText(message: OpenRouterMessage | undefined): string | undefined {
	if (!message) return undefined;
	if (typeof message.content === "string") {
		const trimmed = message.content.trim();
		return trimmed.length > 0 ? trimmed : undefined;
	}
	if (Array.isArray(message.content)) {
		const texts = message.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.filter((text): text is string => Boolean(text));
		const combined = texts.join("\n").trim();
		return combined.length > 0 ? combined : undefined;
	}
	return undefined;
}

function extractOpenRouterImageUrls(message: OpenRouterMessage | undefined): string[] {
	const urls: string[] = [];
	if (!message) return urls;
	for (const image of message.images ?? []) {
		if (typeof image === "string") {
			urls.push(image);
			continue;
		}
		if (image.image_url?.url) {
			urls.push(image.image_url.url);
		}
	}
	if (Array.isArray(message.content)) {
		for (const part of message.content) {
			if (part.type === "image_url" && part.image_url?.url) {
				urls.push(part.image_url.url);
			}
		}
	}
	return urls;
}

/** Preferred provider set via settings (default: auto) */
let preferredImageProvider: ImageProvider | "auto" = "auto";

/** Set the preferred image provider from settings */
export function setPreferredImageProvider(provider: ImageProvider | "auto"): void {
	preferredImageProvider = provider;
}

async function findImageApiKey(): Promise<ImageApiKey | null> {
	// If a specific provider is preferred, try it first
	if (preferredImageProvider === "gemini") {
		const geminiKey = await getEnv("GEMINI_API_KEY");
		if (geminiKey) return { provider: "gemini", apiKey: geminiKey };
		const googleKey = await getEnv("GOOGLE_API_KEY");
		if (googleKey) return { provider: "gemini", apiKey: googleKey };
		// Fall through to auto-detect if preferred provider key not found
	} else if (preferredImageProvider === "openrouter") {
		const openRouterKey = await getEnv("OPENROUTER_API_KEY");
		if (openRouterKey) return { provider: "openrouter", apiKey: openRouterKey };
		// Fall through to auto-detect if preferred provider key not found
	}

	// Auto-detect: OpenRouter takes priority
	const openRouterKey = await getEnv("OPENROUTER_API_KEY");
	if (openRouterKey) return { provider: "openrouter", apiKey: openRouterKey };

	const geminiKey = await getEnv("GEMINI_API_KEY");
	if (geminiKey) return { provider: "gemini", apiKey: geminiKey };

	const googleKey = await getEnv("GOOGLE_API_KEY");
	if (googleKey) return { provider: "gemini", apiKey: googleKey };

	return null;
}

async function loadImageFromPath(imagePath: string, cwd: string): Promise<InlineImageData> {
	const resolved = resolveReadPath(imagePath, cwd);
	const file = Bun.file(resolved);
	if (!(await file.exists())) {
		throw new Error(`Image file not found: ${imagePath}`);
	}
	if (file.size > MAX_IMAGE_SIZE) {
		throw new Error(`Image file too large: ${imagePath}`);
	}

	const mimeType = await detectSupportedImageMimeTypeFromFile(resolved);
	if (!mimeType) {
		throw new Error(`Unsupported image type: ${imagePath}`);
	}

	const buffer = Buffer.from(await file.arrayBuffer());
	return { data: buffer.toString("base64"), mimeType };
}

async function resolveInputImage(input: ImageInput, cwd: string): Promise<InlineImageData> {
	if (input.path) {
		return loadImageFromPath(input.path, cwd);
	}

	if (input.data) {
		const normalized = normalizeDataUrl(input.data.trim());
		const mimeType = normalized.mimeType ?? input.mime_type;
		if (!mimeType) {
			throw new Error("mime_type is required when providing raw base64 data.");
		}
		if (!normalized.data) {
			throw new Error("Image data is empty.");
		}
		return { data: normalized.data, mimeType };
	}

	throw new Error("input_images entries must include either path or data.");
}

function getExtensionForMime(mimeType: string): string {
	const map: Record<string, string> = {
		"image/png": "png",
		"image/jpeg": "jpg",
		"image/gif": "gif",
		"image/webp": "webp",
	};
	return map[mimeType] ?? "png";
}

async function saveImageToTemp(image: InlineImageData): Promise<string> {
	const ext = getExtensionForMime(image.mimeType);
	const filename = `omp-image-${nanoid()}.${ext}`;
	const filepath = join(tmpdir(), filename);
	await Bun.write(filepath, Buffer.from(image.data, "base64"));
	return filepath;
}

async function saveImagesToTemp(images: InlineImageData[]): Promise<string[]> {
	return Promise.all(images.map(saveImageToTemp));
}

function buildResponseSummary(model: string, imagePaths: string[], responseText: string | undefined): string {
	const lines = [`Model: ${model}`, `Generated ${imagePaths.length} image(s):`];
	for (const p of imagePaths) {
		lines.push(`  ${p}`);
	}
	if (responseText) {
		lines.push("", responseText.trim());
	}
	return lines.join("\n");
}

function collectResponseText(parts: GeminiPart[]): string | undefined {
	const texts = parts.map((part) => part.text).filter((text): text is string => Boolean(text));
	const combined = texts.join("\n").trim();
	return combined.length > 0 ? combined : undefined;
}

function collectInlineImages(parts: GeminiPart[]): InlineImageData[] {
	const images: InlineImageData[] = [];
	for (const part of parts) {
		const data = part.inlineData?.data;
		const mimeType = part.inlineData?.mimeType;
		if (!data || !mimeType) continue;
		images.push({ data, mimeType });
	}
	return images;
}

function combineParts(response: GeminiGenerateContentResponse): GeminiPart[] {
	const parts: GeminiPart[] = [];
	for (const candidate of response.candidates ?? []) {
		const candidateParts = candidate.content?.parts ?? [];
		parts.push(...candidateParts);
	}
	return parts;
}

function createRequestSignal(signal: AbortSignal | undefined, timeoutSeconds: number): AbortSignal {
	const timeoutSignal = AbortSignal.timeout(timeoutSeconds * 1000);
	return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

export const geminiImageTool: CustomTool<typeof geminiImageSchema, GeminiImageToolDetails> = {
	name: "generate_image",
	label: "GenerateImage",
	description: renderPromptTemplate(geminiImageDescription),
	parameters: geminiImageSchema,
	async execute(_toolCallId, params, _onUpdate, ctx, signal) {
		return untilAborted(signal, async () => {
			const apiKey = await findImageApiKey();
			if (!apiKey) {
				throw new Error("OPENROUTER_API_KEY, GEMINI_API_KEY, or GOOGLE_API_KEY not found.");
			}

			const provider = apiKey.provider;
			const model = provider === "openrouter" ? DEFAULT_OPENROUTER_MODEL : DEFAULT_MODEL;
			const resolvedModel = provider === "openrouter" ? resolveOpenRouterModel(model) : model;
			const cwd = ctx.sessionManager.getCwd();

			const resolvedImages: InlineImageData[] = [];
			if (params.input_images?.length) {
				for (const input of params.input_images) {
					resolvedImages.push(await resolveInputImage(input, cwd));
				}
			}

			const { timeout: rawTimeout = DEFAULT_TIMEOUT_SECONDS } = params;
			// Auto-convert milliseconds to seconds if value > 1000 (16+ min is unreasonable)
			let timeoutSeconds = rawTimeout > 1000 ? rawTimeout / 1000 : rawTimeout;
			// Clamp to reasonable range: 1s - 600s (10 min)
			timeoutSeconds = Math.max(1, Math.min(600, timeoutSeconds));
			const requestSignal = createRequestSignal(signal, timeoutSeconds);

			if (provider === "openrouter") {
				const prompt = assemblePrompt(params);
				const contentParts: OpenRouterContentPart[] = [{ type: "text", text: prompt }];
				for (const image of resolvedImages) {
					contentParts.push({ type: "image_url", image_url: { url: toDataUrl(image) } });
				}

				const requestBody = {
					model: resolvedModel,
					messages: [{ role: "user" as const, content: contentParts }],
				};

				const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${apiKey.apiKey}`,
					},
					body: JSON.stringify(requestBody),
					signal: requestSignal,
				});

				const rawText = await response.text();
				if (!response.ok) {
					let message = rawText;
					try {
						const parsed = JSON.parse(rawText) as { error?: { message?: string } };
						message = parsed.error?.message ?? message;
					} catch {
						// Keep raw text.
					}
					throw new Error(`OpenRouter image request failed (${response.status}): ${message}`);
				}

				const data = JSON.parse(rawText) as OpenRouterResponse;
				const message = data.choices?.[0]?.message;
				const responseText = collectOpenRouterResponseText(message);
				const imageUrls = extractOpenRouterImageUrls(message);
				const inlineImages: InlineImageData[] = [];
				for (const imageUrl of imageUrls) {
					inlineImages.push(await loadImageFromUrl(imageUrl, requestSignal));
				}

				if (inlineImages.length === 0) {
					const messageText = responseText ? `\n\n${responseText}` : "";
					return {
						content: [{ type: "text", text: `No image data returned.${messageText}` }],
						details: {
							provider,
							model: resolvedModel,
							imageCount: 0,
							imagePaths: [],
							images: [],
							responseText,
						},
					};
				}

				const imagePaths = await saveImagesToTemp(inlineImages);

				return {
					content: [{ type: "text", text: buildResponseSummary(resolvedModel, imagePaths, responseText) }],
					details: {
						provider,
						model: resolvedModel,
						imageCount: inlineImages.length,
						imagePaths,
						images: inlineImages,
						responseText,
					},
				};
			}

			const parts = [] as Array<{ text?: string; inlineData?: InlineImageData }>;
			for (const image of resolvedImages) {
				parts.push({ inlineData: image });
			}
			parts.push({ text: assemblePrompt(params) });

			const generationConfig: {
				responseModalities: GeminiResponseModality[];
				imageConfig?: { aspectRatio?: string; imageSize?: string };
			} = {
				responseModalities: ["Image"],
			};

			if (params.aspect_ratio || params.image_size) {
				generationConfig.imageConfig = {
					aspectRatio: params.aspect_ratio,
					imageSize: params.image_size,
				};
			}

			const requestBody = {
				contents: [{ role: "user" as const, parts }],
				generationConfig,
			};

			const response = await fetch(
				`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-goog-api-key": apiKey.apiKey,
					},
					body: JSON.stringify(requestBody),
					signal: requestSignal,
				},
			);

			const rawText = await response.text();
			if (!response.ok) {
				let message = rawText;
				try {
					const parsed = JSON.parse(rawText) as { error?: { message?: string } };
					message = parsed.error?.message ?? message;
				} catch {
					// Keep raw text.
				}
				throw new Error(`Gemini image request failed (${response.status}): ${message}`);
			}

			const data = JSON.parse(rawText) as GeminiGenerateContentResponse;
			const responseParts = combineParts(data);
			const responseText = collectResponseText(responseParts);
			const inlineImages = collectInlineImages(responseParts);

			if (inlineImages.length === 0) {
				const blocked = data.promptFeedback?.blockReason
					? `Blocked: ${data.promptFeedback.blockReason}`
					: "No image data returned.";
				return {
					content: [{ type: "text", text: `${blocked}${responseText ? `\n\n${responseText}` : ""}` }],
					details: {
						provider,
						model,
						imageCount: 0,
						imagePaths: [],
						images: [],
						responseText,
						promptFeedback: data.promptFeedback,
						usage: data.usageMetadata,
					},
				};
			}

			const imagePaths = await saveImagesToTemp(inlineImages);

			return {
				content: [{ type: "text", text: buildResponseSummary(model, imagePaths, responseText) }],
				details: {
					provider,
					model,
					imageCount: inlineImages.length,
					imagePaths,
					images: inlineImages,
					responseText,
					promptFeedback: data.promptFeedback,
					usage: data.usageMetadata,
				},
			};
		});
	},
};

export async function getGeminiImageTools(): Promise<
	Array<CustomTool<typeof geminiImageSchema, GeminiImageToolDetails>>
> {
	const apiKey = await findImageApiKey();
	if (!apiKey) return [];
	return [geminiImageTool];
}
