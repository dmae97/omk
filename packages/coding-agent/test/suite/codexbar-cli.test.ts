import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type CodexBarQuotaCommandDeps,
	type CodexBarQuotaSpawnResult,
	handleCodexBarQuotaCommand,
	parseCodexBarQuotaCommand,
} from "../../src/codexbar-cli.ts";

type TestFixture = {
	readonly stdout: string[];
	readonly stderr: string[];
	readonly deps: CodexBarQuotaCommandDeps;
};

const TEST_AGENT_DIR = "/tmp/omk-test-agent";
const CONNECTOR_FILE_PATH = `${TEST_AGENT_DIR}/codexbar-connector.json`;

const ENABLED_CONNECTOR_JSON = JSON.stringify({
	codexbar: {
		enabled: true,
		privacyAck: 1,
		connectedAt: "2026-07-07T00:00:00.000Z",
	},
});

describe("codexbar quota CLI", () => {
	beforeEach(() => {
		process.exitCode = undefined;
	});

	it("recognizes quota connect codexbar", () => {
		// Given / When
		const command = parseCodexBarQuotaCommand(["quota", "connect", "codexbar"]);

		// Then
		expect(command).toEqual({ kind: "connect" });
	});

	it("recognizes quota status provider json flags", () => {
		// Given / When
		const command = parseCodexBarQuotaCommand(["quota", "status", "--provider", "codex", "--json"]);

		// Then
		expect(command).toEqual({ kind: "run", metric: "usage", provider: "codex", json: true });
	});

	it("rejects forbidden and unknown quota arguments", () => {
		// Given / When
		const forbidden = parseCodexBarQuotaCommand(["quota", "serve"]);
		const unknownFlag = parseCodexBarQuotaCommand(["quota", "status", "--web-debug-dump-html"]);

		// Then
		expect(forbidden).toEqual({ kind: "error", message: "Unexpected quota command." });
		expect(unknownFlag).toEqual({ kind: "error", message: "Unknown option for quota command." });
	});

	it("requires opt-in before status", async () => {
		// Given
		const fixture = createFixture({ exists: () => false });

		// When
		const handled = await handleCodexBarQuotaCommand(["quota", "status"], fixture.deps);

		// Then
		expect(handled).toBe(true);
		expect(process.exitCode).toBe(1);
		expect(fixture.stderr.join("")).toContain("quota connect codexbar");
	});

	it("maps missing CodexBar binary to exit code 2", async () => {
		// Given
		const fixture = createFixture({ ensure: async () => undefined });

		// When
		const handled = await handleCodexBarQuotaCommand(["quota", "status"], fixture.deps);

		// Then
		expect(handled).toBe(true);
		expect(process.exitCode).toBe(2);
		expect(fixture.stderr.join("")).toContain("Install codexbar on PATH");
	});

	it("prints redacted usage JSON without spawning a real binary", async () => {
		// Given
		let spawnedArgs: readonly string[] = [];
		const fixture = createFixture({
			spawn: (_command, args) => {
				spawnedArgs = args;
				return successfulSpawn(sampleUsageStdout());
			},
		});

		// When
		const handled = await handleCodexBarQuotaCommand(
			["quota", "status", "--provider", "codex", "--json"],
			fixture.deps,
		);

		// Then
		expect(handled).toBe(true);
		expect(process.exitCode).toBeUndefined();
		expect(spawnedArgs).toEqual(["--format", "json", "--provider", "codex"]);
		const output = fixture.stdout.join("");
		expect(output).toContain('"provider": "codex"');
		expect(output).toContain('"usedPercent": 42');
		expect(output).not.toContain("alice@example.com");
		expect(output).not.toContain("/Users/alice/work");
	});

	it("prints safe usage text without email or paths", async () => {
		// Given
		const fixture = createFixture({ spawn: () => successfulSpawn(sampleUsageStdout()) });

		// When
		const handled = await handleCodexBarQuotaCommand(["quota", "usage"], fixture.deps);

		// Then
		expect(handled).toBe(true);
		expect(process.exitCode).toBeUndefined();
		const output = fixture.stdout.join("");
		expect(output).toContain("CodexBar usage");
		expect(output).toContain("Primary: 42% used");
		expect(output).not.toContain("alice@example.com");
		expect(output).not.toContain("/Users/alice/work");
	});
});

