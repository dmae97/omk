import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { mcpCapability, type MCPServer } from "@oh-my-pi/pi-coding-agent/capability/mcp";
import { loadCapability } from "@oh-my-pi/pi-coding-agent/discovery";

async function loadStandaloneMcpConfig(cwd: string): Promise<MCPServer[]> {
	const result = await loadCapability<MCPServer>(mcpCapability.id, {
		cwd,
		providers: ["mcp-json"],
	});
	return result.items;
}

describe("standalone mcp.json oauth env expansion", () => {
	let tempDir = "";
	const originalEnv = {
		PI_OAUTH_TOKEN_URL: process.env.PI_OAUTH_TOKEN_URL,
		PI_OAUTH_CLIENT_ID: process.env.PI_OAUTH_CLIENT_ID,
		PI_OAUTH_CLIENT_SECRET: process.env.PI_OAUTH_CLIENT_SECRET,
		PI_OAUTH_REDIRECT_URI: process.env.PI_OAUTH_REDIRECT_URI,
		PI_OAUTH_CALLBACK_PATH: process.env.PI_OAUTH_CALLBACK_PATH,
		PI_MCP_HEADER: process.env.PI_MCP_HEADER,
		PI_MCP_URL: process.env.PI_MCP_URL,
		PI_MCP_ENV: process.env.PI_MCP_ENV,
	};

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-mcp-json-"));
		process.env.PI_OAUTH_TOKEN_URL = "https://provider.example/token";
		process.env.PI_OAUTH_CLIENT_ID = "oauth-client-id";
		process.env.PI_OAUTH_CLIENT_SECRET = "oauth-client-secret";
		process.env.PI_OAUTH_REDIRECT_URI = "https://public.example/oauth/callback";
		process.env.PI_OAUTH_CALLBACK_PATH = "/oauth/callback";
		process.env.PI_MCP_HEADER = "Bearer test-token";
		process.env.PI_MCP_URL = "https://mcp.example.com";
		process.env.PI_MCP_ENV = "env-value";
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
		for (const [key, value] of Object.entries(originalEnv)) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	});

	test("expands standalone auth and oauth fields alongside existing env-expanded fields", async () => {
		await fs.writeFile(
			path.join(tempDir, "mcp.json"),
			JSON.stringify({
				mcpServers: {
					figma: {
						url: "${PI_MCP_URL}/mcp",
						headers: { Authorization: "${PI_MCP_HEADER}" },
						env: { MCP_VALUE: "${PI_MCP_ENV}" },
						auth: {
							type: "oauth",
							tokenUrl: "${PI_OAUTH_TOKEN_URL}",
							clientId: "${PI_OAUTH_CLIENT_ID}",
							clientSecret: "${PI_OAUTH_CLIENT_SECRET}",
						},
						oauth: {
							clientId: "${PI_OAUTH_CLIENT_ID}",
							clientSecret: "${PI_OAUTH_CLIENT_SECRET}",
							redirectUri: "${PI_OAUTH_REDIRECT_URI}",
							callbackPort: 4317,
							callbackPath: "${PI_OAUTH_CALLBACK_PATH}",
						},
					},
				},
			}),
		);

		const [server] = await loadStandaloneMcpConfig(tempDir);
		expect(server).toBeDefined();
		expect(server?.url).toBe("https://mcp.example.com/mcp");
		expect(server?.headers).toEqual({ Authorization: "Bearer test-token" });
		expect(server?.env).toEqual({ MCP_VALUE: "env-value" });
		expect(server?.auth).toEqual({
			type: "oauth",
			tokenUrl: "https://provider.example/token",
			clientId: "oauth-client-id",
			clientSecret: "oauth-client-secret",
		});
		expect(server?.oauth).toEqual({
			clientId: "oauth-client-id",
			clientSecret: "oauth-client-secret",
			redirectUri: "https://public.example/oauth/callback",
			callbackPort: 4317,
			callbackPath: "/oauth/callback",
		});
	});

	test("expands only the standalone oauth fields that are present", async () => {
		await fs.writeFile(
			path.join(tempDir, ".mcp.json"),
			JSON.stringify({
				mcpServers: {
					slack: {
						url: "https://slack.example.com/mcp",
						oauth: {
							redirectUri: "${PI_OAUTH_REDIRECT_URI}",
							callbackPath: "${PI_OAUTH_CALLBACK_PATH}",
						},
					},
				},
			}),
		);

		const [server] = await loadStandaloneMcpConfig(tempDir);
		expect(server).toBeDefined();
		expect(server?.oauth).toEqual({
			redirectUri: "https://public.example/oauth/callback",
			callbackPath: "/oauth/callback",
		});
		expect(server?.auth).toBeUndefined();
	});
});
