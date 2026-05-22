import { getProjectRoot } from "../util/fs.js";
import { header, label, status, style } from "../util/theme.js";
import {
  DEFAULT_OPENAI_API_KEY_ENV,
  DEFAULT_OPENAI_IMAGE_MODEL,
  OpenAiImageClient,
  OpenAiImageError,
  resolveOpenAiApiKey,
  saveOpenAiImageResult,
  type EditImageOptions,
  type GenerateImageOptions,
  type OpenAiImageRequestOptions,
} from "../openai/image-client.js";

export interface ImageCommandOptions {
  json?: boolean;
  model?: string;
  size?: string;
  quality?: string;
  background?: string;
  outputFormat?: "png" | "jpeg" | "webp";
  n?: string | number;
  apiKeyEnv?: string;
  timeoutMs?: string | number;
  mask?: string;
}

export async function imageGenerateCommand(prompt: string, options: ImageCommandOptions = {}): Promise<void> {
  await runImageCommand("generate", prompt, undefined, options);
}

export async function imageEditCommand(
  imagePaths: string | string[],
  prompt: string,
  options: ImageCommandOptions = {}
): Promise<void> {
  const paths = Array.isArray(imagePaths) ? imagePaths : splitImagePaths(imagePaths);
  await runImageCommand("edit", prompt, paths, options);
}

export function createOpenAiImageClient(options: ImageCommandOptions = {}): OpenAiImageClient {
  return new OpenAiImageClient({
    apiKey: resolveOpenAiApiKey(process.env, options.apiKeyEnv ?? DEFAULT_OPENAI_API_KEY_ENV),
    timeoutMs: parsePositiveInt(options.timeoutMs, 120_000),
  });
}

async function runImageCommand(
  operation: "generate" | "edit",
  prompt: string,
  imagePaths: string[] | undefined,
  options: ImageCommandOptions
): Promise<void> {
  try {
    if (!prompt.trim()) {
      throw new OpenAiImageError("Image prompt is required.", {
        kind: "api",
        action: "Pass a non-empty prompt to the image command.",
      });
    }
    const root = getProjectRoot();
    const requestOptions = normalizeRequestOptions(options);
    const client = createOpenAiImageClient(options);
    const result = operation === "generate"
      ? await client.generate({ ...requestOptions, prompt } satisfies GenerateImageOptions)
      : await client.edit({
          ...requestOptions,
          prompt,
          imagePaths: imagePaths ?? [],
          maskPath: options.mask,
        } satisfies EditImageOptions);
    const saved = await saveOpenAiImageResult(root, result, requestOptions);

    const payload = {
      ok: true,
      operation,
      model: saved.model,
      imagePath: saved.relativeImagePath,
      metadataPath: saved.relativeMetadataPath,
      bytes: saved.image.length,
    };
    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    console.log(header("OpenAI image"));
    console.log(status.ok(`${operation === "generate" ? "Generated" : "Edited"} image saved`));
    console.log(label("Model", saved.model));
    console.log(label("Image", saved.relativeImagePath));
    console.log(label("Metadata", saved.relativeMetadataPath));
    console.log(style.gray("Metadata stores prompt hash/length only; API keys and raw prompts are not written."));
    console.log(style.gray(`One-shot key flow: unset ${options.apiKeyEnv ?? DEFAULT_OPENAI_API_KEY_ENV} and remove any decrypted temp key after this run.`));
  } catch (error) {
    handleImageCommandError(error, Boolean(options.json));
  }
}

function normalizeRequestOptions(options: ImageCommandOptions): OpenAiImageRequestOptions {
  return {
    model: options.model ?? DEFAULT_OPENAI_IMAGE_MODEL,
    size: options.size,
    quality: options.quality,
    background: options.background,
    outputFormat: options.outputFormat ?? "png",
    n: parsePositiveInt(options.n, 1),
  };
}

function handleImageCommandError(error: unknown, json: boolean): void {
  const mapped = error instanceof OpenAiImageError
    ? error
    : new OpenAiImageError(error instanceof Error ? error.message : String(error), {
        kind: "api",
        action: "Review the command inputs and retry.",
      });
  const payload = {
    ok: false,
    error: mapped.message,
    kind: mapped.kind,
    status: mapped.status,
    action: mapped.action,
  };
  if (json) {
    console.error(JSON.stringify(payload, null, 2));
  } else {
    console.error(status.error(mapped.message));
    console.error(style.gray(mapped.action));
  }
  process.exitCode = 1;
}

function splitImagePaths(value: string): string[] {
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function parsePositiveInt(value: string | number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
