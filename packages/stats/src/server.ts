import * as fs from "node:fs/promises";
import * as path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import {
	getDashboardStats,
	getRecentErrors,
	getRecentRequests,
	getRequestDetails,
	getTotalMessageCount,
	syncAllSessions,
} from "./aggregator";

const CLIENT_DIR = path.join(import.meta.dir, "client");
const STATIC_DIR = path.join(import.meta.dir, "..", "dist", "client");

async function buildTailwindCss(inputPath: string, outputPath: string): Promise<void> {
	const sourceCss = await Bun.file(inputPath).text();
	const result = await postcss([
		tailwindcss({ config: path.join(import.meta.dir, "..", "tailwind.config.js") }),
	]).process(sourceCss, {
		from: inputPath,
		to: outputPath,
	});
	await Bun.write(outputPath, result.css);
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
	const filePath = requestPath === "/" ? "/index.html" : requestPath;
	const fullPath = path.join(STATIC_DIR, filePath);

	const file = Bun.file(fullPath);
	if (await file.exists()) {
		return new Response(file);
	}

	// SPA fallback
	const index = Bun.file(path.join(STATIC_DIR, "index.html"));
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
