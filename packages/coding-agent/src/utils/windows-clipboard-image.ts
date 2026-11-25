import { execFile } from "node:child_process";
import { dirname, isAbsolute } from "node:path";
import { PROMPT_ATTACHMENT_LIMITS, type PromptImageMimeType, sniffImageMimeType } from "../core/prompt-attachment.ts";

export type WindowsClipboardResult =
	| { readonly kind: "image"; readonly bytes: Uint8Array; readonly mimeType: PromptImageMimeType }
	| { readonly kind: "empty" }
	| { readonly kind: "unavailable"; readonly reason: "not-found" | "timeout" | "failed" };

export class WindowsClipboardError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WindowsClipboardError";
	}
}

const PNG_PREFIX = "OMK_CLIPBOARD_PNG:";
const IMG_PREFIX = "OMK_CLIPBOARD_IMG:";
const MAX_BYTES = PROMPT_ATTACHMENT_LIMITS.maxImageBytes;
const MAX_PIXELS = PROMPT_ATTACHMENT_LIMITS.maxPixels;

const SCRIPT = [
	"$ErrorActionPreference = 'Stop'",
	"Add-Type -AssemblyName System.Windows.Forms",
	"Add-Type -AssemblyName System.Drawing",
	"$pngStream = [System.Windows.Forms.Clipboard]::GetData('PNG')",
	"if ($pngStream -is [System.IO.MemoryStream]) {",
	"  try {",
	`    if ($pngStream.Length -gt ${MAX_BYTES}) { [Console]::Write('OMK_CLIPBOARD_TOO_LARGE'); exit 0 }`,
	"    if ($pngStream.Length -gt 0) {",
	`      [Console]::Write('${PNG_PREFIX}' + [Convert]::ToBase64String($pngStream.ToArray())); exit 0`,
	"    }",
	"  } finally { $pngStream.Dispose() }",
	"}",
	"$image = [System.Windows.Forms.Clipboard]::GetImage()",
	"if ($null -ne $image) {",
	"  $stream = New-Object System.IO.MemoryStream",
	"  try {",
	`    if ([long]$image.Width * $image.Height -gt ${MAX_PIXELS}) { [Console]::Write('OMK_CLIPBOARD_TOO_LARGE'); exit 0 }`,
	"    $image.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)",
	`    if ($stream.Length -gt ${MAX_BYTES}) { [Console]::Write('OMK_CLIPBOARD_TOO_LARGE'); exit 0 }`,
	`    [Console]::Write('${PNG_PREFIX}' + [Convert]::ToBase64String($stream.ToArray())); exit 0`,
	"  } finally { $stream.Dispose(); $image.Dispose() }",
	"}",
	"$files = [System.Windows.Forms.Clipboard]::GetFileDropList()",
	"if ($null -ne $files -and $files.Count -gt 0) {",
	"  foreach ($f in $files) {",
	"    if ($f -match '\\.(png|jpe?g|webp|gif)$' -and [System.IO.File]::Exists($f)) {",
	"      $info = New-Object System.IO.FileInfo($f)",
	`      if ($info.Length -gt ${MAX_BYTES}) { [Console]::Write('OMK_CLIPBOARD_TOO_LARGE'); exit 0 }`,
	"      if ($info.Length -gt 0) {",
	"        $bytes = [System.IO.File]::ReadAllBytes($f)",
	`        [Console]::Write('${IMG_PREFIX}' + [Convert]::ToBase64String($bytes)); exit 0`,
	"      }",
	"    }",
	"  }",
	"}",
	"[Console]::Write('OMK_CLIPBOARD_EMPTY')",
].join("\n");

function readCommand(command: string, env: NodeJS.ProcessEnv): Promise<string | WindowsClipboardResult> {
	const childEnv: NodeJS.ProcessEnv = {};
	for (const key of [
		"PATH",
		"Path",
		"SystemRoot",
		"SYSTEMROOT",
		"WINDIR",
		"TEMP",
		"TMP",
		"USERPROFILE",
		"WSL_INTEROP",
		"WSL_DISTRO_NAME",
	]) {
		if (env[key] !== undefined) childEnv[key] = env[key];
	}
	return new Promise((resolve) => {
		execFile(
			command,
			["-NoProfile", "-NonInteractive", "-STA", "-Command", SCRIPT],
			{
				encoding: "utf8",
				windowsHide: true,
				// Avoid launching Windows in a project UNC directory across the WSL filesystem bridge.
				cwd: isAbsolute(command) ? dirname(command) : undefined,
				env: childEnv,
				timeout: 10000,
				maxBuffer: Math.ceil(MAX_BYTES / 3) * 4 + 1024,
			},
			(error, stdout) => {
				if (!error) resolve(stdout.trim());
				else
					resolve({
						kind: "unavailable",
						reason: error.code === "ENOENT" ? "not-found" : error.killed ? "timeout" : "failed",
					});
			},
		);
	});
}

function decodeBase64Payload(encoded: string, label: string): Buffer {
	if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
		throw new WindowsClipboardError(`Windows clipboard returned invalid ${label} data.`);
	}
	const bytes = Buffer.from(encoded, "base64");
	if (bytes.length > MAX_BYTES) {
		throw new WindowsClipboardError(`Windows clipboard returned invalid or oversized ${label} data.`);
	}
	return bytes;
}

/** Read only image data. No clipboard writes, temporary screenshots, profiles, or policy bypass. */
export async function readWindowsClipboardImage(env: NodeJS.ProcessEnv = process.env): Promise<WindowsClipboardResult> {
	for (const command of ["/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe", "powershell.exe"]) {
		const result = await readCommand(command, env);
		if (typeof result !== "string") {
			if (result.kind === "unavailable" && result.reason === "not-found") continue;
			return result;
		}
		if (result === "OMK_CLIPBOARD_EMPTY") return { kind: "empty" };
		if (result === "OMK_CLIPBOARD_TOO_LARGE")
			throw new WindowsClipboardError("Windows clipboard image exceeds the prompt image size limit.");
		if (result.startsWith(PNG_PREFIX)) {
			const bytes = decodeBase64Payload(result.slice(PNG_PREFIX.length), "PNG");
			if (sniffImageMimeType(bytes) !== "image/png") {
				throw new WindowsClipboardError("Windows clipboard returned invalid or oversized PNG data.");
			}
			return { kind: "image", bytes, mimeType: "image/png" };
		}
		if (result.startsWith(IMG_PREFIX)) {
			const bytes = decodeBase64Payload(result.slice(IMG_PREFIX.length), "image");
			const mimeType = sniffImageMimeType(bytes);
			if (!mimeType) {
				throw new WindowsClipboardError("Windows clipboard returned unsupported image data.");
			}
			return { kind: "image", bytes, mimeType };
		}
		throw new WindowsClipboardError("Windows clipboard returned invalid PNG data.");
	}
	return { kind: "unavailable", reason: "not-found" };
}
