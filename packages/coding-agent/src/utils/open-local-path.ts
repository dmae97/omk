import { execFile, spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { dirname, extname, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { sniffImageMimeType } from "../core/prompt-attachment.ts";
import { parseAttachmentPaths, readPromptImageFile } from "../core/prompt-image-files.ts";
import { extensionForImageMimeType } from "./clipboard-image.ts";
import { resolvePath } from "./paths.ts";
import { terminalFileUrl } from "./terminal-links.ts";

const imageExtensions = /^\.(png|jpe?g|webp|gif)$/i;

function validateLocalPath(path: string): void {
	if (
		/[\x00-\x1f\x7f]/.test(path) ||
		/^[\\/]{2}/.test(path) ||
		(/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) ||
		(process.platform === "win32" && path.replace(/^[a-z]:/i, "").includes(":"))
	) {
		throw new Error("Use a local path or local file URL.");
	}
}

export async function localPathTarget(input: string, cwd: string): Promise<string> {
	let path = input || ".";
	if (/^\(file:\/\//i.test(path) && path.endsWith(")")) path = path.slice(1, -1);
	if (path.startsWith('"') || path.startsWith("'")) {
		const tokens = parseAttachmentPaths(path);
		if (tokens.length !== 1) throw new Error("Choose one local path.");
		path = tokens[0];
	}
	if (/^file:\/\//i.test(path)) {
		const url = URL.parse(path);
		if (!url || url.search || url.hash) throw new Error("Use a local path or local file URL.");
		const distro = process.platform === "linux" ? process.env.WSL_DISTRO_NAME : undefined;
		if (distro && url.hostname === "wsl.localhost" && url.pathname.startsWith(`/${distro}/`)) {
			path = fileURLToPath(`file://${url.pathname.slice(distro.length + 1)}`);
		} else if (distro && !url.hostname && /^\/[a-z]:\//i.test(url.pathname)) {
			const drive = url.pathname[1].toLowerCase();
			path = fileURLToPath(`file:///mnt/${drive}${url.pathname.slice(3)}`);
		} else {
			if (url.hostname) throw new Error("Use a local path or local file URL.");
			path = fileURLToPath(url);
		}
	}
	validateLocalPath(path);
	const absolute = resolvePath(path, cwd);
	validateLocalPath(absolute);
	const target = await realpath(absolute).catch((error: NodeJS.ErrnoException) => {
		if (error.code === "ENOENT" || error.code === "ENOTDIR") throw new Error("Local path not found.");
		throw error;
	});
	validateLocalPath(target);
	const info = await stat(target);
	if (info.isDirectory()) return target;
	if (!info.isFile()) throw new Error("Choose a regular file or folder.");
	if (imageExtensions.test(extname(target))) {
		const bytes = await readPromptImageFile(target, cwd).catch(() => undefined);
		const mime = bytes && sniffImageMimeType(bytes);
		const actual = mime && extensionForImageMimeType(mime);
		const extension = extname(target).slice(1).toLowerCase();
		const expected = extension === "jpeg" ? "jpg" : extension;
		if (actual === expected) return target;
	}
	return dirname(target);
}

export function localPathLauncher(path: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv, directory = false) {
	if (env.SSH_CONNECTION || env.SSH_TTY) throw new Error("Open is only available from a local desktop session.");
	if (platform === "darwin") {
		return { command: "/usr/bin/open", args: directory ? ["-a", "Finder", path] : [path] };
	}
	const wsl = platform === "linux" && env.WSL_DISTRO_NAME;
	if (wsl || platform === "win32") {
		if (wsl && (/[\\:<>"|?*]/.test(path) || path.split("/").some((segment) => /[. ]$/.test(segment)))) {
			throw new Error("This filename cannot be opened on the Windows desktop.");
		}
		const target = wsl ? fileURLToPath(terminalFileUrl(path, "/", { env, platform }), { windows: true }) : path;
		const data = Buffer.from(target, "utf8").toString("base64");
		const script = `$ErrorActionPreference = 'Stop'; $path = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}')); Start-Process -FilePath $path`;
		const command = wsl
			? "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
			: win32.join(
					env.SystemRoot || env.SYSTEMROOT || "C:\\Windows",
					"System32/WindowsPowerShell/v1.0/powershell.exe",
				);
		const args = [
			"-NoProfile",
			"-NonInteractive",
			"-EncodedCommand",
			Buffer.from(script, "utf16le").toString("base64"),
		];
		return { command, args };
	}
	if (platform !== "linux") throw new Error("Local file opening is not supported on this platform.");
	return { command: "xdg-open", args: [path] };
}

async function openLocalPath(input: string, cwd: string): Promise<void> {
	if (process.env.SSH_CONNECTION || process.env.SSH_TTY) {
		throw new Error("Open is only available from a local desktop session.");
	}
	const target = await localPathTarget(input, cwd);
	const directory = (await stat(target)).isDirectory();
	const { command, args } = localPathLauncher(target, process.platform, process.env, directory);
	if (command === "xdg-open") {
		await new Promise<void>((resolve, reject) => {
			const child = spawn(command, args, { stdio: "ignore", detached: true });
			child.once("error", reject);
			child.once("spawn", () => {
				child.unref();
				resolve();
			});
		});
		return;
	}
	try {
		await promisify(execFile)(command, args, { cwd: dirname(command), windowsHide: true, timeout: 8000 });
	} catch {
		throw new Error("The desktop could not open this path. Check that the file has a default viewer.");
	}
}

export async function runOpenPathCommand(text: string, cwd: string, warn: (message: string) => void): Promise<void> {
	try {
		await openLocalPath(text.slice("/open".length).trimStart(), cwd);
	} catch (error) {
		warn(error instanceof Error ? error.message : "Could not open the local path.");
	}
}
