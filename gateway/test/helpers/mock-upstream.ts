import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export const UPSTREAM_SENTINEL_KEY = `SENTINEL_UPSTREAM_${"KEY"}_0123456789abcdef`;

export type Script =
	| { kind: "json"; status?: number; body: unknown; headers?: Record<string, string>; gate?: Promise<void> }
	| { kind: "sse"; body: string }
	| { kind: "raw"; status: number; body: string; headers?: Record<string, string> }
	| { kind: "sse-slow"; first: string; then: () => Promise<void>; rest?: string }
	| { kind: "hang" };

export interface Recorded {
	authOk: boolean;
	path: string;
	body: any;
	aborted: boolean;
}

/** Local stand-in for the upstream API. Asserts the sentinel key and records every request. */
export class MockUpstream {
	server: Server;
	url = "";
	requests: Recorded[] = [];
	private queue: Script[] = [];
	private fallback: Script | null = null;

	constructor() {
		this.server = createServer((req, res) => void this.handle(req, res));
	}

	async start(): Promise<void> {
		await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
		this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
	}

	async stop(): Promise<void> {
		this.server.closeAllConnections();
		await new Promise<void>((r) => this.server.close(() => r()));
	}

	enqueue(s: Script): void {
		this.queue.push(s);
	}

	setDefault(s: Script | null): void {
		this.fallback = s;
	}

	reset(): void {
		this.requests = [];
		this.queue = [];
		this.fallback = null;
	}

	private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const chunks: Buffer[] = [];
		for await (const c of req) chunks.push(c as Buffer);
		let body: any = null;
		try {
			body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		} catch {}
		const rec: Recorded = { authOk: req.headers.authorization === `Bearer ${UPSTREAM_SENTINEL_KEY}`, path: req.url ?? "", body, aborted: false };
		this.requests.push(rec);
		res.on("close", () => {
			if (!res.writableEnded) rec.aborted = true;
		});
		if (!rec.authOk) {
			res.writeHead(401, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: { message: "bad key for deepseek", type: "authentication_error" } }));
			return;
		}
		const s = this.queue.shift() ?? this.fallback;
		if (!s) {
			res.writeHead(500);
			res.end("no script");
			return;
		}
		if (s.kind === "json") {
			if (s.gate) await s.gate;
			res.writeHead(s.status ?? 200, { "content-type": "application/json", server: "deepseek-edge", ...(s.headers ?? {}) });
			res.end(JSON.stringify(s.body));
		} else if (s.kind === "raw") {
			res.writeHead(s.status, { "content-type": "application/json", server: "deepseek-edge", ...(s.headers ?? {}) });
			res.end(s.body);
		} else if (s.kind === "sse") {
			res.writeHead(200, { "content-type": "text/event-stream", server: "deepseek-edge" });
			res.end(s.body);
		} else if (s.kind === "sse-slow") {
			res.writeHead(200, { "content-type": "text/event-stream" });
			res.write(s.first);
			await s.then();
			if (!res.destroyed) {
				if (s.rest) res.write(s.rest);
				res.end();
			}
		} else {
			res.writeHead(200, { "content-type": "application/json" });
			// never ends
		}
	}
}
