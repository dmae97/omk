import { existsSync } from "node:fs";
import { win32 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { normalizePath, resolvePath } from "./paths.ts";

interface TerminalLinkEnvironment {
	readonly env?: NodeJS.ProcessEnv;
	readonly platform?: NodeJS.Platform;
}

/** File URLs are opened by the host terminal, not by a Linux process inside WSL. */
export function terminalFileUrl(path: string, cwd: string, options: TerminalLinkEnvironment = {}): string {
	const env = options.env ?? process.env;
	const platform = options.platform ?? process.platform;
	if (/^[a-z]:[\\/]|^\\\\/i.test(path)) return pathToFileURL(path, { windows: true }).href;
	const absolute = platform === "win32" ? win32.resolve(cwd, normalizePath(path)) : resolvePath(path, cwd);
	const distro = env.WSL_DISTRO_NAME;
	if (platform === "linux" && distro && !env.SSH_CONNECTION && !env.SSH_TTY && !/[\\/\x00-\x1f]/.test(distro)) {
		const drive = /^\/mnt\/([a-z])(?:\/|$)/i.exec(absolute);
		const windowsPath = drive
			? `${drive[1].toUpperCase()}:\\${absolute.slice(drive[0].length).replaceAll("/", "\\")}`
			: `\\\\wsl.localhost\\${distro}${absolute.replaceAll("/", "\\")}`;
		return pathToFileURL(windowsPath, { windows: true }).href;
	}
	return pathToFileURL(absolute, { windows: platform === "win32" }).href;
}

/** Bind destinations to the active project so resumed sessions do not use the launch cwd. */
export function terminalMarkdownLinks(cwd: string, options: TerminalLinkEnvironment = {}) {
	return {
		resolveLink(href: string): string | undefined {
			if (/[\x00-\x1f\x7f]/.test(href)) return undefined;
			if (/^[a-z]:[\\/]|^\\\\/i.test(href)) return terminalFileUrl(href, cwd, options);
			if (href.startsWith("#")) return href;
			if (/^file:/i.test(href)) {
				try {
					const url = new URL(href);
					if (url.hostname && url.hostname !== "localhost") return href;
					const windows = /^\/[a-z]:\//i.test(url.pathname);
					return terminalFileUrl(fileURLToPath(url, { windows }), cwd, options) + url.search + url.hash;
				} catch {
					return undefined;
				}
			}
			if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("//")) return href;
			const boundary = href.search(/[?#]/);
			const pathname = boundary < 0 ? href : href.slice(0, boundary);
			const suffix = boundary < 0 ? "" : href.slice(boundary);
			try {
				return terminalFileUrl(decodeURIComponent(pathname), cwd, options) + suffix;
			} catch (error) {
				if (error instanceof URIError) return terminalFileUrl(pathname, cwd, options) + suffix;
				throw error;
			}
		},
		resolveFileLink(text: string): string | undefined {
			if (/^[a-z][a-z\d+.-]*:/i.test(text) && !/^[a-z]:[\\/]/i.test(text)) return undefined;
			if (/[\x00-\x1f\x7f]/.test(text) || (!/[\\/]/.test(text) && !/\.[a-z\d]{1,10}$/i.test(text))) return undefined;
			const path = resolvePath(text, cwd);
			return existsSync(path) ? terminalFileUrl(text, cwd, options) : undefined;
		},
	};
}
