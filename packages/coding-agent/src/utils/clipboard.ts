import * as fs from "node:fs/promises";
import * as os from "node:os";
import { $ } from "bun";
import { nanoid } from "nanoid";

const PREFERRED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

function isWaylandSession(env: NodeJS.ProcessEnv = process.env): boolean {
	return Boolean(env.WAYLAND_DISPLAY) || env.XDG_SESSION_TYPE === "wayland";
}

function baseMimeType(mimeType: string): string {
	const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? mimeType.toLowerCase();
	return base === "image/jpg" ? "image/jpeg" : base;
}

function selectPreferredImageMimeType(mimeTypes: string[]): string | null {
	const normalized = mimeTypes
		.map((t) => t.trim())
		.filter(Boolean)
		.map((t) => ({ raw: t, base: baseMimeType(t) }));

	for (const preferred of PREFERRED_IMAGE_MIME_TYPES) {
		const match = normalized.find((t) => t.base === preferred);
		if (match) {
			return match.raw;
		}
	}

	const anyImage = normalized.find((t) => t.base.startsWith("image/"));
	return anyImage?.raw ?? null;
}

export async function copyToClipboard(text: string): Promise<void> {
	const p = os.platform();
	const timeout = 5000;

	try {
		if (p === "darwin") {
			await Bun.spawn(["pbcopy"], { stdin: Buffer.from(text), timeout }).exited;
		} else if (p === "win32") {
			await Bun.spawn(["clip"], { stdin: Buffer.from(text), timeout }).exited;
		} else {
			const wayland = isWaylandSession();
			if (wayland) {
				const wlCopyPath = Bun.which("wl-copy");
				if (wlCopyPath) {
					// Fire-and-forget: wl-copy may not exit promptly, so we unref to avoid blocking
					void Bun.spawn([wlCopyPath], { stdin: Buffer.from(text), timeout }).unref();
					return;
				}
			}

			// Linux - try xclip first, fall back to xsel
			try {
				await Bun.spawn(["xclip", "-selection", "clipboard"], { stdin: Buffer.from(text), timeout }).exited;
			} catch {
				await Bun.spawn(["xsel", "--clipboard", "--input"], { stdin: Buffer.from(text), timeout }).exited;
			}
		}
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		if (p === "linux") {
			const tools = isWaylandSession() ? "wl-copy, xclip, or xsel" : "xclip or xsel";
			throw new Error(`Failed to copy to clipboard. Install ${tools}: ${msg}`);
		}
		throw new Error(`Failed to copy to clipboard: ${msg}`);
	}
}

export interface ClipboardImage {
	data: string; // base64 encoded
	mimeType: string;
}

/**
 * Read image from system clipboard if available.
 * Returns null if no image is in clipboard or clipboard access fails.
 *
 * Supported platforms:
 * - Linux: requires wl-paste (Wayland) or xclip (X11)
 * - macOS: uses osascript + pbpaste
 * - Windows: uses PowerShell
 */
export async function readImageFromClipboard(): Promise<ClipboardImage | null> {
	const p = os.platform();
	const timeout = 3000;
	let promise: Promise<ClipboardImage | null>;
	switch (p) {
		case "linux":
			promise = readImageLinux();
			break;
		case "darwin":
			promise = readImageMacOS();
			break;
		case "win32":
			promise = readImageWindows();
			break;
		default:
			return null;
	}
	return Promise.race([promise, Bun.sleep(timeout).then(() => null)]);
}

type ClipboardReadResult =
	| { status: "found"; image: ClipboardImage }
	| { status: "empty" } // Tools ran successfully, no image in clipboard
	| { status: "unavailable" }; // Tools not found or failed to run

async function readImageLinux(): Promise<ClipboardImage | null> {
	const wayland = isWaylandSession();
	if (wayland) {
		const result = await readImageWayland();
		if (result.status === "found") return result.image;
		if (result.status === "empty") return null; // Don't fall back to X11 if Wayland worked
	}

	const result = await readImageX11();
	return result.status === "found" ? result.image : null;
}

