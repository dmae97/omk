import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { basename, extname, join, relative } from "path";
import { Blob } from "buffer";

export const DEFAULT_OPENAI_IMAGE_MODEL = "gpt-image-2";
export const DEFAULT_OPENAI_IMAGES_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_OPENAI_API_KEY_ENV = "OPENAI_API_KEY";
export const OPENAI_IMAGE_API_KEY_ACTION =
  "Use an OpenAI Platform project API key: create it through Platform OAuth, keep any encrypted copy outside the repo, decrypt only locally, run one command with OPENAI_API_KEY=<ephemeral>, then unset the env/temp key. Codex/ChatGPT OAuth tokens are only for login and cannot call the Images API.";

export type OpenAiImageOperation = "generate" | "edit";
export type OpenAiImageErrorKind =
  | "auth"
  | "permission"
  | "billing"
  | "rate_limit"
  | "moderation"
  | "api"
  | "network"
  | "invalid_response";
export type OpenAiImageFetch = typeof fetch;

export interface OpenAiImageClientOptions {
  apiKey: string;
  fetch?: OpenAiImageFetch;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface OpenAiImageRequestOptions {
  model?: string;
  size?: string;
  quality?: string;
  background?: string;
  outputFormat?: "png" | "jpeg" | "webp";
  n?: number;
  user?: string;
}

export interface GenerateImageOptions extends OpenAiImageRequestOptions {
  prompt: string;
}

export interface EditImageOptions extends OpenAiImageRequestOptions {
  prompt: string;
  imagePaths: string[];
  maskPath?: string;
}

export interface OpenAiImageResult {
  operation: OpenAiImageOperation;
  model: string;
  image: Buffer;
  mimeType: string;
  outputFormat: "png" | "jpeg" | "webp";
  created?: number;
  usage?: unknown;
  promptHash: string;
  promptLength: number;
  imageCount?: number;
  maskProvided?: boolean;
}

export interface SavedOpenAiImageResult extends OpenAiImageResult {
  imagePath: string;
  metadataPath: string;
  relativeImagePath: string;
  relativeMetadataPath: string;
}

export interface OpenAiImageMetadata {
  createdAt: string;
  operation: OpenAiImageOperation;
  provider: "openai";
  model: string;
  output: {
    path: string;
    mimeType: string;
    bytes: number;
  };
  request: {
    promptSha256: string;
    promptLength: number;
    size?: string;
    quality?: string;
    background?: string;
    outputFormat: string;
    n: number;
    imageCount?: number;
    maskProvided?: boolean;
  };
  response: {
    created?: number;
    usage?: unknown;
  };
}

export class OpenAiImageError extends Error {
  readonly kind: OpenAiImageErrorKind;
  readonly status?: number;
  readonly action: string;

