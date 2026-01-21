import { join } from "node:path";
import { getDashboardStats, getTotalMessageCount, syncAllSessions } from "./aggregator";

const STATIC_DIR = join(import.meta.dir, "..", "public");

/**
 * Handle API requests.
 */
async function handleApi(path: string): Promise<Response> {
	// Sync sessions before returning stats
	await syncAllSessions();

	if (path === "/api/stats") {
		const stats = await getDashboardStats();
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
async function handleStatic(path: string): Promise<Response> {
	const filePath = path === "/" ? "/index.html" : path;
	const fullPath = join(STATIC_DIR, filePath);

	const file = Bun.file(fullPath);
	const exists = await file.exists();

	if (!exists) {
		// Try with .html extension
		const htmlPath = `${fullPath}.html`;
		const htmlFile = Bun.file(htmlPath);
		if (await htmlFile.exists()) {
			return new Response(htmlFile);
		}
		return new Response("Not Found", { status: 404 });
	}

	return new Response(file);
}

/**
 * Start the HTTP server.
 */
export function startServer(port = 3847): { port: number; stop: () => void } {
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
					response = await handleApi(path);
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
