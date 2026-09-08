import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { clipboard } from "./clipboard-native.ts";
import { loadPhoton } from "./photon.ts";
import { readWindowsClipboardImage, WindowsClipboardError } from "./windows-clipboard-image.ts";

export type ClipboardImage = {
	bytes: Uint8Array;
	mimeType: string;
};

const SUPPORTED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

const DEFAULT_LIST_TIMEOUT_MS = 1000;
const DEFAULT_READ_TIMEOUT_MS = 3000;
const DEFAULT_MAX_BUFFER_BYTES = 50 * 1024 * 1024;

export function isWaylandSession(env: NodeJS.ProcessEnv = process.env): boolean {
	return Boolean(env.WAYLAND_DISPLAY) || env.XDG_SESSION_TYPE === "wayland";
}

function baseMimeType(mimeType: string): string {
	return mimeType.split(";")[0]?.trim().toLowerCase() ?? mimeType.toLowerCase();
}

export function extensionForImageMimeType(mimeType: string): string | null {
	switch (baseMimeType(mimeType)) {
		case "image/png":
			return "png";
		case "image/jpeg":
			return "jpg";
		case "image/webp":
			return "webp";
		case "image/gif":
			return "gif";
		default:
			return null;
	}
}

function selectPreferredImageMimeType(mimeTypes: string[]): string | null {
	const normalized = mimeTypes
		.map((t) => t.trim())
		.filter(Boolean)
		.map((t) => ({ raw: t, base: baseMimeType(t) }));

	for (const preferred of SUPPORTED_IMAGE_MIME_TYPES) {
		const match = normalized.find((t) => t.base === preferred);
		if (match) {
			return match.raw;
		}
	}

	const anyImage = normalized.find((t) => t.base.startsWith("image/"));
	return anyImage?.raw ?? null;
}

function isSupportedImageMimeType(mimeType: string): boolean {
	const base = baseMimeType(mimeType);
	return SUPPORTED_IMAGE_MIME_TYPES.some((t) => t === base);
}

/**
 * Convert unsupported image formats to PNG using Photon.
 * Returns null if conversion is unavailable or fails.
 */
async function convertToPng(bytes: Uint8Array): Promise<Uint8Array | null> {
	const photon = await loadPhoton();
	if (!photon) {
		return null;
	}

	try {
		const image = photon.PhotonImage.new_from_byteslice(bytes);
		try {
			return image.get_bytes();
		} finally {
			image.free();
		}
	} catch {
		return null;
	}
}

function runCommand(
	command: string,
	args: string[],
	options?: { timeoutMs?: number; maxBufferBytes?: number; env?: NodeJS.ProcessEnv },
): { stdout: Buffer; ok: boolean } {
	const timeoutMs = options?.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
	const maxBufferBytes = options?.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;

	const result = spawnSync(command, args, {
		timeout: timeoutMs,
		maxBuffer: maxBufferBytes,
		env: options?.env,
	});

	if (result.error) {
		return { ok: false, stdout: Buffer.alloc(0) };
	}

	if (result.status !== 0) {
		return { ok: false, stdout: Buffer.alloc(0) };
	}

	if (Buffer.isBuffer(result.stdout)) {
		return { ok: true, stdout: result.stdout };
	}

	const encoding = typeof result.stdout === "string" ? "utf-8" : undefined;
	return { ok: true, stdout: Buffer.from(result.stdout ?? "", encoding) };
}

function readClipboardImageViaWlPaste(): ClipboardImage | null {
	const list = runCommand("wl-paste", ["--list-types"], { timeoutMs: DEFAULT_LIST_TIMEOUT_MS });
	if (!list.ok) {
		return null;
	}

	const types = list.stdout
		.toString("utf-8")
		.split(/\r?\n/)
		.map((t) => t.trim())
		.filter(Boolean);

	const selectedType = selectPreferredImageMimeType(types);
	if (!selectedType) {
		return null;
	}

	const data = runCommand("wl-paste", ["--type", selectedType, "--no-newline"]);
	if (!data.ok || data.stdout.length === 0) {
		return null;
	}

	return { bytes: data.stdout, mimeType: baseMimeType(selectedType) };
}