  constructor(message: string, options: { kind: OpenAiImageErrorKind; action: string; status?: number }) {
    super(message);
    this.name = "OpenAiImageError";
    this.kind = options.kind;
    this.status = options.status;
    this.action = options.action;
  }
}

interface ImageApiResponse {
  created?: number;
  data?: Array<{ b64_json?: string; url?: string }>;
  output_format?: "png" | "jpeg" | "webp";
  usage?: unknown;
}

export class OpenAiImageClient {
  private readonly apiKey: string;
  private readonly fetchImpl: OpenAiImageFetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: OpenAiImageClientOptions) {
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? fetch;
    this.baseUrl = (options.baseUrl ?? DEFAULT_OPENAI_IMAGES_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async generate(options: GenerateImageOptions): Promise<OpenAiImageResult> {
    const model = options.model ?? DEFAULT_OPENAI_IMAGE_MODEL;
    const body = compactRecord({
      model,
      prompt: options.prompt,
      n: options.n ?? 1,
      size: options.size,
      quality: options.quality,
      background: options.background,
      output_format: options.outputFormat ?? "png",
      user: options.user,
    });
    const response = await this.requestJson("/images/generations", body);
    return this.toImageResult("generate", response, {
      model,
      prompt: options.prompt,
      outputFormat: options.outputFormat ?? "png",
    });
  }

  async edit(options: EditImageOptions): Promise<OpenAiImageResult> {
    const model = options.model ?? DEFAULT_OPENAI_IMAGE_MODEL;
    if (options.imagePaths.length === 0) {
      throw new OpenAiImageError("At least one source image is required for image edits.", {
        kind: "api",
        action: "Pass one or more image paths to `omk image edit`.",
      });
    }

    const form = new FormData();
    form.set("model", model);
    form.set("prompt", options.prompt);
    form.set("n", String(options.n ?? 1));
    form.set("output_format", options.outputFormat ?? "png");
    appendOptionalFormValue(form, "size", options.size);
    appendOptionalFormValue(form, "quality", options.quality);
    appendOptionalFormValue(form, "background", options.background);
    appendOptionalFormValue(form, "user", options.user);

    for (const imagePath of options.imagePaths) {
      const blob = await readImageBlob(imagePath);
      form.append("image", blob, basename(imagePath));
    }
    if (options.maskPath) {
      const mask = await readImageBlob(options.maskPath);
      form.set("mask", mask, basename(options.maskPath));
    }

    const response = await this.requestForm("/images/edits", form);
    return this.toImageResult("edit", response, {
      model,
      prompt: options.prompt,
      outputFormat: options.outputFormat ?? "png",
      imageCount: options.imagePaths.length,
      maskProvided: Boolean(options.maskPath),
    });
  }

  private async requestJson(path: string, body: Record<string, unknown>): Promise<ImageApiResponse> {
    return this.request(path, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  private async requestForm(path: string, body: FormData): Promise<ImageApiResponse> {
    return this.request(path, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
      },
      body,
    });
  }

  private async request(path: string, init: RequestInit): Promise<ImageApiResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
      const body = await parseResponseBody(response);
      if (!response.ok) {
        throw mapOpenAiError(response.status, body);
      }
      if (!isRecord(body)) {
        throw new OpenAiImageError("OpenAI Images API returned a non-object response.", {
          kind: "invalid_response",
          action: "Retry the request; if it repeats, capture `--json` output and report the response shape without secrets.",
        });
      }
      return body as ImageApiResponse;
    } catch (error) {
      if (error instanceof OpenAiImageError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new OpenAiImageError("OpenAI Images API request timed out.", {
          kind: "network",
          action: "Retry with a smaller image or increase the timeout option when wiring the CLI.",
        });
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new OpenAiImageError(`OpenAI Images API request failed: ${redactSensitiveText(message)}`, {
        kind: "network",
        action: "Check network connectivity and the OpenAI API status page, then retry.",
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async toImageResult(
    operation: OpenAiImageOperation,
    response: ImageApiResponse,
    context: {
      model: string;
      prompt: string;
      outputFormat: "png" | "jpeg" | "webp";
      imageCount?: number;
      maskProvided?: boolean;
    }
  ): Promise<OpenAiImageResult> {
    const first = response.data?.[0];
    if (!first) {
      throw new OpenAiImageError("OpenAI Images API returned no image data.", {
        kind: "invalid_response",
        action: "Retry the request; if it repeats, verify the selected model supports the Images API.",
      });
    }

    const image = first.b64_json
      ? Buffer.from(first.b64_json, "base64")
      : first.url
        ? await this.downloadImage(first.url)
        : undefined;

    if (!image || image.length === 0) {
      throw new OpenAiImageError("OpenAI Images API returned an empty image payload.", {
        kind: "invalid_response",
        action: "Retry the request; if it repeats, inspect the model and output format options.",
      });
    }

    const outputFormat = response.output_format ?? context.outputFormat;
    return {
      operation,
      model: context.model,
      image,
      mimeType: mimeTypeForOutputFormat(outputFormat),
      outputFormat,
      created: response.created,
      usage: response.usage,
      promptHash: sha256(context.prompt),
      promptLength: context.prompt.length,
      imageCount: context.imageCount,
      maskProvided: context.maskProvided,
    };
  }

  private async downloadImage(url: string): Promise<Buffer> {
    const response = await this.fetchImpl(url, { method: "GET", signal: AbortSignal.timeout(this.timeoutMs) });
    if (!response.ok) {
      throw new OpenAiImageError(`OpenAI image download failed (${response.status}).`, {
        kind: "api",
        status: response.status,
        action: "Retry the request; generated image URLs can expire quickly.",
      });
    }
    return Buffer.from(await response.arrayBuffer());
  }
}

export function resolveOpenAiApiKey(env: NodeJS.ProcessEnv = process.env, envName = DEFAULT_OPENAI_API_KEY_ENV): string {
  const credential = env[envName]?.trim();
  if (!credential) {
    throw new OpenAiImageError(`OpenAI API key is missing from ${envName}.`, {
      kind: "auth",
      action: `${OPENAI_IMAGE_API_KEY_ACTION} Set ${envName} only in the runtime environment for this command; OMK does not store it.`,
    });
  }
  if (!isOpenAiPlatformApiKey(credential)) {
    const issue = isLikelyOpenAiOAuthCredential(credential)
      ? "the value looks like a Codex/ChatGPT OAuth or session token"
      : "the value does not look like an OpenAI Platform API key";
    throw new OpenAiImageError(`OpenAI Images API requires an OpenAI Platform project API key in ${envName}; ${issue}.`, {
      kind: "auth",
      action: OPENAI_IMAGE_API_KEY_ACTION,
    });
  }
  return credential;
}

export function isOpenAiPlatformApiKey(credential: string): boolean {
  const value = credential.trim();
  return /^sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{8,}$/.test(value);
}

export function isLikelyOpenAiOAuthCredential(credential: string): boolean {
  const value = credential.trim();
  return /^Bearer\s+/i.test(value)
    || /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(value)
    || /^(?:oauth|acct|codex|chatgpt):/i.test(value)
    || /^(?:sess|oai)-[A-Za-z0-9_-]+/i.test(value)
    || /^(?:access|refresh)[_-]?token[:=]/i.test(value);
}

export async function saveOpenAiImageResult(
  root: string,
  result: OpenAiImageResult,
  options: OpenAiImageRequestOptions = {},
  now: Date = new Date()
): Promise<SavedOpenAiImageResult> {
  const dir = join(root, ".omk", "images");
  await mkdir(dir, { recursive: true });
  const stem = safeTimestamp(now);
  const imagePath = join(dir, `${stem}.${result.outputFormat}`);
  const metadataPath = join(dir, `${stem}.json`);
  const relativeImagePath = relative(root, imagePath);
  const relativeMetadataPath = relative(root, metadataPath);

  await writeFile(imagePath, result.image);
  const metadata: OpenAiImageMetadata = {
    createdAt: now.toISOString(),
    operation: result.operation,
    provider: "openai",
    model: result.model,
    output: {
      path: relativeImagePath,
      mimeType: result.mimeType,
      bytes: result.image.length,
    },
    request: {
      promptSha256: result.promptHash,
      promptLength: result.promptLength,
      size: options.size,
      quality: options.quality,
      background: options.background,
      outputFormat: result.outputFormat,
      n: options.n ?? 1,
      imageCount: result.imageCount,
      maskProvided: result.maskProvided,
    },
    response: {
      created: result.created,
      usage: result.usage,
    },
  };
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");

  return {
    ...result,
    imagePath,
    metadataPath,
    relativeImagePath,
    relativeMetadataPath,
  };
}

function appendOptionalFormValue(form: FormData, name: string, value: string | undefined): void {
  if (value !== undefined && value !== "") form.set(name, value);
}

async function readImageBlob(filePath: string): Promise<Blob> {
  const bytes = await readFile(filePath);
  return new Blob([bytes], { type: mimeTypeForPath(filePath) });
}

function mimeTypeForPath(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

function mimeTypeForOutputFormat(format: "png" | "jpeg" | "webp"): string {
  if (format === "jpeg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function mapOpenAiError(status: number, body: unknown): OpenAiImageError {
  const message = summarizeOpenAiError(body) || `OpenAI Images API request failed (${status}).`;
  const lower = message.toLowerCase();
  if (lower.includes("content_policy") || lower.includes("moderation") || lower.includes("safety")) {
    return new OpenAiImageError(redactSensitiveText(message), {
      kind: "moderation",
      status,
      action: "Revise the prompt or input image to satisfy OpenAI image safety policy, then retry.",
    });
  }
  if (status === 401) {
    return new OpenAiImageError(redactSensitiveText(message), {
      kind: "auth",
      status,
      action: `${OPENAI_IMAGE_API_KEY_ACTION} Check the configured API-key environment variable; OMK reads it only from runtime env and never stores it.`,
    });
  }
  if (status === 403) {
    return new OpenAiImageError(redactSensitiveText(message), {
      kind: "permission",
      status,
      action: "Check project permissions, API tier/model access, organization policy, and whether Images API access is enabled for this key.",
    });
  }
  if (status === 429) {
    return new OpenAiImageError(redactSensitiveText(message), {
      kind: lower.includes("quota") || lower.includes("billing") ? "billing" : "rate_limit",
      status,
      action: lower.includes("quota") || lower.includes("billing")
        ? "Check OpenAI billing, project quota, and usage limits before retrying."
        : "Wait, then retry with lower concurrency or smaller images.",
    });
  }
  if (status === 402 || lower.includes("billing") || lower.includes("insufficient_quota") || lower.includes("quota")) {
    return new OpenAiImageError(redactSensitiveText(message), {
      kind: "billing",
      status,
      action: "Check OpenAI billing status, project quota, and monthly usage limits, then retry.",
    });
  }
  return new OpenAiImageError(redactSensitiveText(message), {
    kind: "api",
    status,
    action: "Verify prompt, input image constraints, selected model, and output options, then retry.",
  });
}

function summarizeOpenAiError(body: unknown): string {
  if (typeof body === "string") return body.slice(0, 800);
  if (!isRecord(body)) return "";
  const error = body.error;
  if (isRecord(error)) {
    const message = typeof error.message === "string" ? error.message : "";
    const code = typeof error.code === "string" ? error.code : "";
    const type = typeof error.type === "string" ? error.type : "";
    return [message, code, type].filter(Boolean).join(" ").slice(0, 800);
  }
  const message = typeof body.message === "string" ? body.message : "";
  return message.slice(0, 800);
}

function compactRecord(values: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(values).filter(([, value]) => value !== undefined && value !== "");
  return Object.fromEntries(entries);
}

function safeTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted-openai-key]")
    .replace(/\bBearer\s+[^\s"',;]+/gi, "Bearer [redacted-oauth-token]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?\b/g, "[redacted-oauth-token]")
    .replace(/\b(?:oauth|acct|codex|chatgpt):[^\s"',;]+/gi, "[redacted-oauth-token]")
    .replace(/\b(?:sess|oai)-[^\s"',;]+/gi, "[redacted-oauth-token]")
    .replace(/\b((?:access|refresh)[_-]?token[:=])[^\s"',;]+/gi, "$1[redacted-oauth-token]");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
