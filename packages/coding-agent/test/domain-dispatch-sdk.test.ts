import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "omk-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseArgs } from "../src/cli/args.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import {
	createLoadoutAccessPolicy,
	decideLoadoutAccess,
	type LoadoutAccessPolicy,
} from "../src/core/loadout-access-policy.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createTestResourceLoader } from "./utilities.ts";

vi.mock("../src/core/mcp-inventory.ts", () => ({
	loadMcpInventory: () => ({
		entries: [
			{ name: "filesystem", source: "/project/.omk/mcp.json", commandSummary: "filesystem", envKeys: [] },
			{ name: "context7", source: "/project/.omk/mcp.json", commandSummary: "context7", envKeys: [] },
			{ name: "memory", source: "/project/.omk/mcp.json", commandSummary: "memory", envKeys: [] },
		],
		presets: [],
		sources: [],
		errors: [],
	}),
}));

const tempDirs: string[] = [];
let originalDomainRouting: string | undefined;

function createTempDir(): string {
	const dir = join(tmpdir(), `omk-domain-dispatch-sdk-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	tempDirs.push(dir);
	return dir;
}

beforeEach(() => {
	originalDomainRouting = process.env.OMK_DOMAIN_ROUTING;
	delete process.env.OMK_DOMAIN_ROUTING;
});

afterEach(() => {
	if (originalDomainRouting === undefined) {
		delete process.env.OMK_DOMAIN_ROUTING;
	} else {
		process.env.OMK_DOMAIN_ROUTING = originalDomainRouting;
	}
	for (const dir of tempDirs.splice(0, tempDirs.length)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

async function createTestSdkSession(
	overrides: Omit<Parameters<typeof createAgentSession>[0], "cwd" | "agentDir"> = {},
) {
	const cwd = createTempDir();
	return createAgentSession({
		cwd,
		agentDir: cwd,
		model: getModel("anthropic", "claude-sonnet-4-5")!,
		sessionManager: SessionManager.inMemory(),
		settingsManager: SettingsManager.create(cwd, cwd),
		modelRegistry: ModelRegistry.inMemory(AuthStorage.inMemory()),
		resourceLoader: createTestResourceLoader(),
		...overrides,
	});
}

describe("createAgentSession domain dispatch wiring", () => {
	it("default on: the routed loadout replaces the plain default tool set", async () => {
		const { session } = await createTestSdkSession({
			domainRoutingPrompt: "Implement a responsive frontend UI component",
		});
		try {
			expect(session.getActiveToolNames()).not.toEqual(["read", "bash", "edit", "write", "diagnostics"]);
		} finally {
			session.dispose();
		}
	});

	it("OMK_DOMAIN_ROUTING=0 keeps the old tool set and leaves active tools mutable", async () => {
		process.env.OMK_DOMAIN_ROUTING = "0";
		const { session } = await createTestSdkSession({
			domainRoutingPrompt: "Implement a responsive frontend UI component",
		});
		try {
			expect(session.getActiveToolNames()).toEqual(["read", "bash", "edit", "write", "diagnostics"]);
			expect(() => session.setActiveToolsByName(["read"])).not.toThrow();
			expect(session.getActiveToolNames()).toEqual(["read"]);
		} finally {
			session.dispose();
		}
	});

	it("locks active tools to the routed policy when opt-in and prompt hint are provided", async () => {
		process.env.OMK_DOMAIN_ROUTING = "1";

		const { session } = await createTestSdkSession({
			domainRoutingPrompt: "Implement a responsive frontend UI component with Tailwind CSS",
		});
		try {
			expect(session.getActiveToolNames()).toEqual(["bash", "edit", "find", "grep", "ls", "read", "write"]);
			expect(() => session.setActiveToolsByName(["read"])).toThrow(/loadout active tools are locked/);
		} finally {
			session.dispose();
		}
	});

	it("preserves an explicit loadoutAccessPolicy over opt-in domain dispatch", async () => {
		process.env.OMK_DOMAIN_ROUTING = "1";
		const cwd = createTempDir();
		const explicitPolicy = createLoadoutAccessPolicy({
			cwd,
			activeTools: ["read"],
			readSet: [{ path: "." }],
			writeSet: [],
			commands: { mode: "none" },
		});

		const { session } = await createAgentSession({
			cwd,
			agentDir: cwd,
			model: getModel("anthropic", "claude-sonnet-4-5")!,
			sessionManager: SessionManager.inMemory(),
			settingsManager: SettingsManager.create(cwd, cwd),
			modelRegistry: ModelRegistry.inMemory(AuthStorage.inMemory()),
			resourceLoader: createTestResourceLoader(),
			domainRoutingPrompt: "Implement a responsive frontend UI component with Tailwind CSS",
			loadoutAccessPolicy: explicitPolicy,
		});
		try {
			expect(session.getActiveToolNames()).toEqual(["read"]);
			expect(() => session.setActiveToolsByName(["bash", "read"])).toThrow(/loadout active tools are locked/);
		} finally {
			session.dispose();
		}
	});

	it("enforces CLI read/write/execute scope through the routed SDK session", async () => {
		const parsed = parseArgs([
			"--read-scope",
			"README.md",
			"--write-scope",
			"src",
			"--exec-scope",
			"npm test",
			"Implement a responsive frontend UI component",
		]);
		const { session } = await createTestSdkSession({
			domainRoutingPrompt: parsed.messages.join("\n"),
			domainScopeHints: parsed.scopeHints,
		});
		try {
			const policy = (session as unknown as { _loadoutAccessPolicy: LoadoutAccessPolicy })._loadoutAccessPolicy;
			expect(decideLoadoutAccess(policy, { operation: "read", toolName: "read", path: "README.md" }).allowed).toBe(
				true,
			);
			expect(
				decideLoadoutAccess(policy, { operation: "write", toolName: "write", path: "src/Button.tsx" }).allowed,
			).toBe(true);
			expect(
				decideLoadoutAccess(policy, { operation: "execute", toolName: "bash", command: "npm test" }).allowed,
			).toBe(true);
			expect(
				decideLoadoutAccess(policy, { operation: "write", toolName: "write", path: "outside.txt" }).allowed,
			).toBe(false);
			expect(
				decideLoadoutAccess(policy, { operation: "execute", toolName: "bash", command: "rm -rf src" }).allowed,
			).toBe(false);
		} finally {
			session.dispose();
		}
	});

	it("fails closed when explicit scope cannot be routed", async () => {
		process.env.OMK_DOMAIN_ROUTING = "0";
		await expect(
			createTestSdkSession({ domainRoutingPrompt: "edit", domainScopeHints: { writeScope: ["src"] } }),
		).rejects.toThrow(/requires OMK_DOMAIN_ROUTING/);
	});

	it("does nothing when opt-in is enabled without a routing prompt hint", async () => {
		process.env.OMK_DOMAIN_ROUTING = "1";

		const { session } = await createTestSdkSession();
		try {
			expect(session.getActiveToolNames()).toEqual(["read", "bash", "edit", "write", "diagnostics"]);
			expect(() => session.setActiveToolsByName(["read"])).not.toThrow();
		} finally {
			session.dispose();
		}
	});
});
