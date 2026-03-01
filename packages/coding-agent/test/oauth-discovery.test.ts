import { afterEach, describe, expect, it } from "bun:test";
import {
	analyzeAuthError,
	discoverOAuthEndpoints,
	extractMcpAuthServerUrl,
} from "@oh-my-pi/pi-coding-agent/mcp/oauth-discovery";

describe("mcp oauth discovery", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("extracts Mcp-Auth-Server from transport error headers", () => {
		const error = new Error(
			'HTTP 401: unauthorized [WWW-Authenticate: Bearer resource_metadata="https://mcp.figma.com/.well-known/oauth-protected-resource"; Mcp-Auth-Server: https://www.figma.com]',
		);

		expect(extractMcpAuthServerUrl(error)).toBe("https://www.figma.com/");
		const auth = analyzeAuthError(error);
		expect(auth.requiresAuth).toBe(true);
		expect(auth.authServerUrl).toBe("https://www.figma.com/");
	});

	it("discovers oauth endpoints from auth server metadata", async () => {
		const calls: string[] = [];
		globalThis.fetch = (async (input: string | URL | Request) => {
			const url = String(input);
			calls.push(url);

			if (url === "https://www.figma.com/.well-known/oauth-authorization-server") {
				return new Response(
					JSON.stringify({
						authorization_endpoint: "https://www.figma.com/oauth",
						token_endpoint: "https://api.figma.com/v1/oauth/token",
						client_id: "figma-client-id",
						scopes_supported: ["file_read", "file_write"],
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}

			return new Response("not found", { status: 404 });
		}) as typeof fetch;

		const oauth = await discoverOAuthEndpoints("https://mcp.figma.com/mcp", "https://www.figma.com");

		expect(oauth).toEqual({
			authorizationUrl: "https://www.figma.com/oauth",
			tokenUrl: "https://api.figma.com/v1/oauth/token",
			clientId: "figma-client-id",
			scopes: "file_read file_write",
		});
		expect(calls[0]).toBe("https://www.figma.com/.well-known/oauth-authorization-server");
	});
});
