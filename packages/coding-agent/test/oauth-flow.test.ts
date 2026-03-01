import { afterEach, describe, expect, it } from "bun:test";
import { MCPOAuthFlow } from "@oh-my-pi/pi-coding-agent/mcp/oauth-flow";

describe("mcp oauth flow", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("uses Codex client name for dynamic client registration", async () => {
		let registrationPayload: Record<string, unknown> | null = null;

		globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			if (url === "https://www.figma.com/.well-known/oauth-authorization-server") {
				return new Response(
					JSON.stringify({ registration_endpoint: "https://api.figma.com/v1/oauth/mcp/register" }),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}

			if (url === "https://api.figma.com/v1/oauth/mcp/register") {
				registrationPayload = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
				return new Response(
					JSON.stringify({
						client_id: "registered-client-id",
						client_secret: "registered-client-secret",
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}

			return new Response("not found", { status: 404 });
		}) as typeof fetch;

		const flow = new MCPOAuthFlow(
			{
				authorizationUrl: "https://www.figma.com/oauth/mcp",
				tokenUrl: "https://api.figma.com/v1/oauth/token",
			},
			{},
		);

		const { url } = await flow.generateAuthUrl("test-state", "http://127.0.0.1:53172/callback");
		const authUrl = new URL(url);

		expect(registrationPayload).not.toBeNull();
		expect((registrationPayload as { client_name?: string } | null)?.client_name).toBe("Codex");
		expect(authUrl.searchParams.get("client_id")).toBe("registered-client-id");
		expect(authUrl.searchParams.get("state")).toBe("test-state");
	});
});
