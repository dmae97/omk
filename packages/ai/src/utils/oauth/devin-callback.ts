import { createServer } from "node:http";
import { oauthErrorHtml, oauthSuccessHtml } from "./oauth-page.ts";

export interface DevinCallback {
	redirectUri: string;
	code: Promise<string | null>;
	close(): Promise<void>;
}

export async function startDevinCallback(state: string, signal: AbortSignal, port: number): Promise<DevinCallback> {
	signal.throwIfAborted();
	let finish: (code: string | null) => void = () => {};
	const code = new Promise<string | null>((resolve) => {
		finish = resolve;
	});
	const server = createServer((req, res) => {
		let url: URL;
		try {
			url = new URL(req.url ?? "/", "http://127.0.0.1");
		} catch {
			res.writeHead(400).end();
			return;
		}
		if (req.method !== "GET" || url.pathname !== "/callback") {
			res.writeHead(404).end();
			return;
		}
		if (url.searchParams.get("state") !== state) {
			res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(
				oauthErrorHtml("Invalid login state. Return to OMK and sign in again."),
			);
			return;
		}
		const value = url.searchParams.get("code");
		const valid = Boolean(value) && !url.searchParams.has("error");
		res.writeHead(valid ? 200 : 400, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
		res.end(
			valid
				? oauthSuccessHtml("Return to OMK to finish signing in.")
				: oauthErrorHtml("Devin login was not approved."),
		);
		finish(valid ? value : null);
	});
	const cancel = () => finish(null);
	const close = async () => {
		signal.removeEventListener("abort", cancel);
		finish(null);
		server.closeAllConnections();
		if (server.listening)
			await new Promise<void>((resolve) => {
				server.close(() => resolve());
			});
	};
	try {
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(port, "127.0.0.1", () => {
				server.removeListener("error", reject);
				resolve();
			});
		});
		signal.throwIfAborted();
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Unable to start Devin login callback");
		signal.addEventListener("abort", cancel, { once: true });
		return { redirectUri: `http://127.0.0.1:${address.port}/callback`, code, close };
	} catch (error) {
		await close();
		throw error;
	}
}
