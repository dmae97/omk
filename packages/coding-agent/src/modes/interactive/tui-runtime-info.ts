import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "../../config.ts";

export interface TuiRuntimeCapture {
	readonly version: string;
	readonly nodeVersion: string;
	readonly platform: NodeJS.Platform;
	readonly arch: string;
	readonly capturedAt: string;
	readonly entryPath: string | null;
	readonly modulePath: string | null;
	readonly moduleKind: "source" | "dist" | "bundled" | "unknown";
	readonly initialModuleSha256: string | null;
}
export interface TuiRuntimeInfo extends TuiRuntimeCapture {
	readonly currentModuleSha256: string | null;
	readonly moduleState: "unchanged" | "changed" | "unavailable";
	/** The package currently supplies no build-to-commit binding. Never substitute checkout HEAD. */
	readonly buildRevision: null;
}

function moduleDigest(filePath: string | null): string | null {
	if (!filePath) return null;
	let fd: number | undefined;
	try {
		fd = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
		const stat = fstatSync(fd);
		if (!stat.isFile() || stat.size > 1_048_576) return null;
		const bytes = Buffer.alloc(stat.size + 1);
		const count = readSync(fd, bytes, 0, bytes.length, 0);
		if (count !== stat.size || fstatSync(fd).mtimeMs !== stat.mtimeMs) return null;
		return createHash("sha256").update(bytes.subarray(0, count)).digest("hex");
	} catch {
		// A missing/unreadable/virtual entry is an unavailable observation, not a clean bill of health.
		return null;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

export function captureTuiRuntime(moduleUrl: string): TuiRuntimeCapture {
	let modulePath: string | null = null;
	try {
		modulePath = fileURLToPath(moduleUrl);
	} catch {
		// Bundled runtimes need not expose a file URL.
	}
	let entryPath = process.argv[1] ? resolve(process.argv[1]) : null;
	if (entryPath) {
		try {
			entryPath = realpathSync(entryPath);
		} catch {
			/* Keep the observed launch path when unavailable. */
		}
	}
	const normalized = modulePath?.replaceAll("\\", "/") ?? moduleUrl;
	const moduleKind = /(?:^bun:|\/\$bunfs\/|\/~BUN\/)/u.test(normalized)
		? "bundled"
		: modulePath && [".ts", ".tsx", ".mts", ".cts"].includes(extname(modulePath))
			? "source"
			: normalized.includes("/dist/")
				? "dist"
				: "unknown";
	return Object.freeze({
		version: VERSION,
		nodeVersion: process.versions.node,
		platform: process.platform,
		arch: process.arch,
		capturedAt: new Date().toISOString(),
		entryPath,
		modulePath,
		moduleKind,
		initialModuleSha256: moduleKind === "bundled" ? null : moduleDigest(modulePath),
	});
}

export function inspectTuiRuntime(capture: TuiRuntimeCapture): TuiRuntimeInfo {
	const currentModuleSha256 = capture.moduleKind === "bundled" ? null : moduleDigest(capture.modulePath);
	const moduleState =
		!capture.initialModuleSha256 || !currentModuleSha256
			? "unavailable"
			: capture.initialModuleSha256 === currentModuleSha256
				? "unchanged"
				: "changed";
	return { ...capture, currentModuleSha256, moduleState, buildRevision: null };
}
