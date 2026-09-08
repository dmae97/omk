import { execFile } from "node:child_process";
import { dirname, isAbsolute } from "node:path";
import { PROMPT_ATTACHMENT_LIMITS, sniffImageMimeType } from "../core/prompt-attachment.ts";

export type WindowsClipboardResult =
	| { readonly kind: "image"; readonly bytes: Uint8Array; readonly mimeType: "image/png" }
	| { readonly kind: "empty" }
	| { readonly kind: "unavailable"; readonly reason: "not-found" | "timeout" | "failed" };

export class WindowsClipboardError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WindowsClipboardError";
	}
}

const PREFIX = "OMK_CLIPBOARD_PNG:";
const SCRIPT = [
	"$ErrorActionPreference = 'Stop'",
	"Add-Type -AssemblyName System.Windows.Forms",
	"Add-Type -AssemblyName System.Drawing",
	"$image = [System.Windows.Forms.Clipboard]::GetImage()",
	"if ($null -eq $image) { [Console]::Write('OMK_CLIPBOARD_EMPTY'); exit 0 }",
	"$stream = New-Object System.IO.MemoryStream",
	"try {",
	`if ([long]$image.Width * $image.Height -gt ${PROMPT_ATTACHMENT_LIMITS.maxPixels}) { [Console]::Write('OMK_CLIPBOARD_TOO_LARGE'); exit 0 };`,
	"$image.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png);",
	`if ($stream.Length -gt ${PROMPT_ATTACHMENT_LIMITS.maxImageBytes}) { [Console]::Write('OMK_CLIPBOARD_TOO_LARGE'); exit 0 };`,
	`[Console]::Write('${PREFIX}' + [Convert]::ToBase64String($stream.ToArray()))`,
	"} finally { $stream.Dispose(); $image.Dispose() }",
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
				timeout: 5000,
				maxBuffer: Math.ceil(PROMPT_ATTACHMENT_LIMITS.maxImageBytes / 3) * 4 + 1024,
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
		const encoded = result.startsWith(PREFIX) ? result.slice(PREFIX.length) : "";
		if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
			throw new WindowsClipboardError("Windows clipboard returned invalid PNG data.");
		}
		const bytes = Buffer.from(encoded, "base64");
		if (bytes.length > PROMPT_ATTACHMENT_LIMITS.maxImageBytes || sniffImageMimeType(bytes) !== "image/png") {
			throw new WindowsClipboardError("Windows clipboard returned invalid or oversized PNG data.");
		}
		return { kind: "image", bytes, mimeType: "image/png" };
	}
	return { kind: "unavailable", reason: "not-found" };
}
