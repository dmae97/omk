import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyPatch, parsePatch } from "diff";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

const [patch] = parsePatch(
	readFileSync(fileURLToPath(new URL("../resources/native-skill-optimizer/3.1.2.patch", import.meta.url)), "utf8"),
);
const originalLines: string[] = [];
for (const hunk of patch.hunks) {
	while (originalLines.length < hunk.oldStart - 1) originalLines.push("");
	for (const line of hunk.lines) {
		if (line.startsWith(" ") || line.startsWith("-")) originalLines.push(line.slice(1));
	}
}
const original = `${originalLines.join("\n")}\n`;
const repaired = applyPatch(original, patch, { fuzzFactor: 0 });

interface InstallerCommands {
	runNpmCommand(args: string[], options?: { cwd?: string }): Promise<void>;
	runCommand(command: string, args: string[], options?: { cwd?: string }): Promise<void>;
}

describe("native skill optimizer reinstall repairs", () => {
	let root: string;
	let packageDir: string;
	let manager: DefaultPackageManager;
	let settings: SettingsManager;

	function fixture(directory = packageDir, version = "3.1.2"): string {
		const path = join(directory, "src/persistence.ts");
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(
			join(directory, "package.json"),
			JSON.stringify({ name: "@aeondave/pi-skill-optimizer", version, omk: {} }),
		);
		writeFileSync(path, original);
		return path;
	}

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "omk-optimizer-repair-"));
		packageDir = join(root, "optimizer");
		settings = SettingsManager.inMemory();
		manager = new DefaultPackageManager({ cwd: root, agentDir: join(root, "agent"), settingsManager: settings });
		expect(repaired).not.toBe(false);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		rmSync(root, { recursive: true, force: true });
	});

	it("repairs a local install, leaves a repaired file unchanged and repairs fresh replacement", async () => {
		const path = fixture();
		await manager.install(packageDir, { local: true });
		expect(readFileSync(path, "utf8")).toBe(repaired);
		await manager.install(packageDir, { local: true });
		expect(readFileSync(path, "utf8")).toBe(repaired);
		fixture();
		await manager.install(packageDir, { local: true });
		expect(readFileSync(path, "utf8")).toBe(repaired);
	});

	it.each([{ pi: {} }, { omk: null }, { omk: [] }, { omk: "legacy" }])(
		"does not convert a non-native manifest (%j)",
		async (fields) => {
			const path = fixture();
			writeFileSync(
				join(packageDir, "package.json"),
				JSON.stringify({ name: "@aeondave/pi-skill-optimizer", version: "3.1.2", ...fields }),
			);
			await manager.install(packageDir, { local: true });
			expect(readFileSync(path, "utf8")).toBe(original);
		},
	);

	it("fails closed on an unreviewed optimizer version", async () => {
		const path = fixture(packageDir, "3.1.3");
		await expect(manager.install(packageDir, { local: true })).rejects.toThrow(
			/Unsupported native @aeondave\/pi-skill-optimizer/,
		);
		expect(readFileSync(path, "utf8")).toBe(original);
	});

	it("rejects source drift instead of overwriting it", async () => {
		const path = fixture();
		writeFileSync(path, "unexpected implementation\n");
		await expect(manager.install(packageDir, { local: true })).rejects.toThrow(
			/Native skill optimizer repair does not match/,
		);
		expect(readFileSync(path, "utf8")).toBe("unexpected implementation\n");
	});

	it("does not write through an escaping source symlink", async () => {
		const path = fixture();
		const outside = join(root, "outside.ts");
		writeFileSync(outside, original);
		rmSync(path);
		symlinkSync(outside, path);
		await expect(manager.install(packageDir, { local: true })).rejects.toThrow(
			/Unsafe native skill optimizer repair path/,
		);
		expect(readFileSync(outside, "utf8")).toBe(original);
	});

	it("repairs a managed npm install after npm replacement", async () => {
		const installed = join(root, "agent/npm/node_modules/@aeondave/pi-skill-optimizer");
		const path = fixture(installed);
		vi.spyOn(manager as unknown as InstallerCommands, "runNpmCommand").mockResolvedValue();
		await manager.install("npm:@aeondave/pi-skill-optimizer@3.1.2");
		expect(readFileSync(path, "utf8")).toBe(repaired);
	});

	it("repairs npm batch updates through the existing installer hook", async () => {
		const installed = join(root, "agent/npm/node_modules/@aeondave/pi-skill-optimizer");
		const path = fixture(installed);
		settings.setPackages(["npm:@aeondave/pi-skill-optimizer"]);
		vi.spyOn(manager as unknown as InstallerCommands, "runNpmCommand").mockResolvedValue();
		await manager.update();
		expect(readFileSync(path, "utf8")).toBe(repaired);
	});

	it("repairs a new native git checkout", async () => {
		let path = "";
		vi.spyOn(manager as unknown as InstallerCommands, "runCommand").mockImplementation(async (_command, args) => {
			if (args[0] === "clone") path = fixture(args.at(-1));
		});
		await manager.install("git:github.com/example/native-optimizer");
		expect(path).not.toBe("");
		expect(readFileSync(path, "utf8")).toBe(repaired);
	});
});
