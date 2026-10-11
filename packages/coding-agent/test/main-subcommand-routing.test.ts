import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isQuotaCommand, mayBeRunCommand, RUN_COMMAND_WORDS } from "../src/cli/subcommand-words.ts";

// Spec 043: main() routes subcommand words with cli/subcommand-words.ts and only then
// imports commands/run-command.ts or codexbar-cli.ts. runCommand() applies the same
// check, so the real-handler table below fails if a handler answers a word the gate
// does not know.
const WORKER_ARGV = [
	"--mode",
	"json",
	"-p",
	"--no-session",
	"--model",
	"mockprov/mock-model",
	"--append-system-prompt",
	"/tmp/prompt-worker.md",
	"Task: run stats and doctor, then reply",
];

describe("subcommand words", () => {
	it("leaves the worker argv and plain prompts to main()", () => {
		expect(mayBeRunCommand(WORKER_ARGV)).toBe(false);
		expect(mayBeRunCommand(["-p", "run the tests"])).toBe(false);
		expect(mayBeRunCommand(["fix the doctor command"])).toBe(false);
		expect(mayBeRunCommand([])).toBe(false);
		expect(isQuotaCommand(WORKER_ARGV)).toBe(false);
		expect(isQuotaCommand(["-p", "quota"])).toBe(false);
	});

	it("claims every handler word and the legacy --doctor-provider flag anywhere", () => {
		for (const word of RUN_COMMAND_WORDS) expect(mayBeRunCommand([word])).toBe(true);
		expect(mayBeRunCommand(["--offline", "--doctor-provider", "openai"])).toBe(true);
		expect(isQuotaCommand(["quota", "status"])).toBe(true);
	});
});

describe("runCommand() handlers stay behind the gate", () => {
	let originalExitCode: typeof process.exitCode;

	beforeEach(() => {
		originalExitCode = process.exitCode;
		vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		process.exitCode = originalExitCode;
	});

	it.each([
		[["provider", "adopt", "--help"]],
		[["provider", "sync", "--help"]],
		[["provider", "doctor", "--help"]],
		[["--doctor-provider"]],
		[["run", "--help"]],
		[["session", "doctor", "--help"]],
		[["doctor", "resources", "--help"]],
		[["doctor", "adaptorch", "--help"]],
		[["doctor", "--help"]],
		[["stats", "--help"]],
		[["sdk", "session", "--help"]],
		[["router-feedback", "--help"]],
	])("%j is handled and passes the gate", async (args) => {
		const { runCommand } = await import("../src/commands/run-command.ts");
		expect(mayBeRunCommand(args)).toBe(true);
		expect((await runCommand(args)).handled).toBe(true);
	});

	it("does not handle the worker argv", async () => {
		const { runCommand } = await import("../src/commands/run-command.ts");
		expect(await runCommand(WORKER_ARGV)).toEqual({ handled: false, exitCode: 0 });
	});
});

const loaded = { runCommand: 0, quota: 0, runArgs: [] as string[][], quotaArgs: [] as string[][] };

describe("main() subcommand routing", () => {
	let originalExitCode: typeof process.exitCode;

	beforeEach(() => {
		vi.resetModules();
		loaded.runCommand = 0;
		loaded.quota = 0;
		loaded.runArgs = [];
		loaded.quotaArgs = [];
		vi.doMock("../src/commands/run-command.ts", () => {
			loaded.runCommand += 1;
			return {
				runCommand: async (args: string[]) => {
					loaded.runArgs.push(args);
					return { handled: true, exitCode: 7 };
				},
			};
		});
		vi.doMock("../src/codexbar-cli.ts", () => {
			loaded.quota += 1;
			return {
				handleCodexBarQuotaCommand: async (args: string[]) => {
					loaded.quotaArgs.push(args);
					return true;
				},
			};
		});
		originalExitCode = process.exitCode;
		process.exitCode = undefined;
	});

	afterEach(() => {
		vi.doUnmock("../src/commands/run-command.ts");
		vi.doUnmock("../src/codexbar-cli.ts");
		process.exitCode = originalExitCode;
	});

	it("loads neither handler module when main.ts is imported", async () => {
		await import("../src/main.ts");
		expect(loaded).toMatchObject({ runCommand: 0, quota: 0 });
	});

	it.each([[["stats", "--json"]], [["doctor", "resources"]], [["--offline", "--doctor-provider", "openai"]]])(
		"hands %j to runCommand with the original argv",
		async (args) => {
			const { main } = await import("../src/main.ts");
			await main(args);
			expect(loaded.runCommand).toBe(1);
			expect(loaded.runArgs).toEqual([args]);
			expect(process.exitCode).toBe(7);
			expect(loaded.quota).toBe(0);
		},
	);

	it("hands quota to codexbar-cli only", async () => {
		const { main } = await import("../src/main.ts");
		await main(["quota", "status"]);
		expect(loaded.quota).toBe(1);
		expect(loaded.quotaArgs).toEqual([["quota", "status"]]);
		expect(loaded.runCommand).toBe(0);
	});
});