async function readImageWayland(): Promise<ClipboardReadResult> {
	const types = await $`wl-paste --list-types`.quiet().text();
	if (!types) return { status: "unavailable" }; // Command failed

	const typeList = types
		.split(/\r?\n/)
		.map((t) => t.trim())
		.filter(Boolean);

	const selectedType = selectPreferredImageMimeType(typeList);
	if (!selectedType) return { status: "empty" }; // No image types available

	const imageData = await $`wl-paste --type ${selectedType} --no-newline`.quiet().arrayBuffer();
	if (!imageData || imageData.byteLength === 0) return { status: "empty" };

	return {
		status: "found",
		image: {
			data: Buffer.from(imageData).toString("base64"),
			mimeType: baseMimeType(selectedType),
		},
	};
}

async function readImageX11(): Promise<ClipboardReadResult> {
	const targets = await $`xclip -selection clipboard -t TARGETS -o`.quiet().text();
	if (!targets) return { status: "unavailable" }; // xclip failed (no X server?)

	const candidateTypes = targets
		.split(/\r?\n/)
		.map((t) => t.trim())
		.filter(Boolean);

	const selectedType = selectPreferredImageMimeType(candidateTypes);
	if (!selectedType) return { status: "empty" }; // Clipboard has no image types

	const imageData = await $`xclip -selection clipboard -t ${selectedType} -o`.quiet().arrayBuffer();
	if (!imageData || imageData.byteLength === 0) return { status: "empty" };

	return {
		status: "found",
		image: {
			data: Buffer.from(imageData).toString("base64"),
			mimeType: baseMimeType(selectedType),
		},
	};
}

async function readImageMacOS(): Promise<ClipboardImage | null> {
	// Use osascript to check clipboard class and read PNG data
	// First check if clipboard has image data
	const checkScript = `
		try
			clipboard info for «class PNGf»
			return "png"
		on error
			try
				clipboard info for «class JPEG»
				return "jpeg"
			on error
				return "none"
			end try
		end try
	`;

	const checkResult = await $`osascript -e ${checkScript}`.quiet().text();
	const imageType = checkResult.trim();
	if (imageType === "none") return null;

	// Read the actual image data using a temp file approach
	// osascript can't output binary directly, so we write to a temp file
	const tempFile = `/tmp/omp-clipboard-${nanoid()}.${imageType === "png" ? "png" : "jpg"}`;
	const clipboardClass = imageType === "png" ? "«class PNGf»" : "«class JPEG»";

	const readScript = `
		set imageData to the clipboard as ${clipboardClass}
		set filePath to POSIX file "${tempFile}"
		set fileRef to open for access filePath with write permission
		write imageData to fileRef
		close access fileRef
	`;

	await $`osascript -e ${readScript}`.quiet().text();

	try {
		const file = Bun.file(tempFile);
		if (await file.exists()) {
			const buffer = await file.bytes();
			await fs.unlink(tempFile).catch(() => {});

			if (buffer.length > 0) {
				return {
					data: Buffer.from(buffer).toString("base64"),
					mimeType: imageType === "png" ? "image/png" : "image/jpeg",
				};
			}
		}
	} catch {
		// File read failed
	}

	return null;
}

async function readImageWindows(): Promise<ClipboardImage | null> {
	// PowerShell script to read image from clipboard as base64
	const script = `
		Add-Type -AssemblyName System.Windows.Forms
		$clipboard = [System.Windows.Forms.Clipboard]::GetImage()
		if ($clipboard -ne $null) {
			$ms = New-Object System.IO.MemoryStream
			$clipboard.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
			[Convert]::ToBase64String($ms.ToArray())
		}
	`;

	const result = await $`powershell -NoProfile -Command ${script}`.quiet().text();
	return result ? { data: result, mimeType: "image/png" } : null;
}
