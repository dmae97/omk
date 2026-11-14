import type { createServer as CreateServer } from "node:http";
import { oauthErrorHtml, oauthSuccessHtml } from "./oauth-page.ts";

export async function startGoogleOAuthCallback(
	createServer: typeof CreateServer,
	port: number,
	path: string,
	state: string,
	signal?: AbortSignal,
) {
	signal?.throwIfAborted();
	let finish: (code: string | null) => void = () => {};
	const code = new Promise<string | null>((resolve) => {
		finish = resolve;
	});
	let completed = false;
	const settle = (value: string | null) => {
		if (completed) return;
		completed = true;
		finish(value);
	};
	const server = createServer((req, res) => {
		let url: URL;
		try {
			url = new URL(req.url ?? "/", "http://127.0.0.1");
		} catch {
			res.writeHead(400).end();
			return;
		}
		if (req.method !== "GET" || url.pathname !== path) {
			res.writeHead(404).end();
			return;
		}
		const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" };
		if (url.searchParams.get("state") !== state) {
			res.writeHead(400, headers).end(oauthErrorHtml("Invalid login state. Return to OMK and sign in again."));
			return;
		}
		if (completed) {
			res.writeHead(409).end();
			return;
		}
		const value = url.searchParams.get("code");
		const valid = Boolean(value) && !url.searchParams.has("error");
		res.writeHead(valid ? 200 : 400, headers).end(
			valid
				? oauthSuccessHtml("Google authentication completed. You can close this window.")
				: oauthErrorHtml("Google authentication did not complete."),
		);
		settle(valid ? value : null);
	});
	const cancel = () => settle(null);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const close = async () => {
		clearTimeout(timer);
		signal?.removeEventListener("abort", cancel);
		cancel();
		const closed = new Promise<void>((resolve) => server.close(() => resolve()));
		server.closeAllConnections();
		await closed;
	};
	try {
		await new Promise<void>((resolve, reject) => {
			let fallback = false;
			const onError = (error: NodeJS.ErrnoException) => {
				if (error.code === "EADDRINUSE" && port !== 0 && !fallback) {
					fallback = true;
					server.listen(0, "127.0.0.1");
				} else {
					server.removeListener("error", onError);
					reject(error);
				}
			};
			server.on("error", onError);
			server.listen(port, "127.0.0.1", () => {
				server.removeListener("error", onError);
				server.on("error", cancel);
				resolve();
			});
		});
		signal?.throwIfAborted();
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Unable to start Google login callback");
		signal?.addEventListener("abort", cancel, { once: true });
		timer = setTimeout(cancel, 5 * 60 * 1000);
		return { redirectUri: `http://127.0.0.1:${address.port}${path}`, code, close };
	} catch (error) {
		await close();
		throw error;
	}
}
