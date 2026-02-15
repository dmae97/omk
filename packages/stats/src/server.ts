import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { compile } from "tailwindcss";
import {
	getDashboardStats,
	getRecentErrors,
	getRecentRequests,
	getRequestDetails,
	getTotalMessageCount,
	syncAllSessions,
} from "./aggregator";
import { EMBEDDED_CLIENT_ARCHIVE_TAR_GZ_BASE64 } from "./embedded-client.generated";

/**
 * Extract Tailwind class names from source files by scanning for className attributes.
 */
async function extractTailwindClasses(dir: string): Promise<Set<string>> {
	const classes = new Set<string>();
	const classPattern = /className\s*=\s*["'`]([^"'`]+)["'`]/g;
	async function scanDir(currentDir: string): Promise<void> {
		const entries = await fs.readdir(currentDir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.join(currentDir, entry.name);
			if (entry.isDirectory()) {
				await scanDir(fullPath);
			} else if (entry.isFile() && /\.(tsx|ts|jsx|js)$/.test(entry.name)) {
				const content = await Bun.file(fullPath).text();
				const matches = content.matchAll(classPattern);
				for (const match of matches) {
					for (const cls of match[1].split(/\s+/)) {
						if (cls) classes.add(cls);
					}
				}
			}
		}
	}
	await scanDir(dir);
	return classes;
}

const CLIENT_DIR = path.join(import.meta.dir, "client");
const STATIC_DIR = path.join(import.meta.dir, "..", "dist", "client");
const IS_BUN_COMPILED =
	Bun.env.PI_COMPILED ||
	import.meta.url.includes("$bunfs") ||
	import.meta.url.includes("~BUN") ||
	import.meta.url.includes("%7EBUN");

const COMPILED_CLIENT_DIR_ROOT = path.join(os.tmpdir(), "omp-stats-client");
let compiledClientDirPromise: Promise<string> | null = null;

function sanitizeArchivePath(archivePath: string): string | null {
	const normalized = archivePath.replaceAll("\\", "/").replace(/^\.\//, "");
	if (!normalized || normalized === ".") return null;
	if (normalized.includes("..") || path.isAbsolute(normalized)) return null;
	return normalized;
}

async function extractEmbeddedClientArchive(outputDir: string): Promise<void> {
	const archiveBytes = Buffer.from(EMBEDDED_CLIENT_ARCHIVE_TAR_GZ_BASE64, "base64");
	const archive = new Bun.Archive(archiveBytes);
	const files = await archive.files();
	const extractRoot = path.resolve(outputDir);

	for (const [archivePath, file] of files) {
		const sanitizedPath = sanitizeArchivePath(archivePath);
		if (!sanitizedPath) continue;
		const destinationPath = path.resolve(extractRoot, sanitizedPath);
		if (!destinationPath.startsWith(extractRoot + path.sep)) {
			throw new Error(`Archive entry escapes extraction directory: ${archivePath}`);
		}
		await Bun.write(destinationPath, file);
	}
}

async function getCompiledClientDir(): Promise<string> {
	if (!IS_BUN_COMPILED) return STATIC_DIR;
	if (!EMBEDDED_CLIENT_ARCHIVE_TAR_GZ_BASE64) {
		throw new Error("Compiled stats client bundle missing. Rebuild binary with embedded stats assets.");
	}
	if (compiledClientDirPromise) return compiledClientDirPromise;

	compiledClientDirPromise = (async () => {
		const bundleHash = Bun.hash(EMBEDDED_CLIENT_ARCHIVE_TAR_GZ_BASE64).toString(16);
		const outputDir = path.join(COMPILED_CLIENT_DIR_ROOT, bundleHash);
		const markerPath = path.join(outputDir, "index.html");
		try {
			const marker = await fs.stat(markerPath);
			if (marker.isFile()) return outputDir;
		} catch {}

		await fs.rm(outputDir, { recursive: true, force: true });
		await fs.mkdir(outputDir, { recursive: true });
		await extractEmbeddedClientArchive(outputDir);
		return outputDir;
	})();

	return compiledClientDirPromise;
}

async function buildTailwindCss(inputPath: string, outputPath: string): Promise<void> {
	const sourceCss = await Bun.file(inputPath).text();
	const clientDir = path.dirname(inputPath);
	const candidates = await extractTailwindClasses(clientDir);
	const compiler = await compile(sourceCss, {
		base: clientDir,
		loadStylesheet: async (id: string, base: string) => {
			if (id === "tailwindcss/index.css" || id === "tailwindcss") {
				const tailwindPath = require.resolve("tailwindcss/index.css", { paths: [base] });
				return {
					path: tailwindPath,
					base: path.dirname(tailwindPath),
					content: await Bun.file(tailwindPath).text(),
				};
			}
			const resolved = path.resolve(base, id);
			return {
				path: resolved,
				base: path.dirname(resolved),
				content: await Bun.file(resolved).text(),
			};
		},
	});
	const result = compiler.build([...candidates]);
	await Bun.write(outputPath, result);
}

async function getLatestMtime(dir: string): Promise<number> {
	let latest = 0;
	const entries = await fs.readdir(dir, { withFileTypes: true });

	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			latest = Math.max(latest, await getLatestMtime(fullPath));
		} else if (entry.isFile()) {
			const stats = await fs.stat(fullPath);
			latest = Math.max(latest, stats.mtimeMs);
		}
	}

	return latest;
}

const ensureClientBuild = async () => {
	if (IS_BUN_COMPILED) return;
	const indexPath = path.join(STATIC_DIR, "index.html");
	const cssPath = path.join(STATIC_DIR, "styles.css");
	const clientSourceMtime = await getLatestMtime(CLIENT_DIR);
	const tailwindConfigPath = path.join(import.meta.dir, "..", "tailwind.config.js");
	let tailwindConfigMtime = 0;
	try {
		const tailwindConfigStats = await fs.stat(tailwindConfigPath);
		tailwindConfigMtime = tailwindConfigStats.mtimeMs;
	} catch {}
	const sourceMtime = Math.max(clientSourceMtime, tailwindConfigMtime);
	let shouldBuild = true;
	try {
		const [indexStats, cssStats] = await Promise.all([fs.stat(indexPath), fs.stat(cssPath)]);
		if (
			indexStats.isFile() &&
			cssStats.isFile() &&
			indexStats.mtimeMs >= sourceMtime &&
			cssStats.mtimeMs >= sourceMtime
		) {
			shouldBuild = false;
		}
	} catch {
		shouldBuild = true;
	}

	if (!shouldBuild) return;

	await fs.rm(STATIC_DIR, { recursive: true, force: true });

	// Build Tailwind CSS with the library API
	console.log("Building Tailwind CSS...");
	try {
		await buildTailwindCss(path.join(CLIENT_DIR, "styles.css"), path.join(STATIC_DIR, "styles.css"));
	} catch (error) {
		console.error("Tailwind build failed:", error);
	}

	console.log("Building React app...");
	const result = await Bun.build({
		entrypoints: [path.join(CLIENT_DIR, "index.tsx")],
		outdir: STATIC_DIR,
		minify: true,
		naming: "[dir]/[name].[ext]",
	});

	if (!result.success) {
		const errors = result.logs.map(log => log.message).join("\n");
		throw new Error(`Failed to build stats client:\n${errors}`);
	}

	const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Usage Statistics</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div id="root"></div>
    <script src="index.js" type="module"></script>
</body>
</html>`;

	await Bun.write(path.join(STATIC_DIR, "index.html"), indexHtml);
};

/**
 * Handle API requests.
 */
async function handleApi(req: Request): Promise<Response> {
	const url = new URL(req.url);
	const path = url.pathname;

	// Sync sessions before returning stats
	await syncAllSessions();

	if (path === "/api/stats") {
		const stats = await getDashboardStats();
		return Response.json(stats);
	}

	if (path === "/api/stats/recent") {
		const limit = url.searchParams.get("limit");
		const stats = await getRecentRequests(limit ? parseInt(limit, 10) : undefined);
		return Response.json(stats);
	}

	if (path === "/api/stats/errors") {
		const limit = url.searchParams.get("limit");
		const stats = await getRecentErrors(limit ? parseInt(limit, 10) : undefined);
		return Response.json(stats);
	}

	if (path === "/api/stats/models") {
		const stats = await getDashboardStats();
		return Response.json(stats.byModel);
	}

	if (path === "/api/stats/folders") {
		const stats = await getDashboardStats();
		return Response.json(stats.byFolder);
	}

	if (path === "/api/stats/timeseries") {
		const stats = await getDashboardStats();
		return Response.json(stats.timeSeries);
	}

	if (path.startsWith("/api/request/")) {
		const id = path.split("/").pop();
		if (!id) return new Response("Bad Request", { status: 400 });
		const details = await getRequestDetails(parseInt(id, 10));
		if (!details) return new Response("Not Found", { status: 404 });
		return Response.json(details);
	}

	if (path === "/api/sync") {
		const result = await syncAllSessions();
		const count = await getTotalMessageCount();
		return Response.json({ ...result, totalMessages: count });
	}

	return new Response("Not Found", { status: 404 });
}

/**
 * Handle static file requests.
 */
async function handleStatic(requestPath: string): Promise<Response> {
	const staticDir = IS_BUN_COMPILED ? await getCompiledClientDir() : STATIC_DIR;
	const filePath = requestPath === "/" ? "/index.html" : requestPath;
	const fullPath = path.join(staticDir, filePath);

	const file = Bun.file(fullPath);
	if (await file.exists()) {
		return new Response(file);
	}

	// SPA fallback
	const index = Bun.file(path.join(staticDir, "index.html"));
	if (await index.exists()) {
		return new Response(index);
	}

	return new Response("Not Found", { status: 404 });
}

/**
 * Start the HTTP server.
 */
export async function startServer(port = 3847): Promise<{ port: number; stop: () => void }> {
	await ensureClientBuild();

	const server = Bun.serve({
		port,
		async fetch(req) {
			const url = new URL(req.url);
			const path = url.pathname;

			// CORS headers for local development
			const corsHeaders = {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
				"Access-Control-Allow-Headers": "Content-Type",
			};

			if (req.method === "OPTIONS") {
				return new Response(null, { headers: corsHeaders });
			}

			try {
				let response: Response;

				if (path.startsWith("/api/")) {
					response = await handleApi(req);
				} else {
					response = await handleStatic(path);
				}

				// Add CORS headers to all responses
				const headers = new Headers(response.headers);
				for (const [key, value] of Object.entries(corsHeaders)) {
					headers.set(key, value);
				}

				return new Response(response.body, {
					status: response.status,
					headers,
				});
			} catch (error) {
				console.error("Server error:", error);
				return Response.json(
					{ error: error instanceof Error ? error.message : "Unknown error" },
					{ status: 500, headers: corsHeaders },
				);
			}
		},
	});

	return {
		port: server.port ?? port,
		stop: () => server.stop(),
	};
}
