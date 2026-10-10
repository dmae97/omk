import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Spec 024: main() routes package words with cli/package-commands.ts and only then
// imports package-manager-cli.ts. These tests go through main() itself, so a static
// import or a routing change in main.ts fails here, not only in the word list.
const loaded = {
	packageManagerCli: 0,
	packageDoctorCli: 0,
	packageArgs: [] as string[][],
	configArgs: [] as string[][],
};

// vi.doMock after vi.resetModules() so every test sees a fresh module graph and
// each factory runs once per load of its module.
function mockPackageDoctorCli(): void {
	// The real doctor runs, so `package doctor` keeps its usage exit code.
	vi.doMock("../src/commands/package-doctor-cli.ts", async (importOriginal) => {
		loaded.packageDoctorCli += 1;
		return await importOriginal();
	});
}

function mockPackageManagerCli(): void {
	vi.doMock("../src/package-manager-cli.ts", () => {
		loaded.packageManagerCli += 1;
		return {
			handlePackageCommand: async (args: string[]) => {
				loaded.packageArgs.push(args);
				return args[0] !== "config";
			},
			handleConfigCommand: async (args: string[]) => {
				loaded.configArgs.push(args);
				return true;
			},
		};
	});
}

describe("main() package command routing", () => {
	let originalExitCode: typeof process.exitCode;

	beforeEach(() => {
		vi.resetModules();
		mockPackageManagerCli();
		mockPackageDoctorCli();
		loaded.packageManagerCli = 0;
		loaded.packageDoctorCli = 0;
		loaded.packageArgs = [];
		loaded.configArgs = [];
		originalExitCode = process.exitCode;
		process.exitCode = undefined;
	});

	afterEach(() => {
		vi.doUnmock("../src/package-manager-cli.ts");
		vi.doUnmock("../src/commands/package-doctor-cli.ts");
		process.exitCode = originalExitCode;
	});

	async function runMain(args: string[]): Promise<void> {
		const { main } = await import("../src/main.ts");
		await main(args);
	}

	it("loads neither package CLI module when main.ts is imported", async () => {
		await import("../src/main.ts");
		expect(loaded.packageManagerCli).toBe(0);
		expect(loaded.packageDoctorCli).toBe(0);
	});

	it("loads only package-doctor-cli for package doctor", async () => {
		await runMain(["package", "doctor"]);
		expect(process.exitCode).toBe(2);
		expect(loaded.packageDoctorCli).toBe(1);
		expect(loaded.packageManagerCli).toBe(0);
	});

	it.each([["install"], ["uninstall"], ["list"]])("hands %s to package-manager-cli", async (word) => {
		const args = [word, "npm:example"];
		await runMain(args);
		expect(loaded.packageManagerCli).toBe(1);
		expect(loaded.packageArgs).toEqual([args]);
		expect(loaded.configArgs).toEqual([]);
		expect(loaded.packageDoctorCli).toBe(0);
	});

	it("hands config to package-manager-cli's config handler", async () => {
		await runMain(["config"]);
		expect(loaded.packageManagerCli).toBe(1);
		expect(loaded.packageArgs).toEqual([["config"]]);
		expect(loaded.configArgs).toEqual([["config"]]);
	});
});