describe("codexbar quota CLI connector opt-in (C1)", () => {
	beforeEach(() => {
		process.exitCode = undefined;
	});

	it("connect writes only enabled, privacyAck, and connectedAt without credential fields", async () => {
		let writtenPath = "";
		let writtenBody = "";
		const mkdir = vi.fn();
		const fixture = createFixture({
			mkdir,
			write: (path, value) => {
				writtenPath = path;
				writtenBody = value;
			},
		});

		const handled = await handleCodexBarQuotaCommand(["quota", "connect", "codexbar"], fixture.deps);

		expect(handled).toBe(true);
		expect(mkdir).toHaveBeenCalledWith(TEST_AGENT_DIR);
		expect(writtenPath).toBe(CONNECTOR_FILE_PATH);
		const parsed = JSON.parse(writtenBody) as { codexbar: Record<string, unknown> };
		expect(Object.keys(parsed.codexbar).sort()).toEqual(["connectedAt", "enabled", "privacyAck"]);
		expect(parsed.codexbar.enabled).toBe(true);
		expect(parsed.codexbar.privacyAck).toBe(1);
		expect(typeof parsed.codexbar.connectedAt).toBe("string");
		expect(writtenBody).not.toMatch(/apiKey|api_key|secret|token/i);
	});

	it("treats connector as disabled when acknowledgement file is missing", async () => {
		let spawned = false;
		const fixture = createFixture({
			exists: () => false,
			spawn: () => {
				spawned = true;
				return successfulSpawn(sampleUsageStdout());
			},
		});

		await handleCodexBarQuotaCommand(["quota", "status"], fixture.deps);

		expect(spawned).toBe(false);
		expect(process.exitCode).toBe(1);
	});

	it("treats connector as disabled when privacyAck version mismatches", async () => {
		let spawned = false;
		const wrongAck = JSON.stringify({
			codexbar: { enabled: true, privacyAck: 0, connectedAt: "2026-07-07T00:00:00.000Z" },
		});
		const fixture = createFixture({
			read: () => wrongAck,
			spawn: () => {
				spawned = true;
				return successfulSpawn(sampleUsageStdout());
			},
		});

		await handleCodexBarQuotaCommand(["quota", "usage"], fixture.deps);

		expect(spawned).toBe(false);
		expect(process.exitCode).toBe(1);
	});

	it("disconnect removes local opt-in acknowledgement", async () => {
		let removedPath = "";
		const fixture = createFixture({
			remove: (path) => {
				removedPath = path;
			},
		});

		const handled = await handleCodexBarQuotaCommand(["quota", "disconnect", "codexbar"], fixture.deps);

		expect(handled).toBe(true);
		expect(removedPath).toBe(CONNECTOR_FILE_PATH);
	});

	it("refuses status with exit code 1 when opt-in is false", async () => {
		const fixture = createFixture({ exists: () => false });

		await handleCodexBarQuotaCommand(["quota", "status"], fixture.deps);

		expect(process.exitCode).toBe(1);
		const err = fixture.stderr.join("");
		expect(err).toContain("not enabled");
		expect(err).toContain("quota connect codexbar");
	});
});

function createFixture(overrides: CodexBarQuotaCommandDeps = {}): TestFixture {
	const stdout: string[] = [];
	const stderr: string[] = [];
	const deps: CodexBarQuotaCommandDeps = {
		getAgentDir: () => TEST_AGENT_DIR,
		exists: () => true,
		read: () => ENABLED_CONNECTOR_JSON,
		write: () => {},
		mkdir: () => {},
		remove: () => {},
		ensure: async () => "codexbar",
		spawn: () => successfulSpawn(sampleUsageStdout()),
		stdout: (text) => {
			stdout.push(text);
		},
		stderr: (text) => {
			stderr.push(text);
		},
		...overrides,
	};
	return { stdout, stderr, deps };
}

function successfulSpawn(stdout: string): CodexBarQuotaSpawnResult {
	return {
		stdout,
		status: 0,
		signal: null,
	};
}

function sampleUsageStdout(): string {
	return JSON.stringify({
		provider: "codex",
		source: "web",
		usage: {
			updatedAt: "2026-07-07T01:02:03Z",
			primary: {
				usedPercent: 42,
				resetsAt: "2026-07-07T12:00:00Z",
			},
			secondary: {
				usedPercent: 7,
				resetsAt: "2026-07-08T12:00:00Z",
			},
			accountEmail: "alice@example.com",
			projects: [{ path: "/Users/alice/work/private-project" }],
		},
		credits: {
			remaining: 123.45,
		},
		status: {
			indicator: "ok",
			description: "Operational",
			url: "https://status.openai.com",
		},
	});
}