function isWSL(env: NodeJS.ProcessEnv = process.env, inspectProcVersion = true): boolean {
	if (env.WSL_DISTRO_NAME || env.WSLENV) {
		return true;
	}

	if (!inspectProcVersion) {
		return false;
	}

	try {
		const release = readFileSync("/proc/version", "utf-8");
		return /microsoft|wsl/i.test(release);
	} catch {
		return false;
	}
}

function readClipboardImageViaXclip(): ClipboardImage | null {
	const targets = runCommand("xclip", ["-selection", "clipboard", "-t", "TARGETS", "-o"], {
		timeoutMs: DEFAULT_LIST_TIMEOUT_MS,
	});

	let candidateTypes: string[] = [];
	if (targets.ok) {
		candidateTypes = targets.stdout
			.toString("utf-8")
			.split(/\r?\n/)
			.map((t) => t.trim())
			.filter(Boolean);
	}

	const preferred = candidateTypes.length > 0 ? selectPreferredImageMimeType(candidateTypes) : null;
	const tryTypes = preferred ? [preferred, ...SUPPORTED_IMAGE_MIME_TYPES] : [...SUPPORTED_IMAGE_MIME_TYPES];

	for (const mimeType of tryTypes) {
		const data = runCommand("xclip", ["-selection", "clipboard", "-t", mimeType, "-o"]);
		if (data.ok && data.stdout.length > 0) {
			return { bytes: data.stdout, mimeType: baseMimeType(mimeType) };
		}
	}

	return null;
}

async function readClipboardImageViaNativeClipboard(): Promise<ClipboardImage | null> {
	if (!clipboard || !clipboard.hasImage()) {
		return null;
	}

	const imageData = await clipboard.getImageBinary();
	if (!imageData || imageData.length === 0) {
		return null;
	}

	const bytes = imageData instanceof Uint8Array ? imageData : Uint8Array.from(imageData);
	return { bytes, mimeType: "image/png" };
}

/**
 * Normalize one source's read into a supported format, or reject that read.
 *
 * Applied per source rather than once after the chain, because a source can
 * succeed at reading bytes yet still be unusable: WSLg publishes a Windows
 * screenshot as `image/bmp`, which needs conversion. Folding the conversion
 * into the source attempt keeps an unconvertible read from disqualifying the
 * sources behind it — notably the PowerShell reader, which returns PNG
 * directly and needs no converter at all.
 */
async function toSupportedImage(image: ClipboardImage | null): Promise<ClipboardImage | null> {
	if (!image) {
		return null;
	}
	if (isSupportedImageMimeType(image.mimeType)) {
		return image;
	}
	const pngBytes = await convertToPng(image.bytes);
	return pngBytes ? { bytes: pngBytes, mimeType: "image/png" } : null;
}

export async function readClipboardImage(options?: {
	env?: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform;
}): Promise<ClipboardImage | null> {
	const env = options?.env ?? process.env;
	const platform = options?.platform ?? process.platform;
	const hasExplicitEnv = options?.env !== undefined;

	if (env.TERMUX_VERSION) {
		return null;
	}

	if (platform !== "linux") {
		return toSupportedImage(await readClipboardImageViaNativeClipboard());
	}

	const wsl = isWSL(env, !hasExplicitEnv);
	const windows = wsl ? await readWindowsClipboardImage(env) : undefined;
	if (windows?.kind === "image") return { bytes: windows.bytes, mimeType: windows.mimeType };
	if (windows?.kind === "empty") return null;
	const wayland = isWaylandSession(env);
	let image: ClipboardImage | null = null;

	if (wayland || wsl) {
		image = await toSupportedImage(readClipboardImageViaWlPaste());
		image ??= await toSupportedImage(readClipboardImageViaXclip());
	}

	if (!image && !wayland) {
		image = await toSupportedImage(await readClipboardImageViaNativeClipboard());
	}

	if (!image && windows?.kind === "unavailable") {
		throw new WindowsClipboardError(
			`Windows clipboard unavailable (${windows.reason}). Check WSL interop and Windows PowerShell, or drop an image file.`,
		);
	}
	return image;
}
