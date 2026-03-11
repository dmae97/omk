import * as fs from "node:fs/promises";
import { formatBytes } from "@oh-my-pi/pi-utils";
import { resolveReadPath } from "../tools/path-utils";
import { formatDimensionNote, resizeImage } from "./image-resize";
import { detectSupportedImageMimeTypeFromFile } from "./mime";

export const MAX_IMAGE_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_METADATA_HEADER_BYTES = 256 * 1024;

export interface ImageMetadata {
	mimeType: string;
	bytes: number;
	width?: number;
	height?: number;
	channels?: number;
	hasAlpha?: boolean;
}

export interface LoadedImageInput {
	resolvedPath: string;
	mimeType: string;
	data: string;
	textNote: string;
	dimensionNote?: string;
	bytes: number;
}

export interface ReadImageMetadataOptions {
	path: string;
	cwd: string;
	resolvedPath?: string;
	detectedMimeType?: string;
}

export interface LoadImageInputOptions extends ReadImageMetadataOptions {
	autoResize: boolean;
	maxBytes?: number;
}

export class ImageInputTooLargeError extends Error {
	readonly bytes: number;
	readonly maxBytes: number;

	constructor(bytes: number, maxBytes: number) {
		super(`Image file too large: ${formatBytes(bytes)} exceeds ${formatBytes(maxBytes)} limit.`);
		this.name = "ImageInputTooLargeError";
		this.bytes = bytes;
		this.maxBytes = maxBytes;
	}
}

interface ParsedImageHeaderMetadata {
	width?: number;
	height?: number;
	channels?: number;
	hasAlpha?: boolean;
}

function parsePngMetadata(header: Buffer): ParsedImageHeaderMetadata {
	if (header.length < 26) return {};
	if (
		header[0] !== 0x89 ||
		header[1] !== 0x50 ||
		header[2] !== 0x4e ||
		header[3] !== 0x47 ||
		header[4] !== 0x0d ||
		header[5] !== 0x0a ||
		header[6] !== 0x1a ||
		header[7] !== 0x0a
	) {
		return {};
	}
	if (header.slice(12, 16).toString("ascii") !== "IHDR") return {};
	const width = header.readUInt32BE(16);
	const height = header.readUInt32BE(20);
	const colorType = header[25];
	if (colorType === 0) return { width, height, channels: 1, hasAlpha: false };
	if (colorType === 2) return { width, height, channels: 3, hasAlpha: false };
	if (colorType === 3) return { width, height, channels: 3 };
	if (colorType === 4) return { width, height, channels: 2, hasAlpha: true };
	if (colorType === 6) return { width, height, channels: 4, hasAlpha: true };
	return { width, height };
}

function parseJpegMetadata(header: Buffer): ParsedImageHeaderMetadata {
	if (header.length < 4) return {};
	if (header[0] !== 0xff || header[1] !== 0xd8) return {};

	let offset = 2;
	while (offset + 9 < header.length) {
		if (header[offset] !== 0xff) {
			offset += 1;
			continue;
		}

		let markerOffset = offset + 1;
		while (markerOffset < header.length && header[markerOffset] === 0xff) {
			markerOffset += 1;
		}
		if (markerOffset >= header.length) break;

		const marker = header[markerOffset];
		const segmentOffset = markerOffset + 1;

		if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) {
			offset = segmentOffset;
			continue;
		}
		if (marker >= 0xd0 && marker <= 0xd7) {
			offset = segmentOffset;
			continue;
		}
		if (segmentOffset + 1 >= header.length) break;

		const segmentLength = header.readUInt16BE(segmentOffset);
		if (segmentLength < 2) break;

		const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
		if (isStartOfFrame) {
			if (segmentOffset + 7 >= header.length) break;
			const height = header.readUInt16BE(segmentOffset + 3);
			const width = header.readUInt16BE(segmentOffset + 5);
			const channels = header[segmentOffset + 7];
			return {
				width,
				height,
				channels: Number.isFinite(channels) ? channels : undefined,
				hasAlpha: false,
			};
		}

		offset = segmentOffset + segmentLength;
	}

	return {};
}

function parseGifMetadata(header: Buffer): ParsedImageHeaderMetadata {
	if (header.length < 10) return {};
	const signature = header.slice(0, 6).toString("ascii");
	if (signature !== "GIF87a" && signature !== "GIF89a") return {};
	return {
		width: header.readUInt16LE(6),
		height: header.readUInt16LE(8),
		channels: 3,
	};
}

