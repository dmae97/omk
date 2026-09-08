import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createHttpProxyAgentsForTarget } from "./node-http-proxy.ts";

function headerRecord(headers: Headers): Record<string, string> {
	const record: Record<string, string> = {};
	headers.forEach((value, key) => {
		record[key] = value;
	});
	return record;
}

/**
 * `fetch` that honors HTTP(S)_PROXY / NO_PROXY. Node's built-in fetch does not.
 * When no proxy applies, this is global fetch so tests can stub it.
 */
export async function proxyAwareFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
	const request = input instanceof Request && init === undefined ? input : new Request(input, init);
	const agents = createHttpProxyAgentsForTarget(request.url);
	if (!agents) {
		return fetch(request);
	}

	const url = new URL(request.url);
	const isHttps = url.protocol === "https:";
	const headers = headerRecord(request.headers);
	const body =
		request.method === "GET" || request.method === "HEAD" ? undefined : Buffer.from(await request.arrayBuffer());
	if (body && body.byteLength > 0) {
		headers["content-length"] = String(body.byteLength);
	}

	return new Promise((resolve, reject) => {
		const req = (isHttps ? httpsRequest : httpRequest)(
			{
				protocol: url.protocol,
				hostname: url.hostname,
				port: url.port,
				path: `${url.pathname}${url.search}`,
				method: request.method,
				headers,
				agent: isHttps ? agents.httpsAgent : agents.httpAgent,
				signal: request.signal,
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => {
					chunks.push(chunk);
				});
				res.on("end", () => {
					const responseHeaders = new Headers();
					for (const [key, value] of Object.entries(res.headers)) {
						if (value === undefined) continue;
						if (Array.isArray(value)) {
							for (const item of value) responseHeaders.append(key, item);
						} else {
							responseHeaders.set(key, value);
						}
					}
					resolve(
						new Response(Buffer.concat(chunks), {
							status: res.statusCode ?? 0,
							statusText: res.statusMessage,
							headers: responseHeaders,
						}),
					);
				});
			},
		);
		req.on("error", reject);
		if (body && body.byteLength > 0) req.write(body);
		req.end();
	});
}