function parseWebpMetadata(header: Buffer): ParsedImageHeaderMetadata {
	if (header.length < 30) return {};
	if (header.slice(0, 4).toString("ascii") !== "RIFF") return {};
	if (header.slice(8, 12).toString("ascii") !== "WEBP") return {};

	const chunkType = header.slice(12, 16).toString("ascii");
	if (chunkType === "VP8X") {
		const hasAlpha = (header[20] & 0x10) !== 0;
		const width = (header[24] | (header[25] << 8) | (header[26] << 16)) + 1;
		const height = (header[27] | (header[28] << 8) | (header[29] << 16)) + 1;
		return { width, height, channels: hasAlpha ? 4 : 3, hasAlpha };
	}
	if (chunkType === "VP8L") {
		if (header.length < 25) return {};
		const bits = header.readUInt32LE(21);
		const width = (bits & 0x3fff) + 1;
		const height = ((bits >> 14) & 0x3fff) + 1;
		const hasAlpha = ((bits >> 28) & 0x1) === 1;
		return { width, height, channels: hasAlpha ? 4 : 3, hasAlpha };
	}
	if (chunkType === "VP8 ") {
		const width = header.readUInt16LE(26) & 0x3fff;
		const height = header.readUInt16LE(28) & 0x3fff;
		return { width, height, channels: 3, hasAlpha: false };
	}
	return {};
}

function parseImageHeaderMetadata(header: Buffer, mimeType: string): ParsedImageHeaderMetadata {
	if (mimeType === "image/png") return parsePngMetadata(header);
	if (mimeType === "image/jpeg") return parseJpegMetadata(header);
	if (mimeType === "image/gif") return parseGifMetadata(header);
	if (mimeType === "image/webp") return parseWebpMetadata(header);
	return {};
}

async function readHeader(filePath: string, maxBytes: number): Promise<Buffer> {
	if (maxBytes <= 0) return Buffer.alloc(0);
	const fileHandle = await fs.open(filePath, "r");
	try {
		const buffer = Buffer.allocUnsafe(maxBytes);
		const { bytesRead } = await fileHandle.read(buffer, 0, maxBytes, 0);
		return buffer.subarray(0, bytesRead);
	} finally {
		await fileHandle.close();
	}
}

export async function readImageMetadata(options: ReadImageMetadataOptions): Promise<ImageMetadata | null> {
	const resolvedPath = options.resolvedPath ?? resolveReadPath(options.path, options.cwd);
	const mimeType = options.detectedMimeType ?? (await detectSupportedImageMimeTypeFromFile(resolvedPath));
	if (!mimeType) return null;

	const stats = await Bun.file(resolvedPath).stat();
	const bytes = stats.size;
	const headerBytes = Math.max(0, Math.min(bytes, MAX_IMAGE_METADATA_HEADER_BYTES));
	const header = await readHeader(resolvedPath, headerBytes);
	const parsed = parseImageHeaderMetadata(header, mimeType);

	return {
		mimeType,
		bytes,
		width: parsed.width,
		height: parsed.height,
		channels: parsed.channels,
		hasAlpha: parsed.hasAlpha,
	};
}

export async function loadImageInput(options: LoadImageInputOptions): Promise<LoadedImageInput | null> {
	const maxBytes = options.maxBytes ?? MAX_IMAGE_INPUT_BYTES;
	const resolvedPath = options.resolvedPath ?? resolveReadPath(options.path, options.cwd);
	const mimeType = options.detectedMimeType ?? (await detectSupportedImageMimeTypeFromFile(resolvedPath));
	if (!mimeType) return null;

	const stat = await Bun.file(resolvedPath).stat();
	if (stat.size > maxBytes) {
		throw new ImageInputTooLargeError(stat.size, maxBytes);
	}

	const inputBuffer = await fs.readFile(resolvedPath);
	if (inputBuffer.byteLength > maxBytes) {
		throw new ImageInputTooLargeError(inputBuffer.byteLength, maxBytes);
	}

	let outputData = Buffer.from(inputBuffer).toBase64();
	let outputMimeType = mimeType;
	let outputBytes = inputBuffer.byteLength;
	let dimensionNote: string | undefined;

	if (options.autoResize) {
		try {
			const resized = await resizeImage({ type: "image", data: outputData, mimeType });
			outputData = resized.data;
			outputMimeType = resized.mimeType;
			outputBytes = resized.buffer.byteLength;
			dimensionNote = formatDimensionNote(resized);
		} catch {
			// keep original image when resize fails
		}
	}

	let textNote = `Read image file [${outputMimeType}]`;
	if (dimensionNote) {
		textNote += `\n${dimensionNote}`;
	}

	return {
		resolvedPath,
		mimeType: outputMimeType,
		data: outputData,
		textNote,
		dimensionNote,
		bytes: outputBytes,
	};
}
