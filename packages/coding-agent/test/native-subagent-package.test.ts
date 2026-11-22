import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyPatch, parsePatch } from "diff";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

const patches = parsePatch(
	readFileSync(fileURLToPath(new URL("../resources/native-subagents/0.78.0.patch", import.meta.url)), "utf8"),
);

// Only the public patch contexts are fixtures; runner execution is tested separately.
function originalSource(patch: (typeof patches)[number]): string {
	const lines: string[] = [];
	for (const hunk of patch.hunks) {
		while (lines.length < hunk.oldStart - 1) lines.push("");
		for (const line of hunk.lines) {
			if (line.startsWith(" ") || line.startsWith("-")) lines.push(line.slice(1));
		}
	}
	return `${lines.join("\n")}\n`;
}

function fixture(root: string, version = "0.78.0", native = true): Map<string, string> {
	mkdirSync(root, { recursive: true });
	writeFileSync(
		join(root, "package.json"),
		JSON.stringify({ name: "pi-subagents", version, [native ? "omk" : "pi"]: { extensions: ["./index.js"] } }),
	);
	writeFileSync(join(root, "index.js"), "export default () => {};\n");
	const originals = new Map<string, string>();
	for (const patch of patches) {
		const path = join(root, patch.oldFileName!);
		mkdirSync(dirname(path), { recursive: true });
		const text = originalSource(patch);
		writeFileSync(path, text);
		originals.set(path, text);
	}
	return originals;
}

interface InstallerCommands {
	runNpmCommand(args: string[], options?: { cwd?: string }): Promise<void>;
	runCommand(command: string, args: string[], options?: { cwd?: string }): Promise<void>;
}

describe("native subagent package repairs", () => {
	let root: string;
	let packageDir: string;
	let manager: DefaultPackageManager;
	let settings: SettingsManager;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "omk-subagent-repair-"));
		packageDir = join(root, "native-subagents");
		settings = SettingsManager.inMemory();
		manager = new DefaultPackageManager({ cwd: root, agentDir: join(root, "agent"), settingsManager: settings });
	});

	afterEach(() => {
		vi.restoreAllMocks();
		rmSync(root, { recursive: true, force: true });
	});

	function expectRepaired(originals: Map<string, string>): void {
		for (const [path, original] of originals) {
			const patch = patches.find((entry) => path.endsWith(entry.oldFileName!));
			expect(patch).toBeDefined();
			const expected = applyPatch(original, patch!);
			expect(expected).not.toBe(false);
			expect(readFileSync(path, "utf8")).toBe(expected);
		}
	}

	it("repairs all four native consumer files on local installation", async () => {
		const originals = fixture(packageDir);
		await manager.install(packageDir, { local: true });
		expectRepaired(originals);
	});

	it("keeps an already repaired package byte-identical and repairs a fresh reinstall", async () => {
		const originals = fixture(packageDir);
		await manager.install(packageDir, { local: true });
		const repaired = [...originals.keys()].map((path) => readFileSync(path, "utf8"));
		await manager.install(packageDir, { local: true });
		expect([...originals.keys()].map((path) => readFileSync(path, "utf8"))).toEqual(repaired);
		fixture(packageDir);
		await manager.install(packageDir, { local: true });
		expectRepaired(originals);
	});

	it("leaves a legacy Pi-only manifest unchanged", async () => {
		const originals = fixture(packageDir, "0.78.0", false);
		await manager.install(packageDir, { local: true });
		for (const [path, original] of originals) expect(readFileSync(path, "utf8")).toBe(original);
	});

	it("does not modify unrelated native packages", async () => {
		const originals = fixture(packageDir);
		writeFileSync(
			join(packageDir, "package.json"),
			JSON.stringify({ name: "different", version: "0.78.0", omk: {} }),
		);
		await manager.install(packageDir, { local: true });
		for (const [path, original] of originals) expect(readFileSync(path, "utf8")).toBe(original);
	});

	it("rejects unknown native versions without changing source files", async () => {
		const originals = fixture(packageDir, "0.79.0");
		await expect(manager.install(packageDir, { local: true })).rejects.toThrow(/Unsupported native pi-subagents/);
		for (const [path, original] of originals) expect(readFileSync(path, "utf8")).toBe(original);
	});

	it("preflights every file and rejects drift before writing any source", async () => {
		const originals = fixture(packageDir);
		const path = join(packageDir, patches.at(-1)!.oldFileName!);
		writeFileSync(path, "unexpected source\n");
		originals.set(path, "unexpected source\n");
		await expect(manager.install(packageDir, { local: true })).rejects.toThrow(
			/Native subagent repair does not match/,
		);
		for (const [file, original] of originals) expect(readFileSync(file, "utf8")).toBe(original);
	});

	it("does not follow a source symlink outside the selected package", async () => {
		fixture(packageDir);
		const path = join(packageDir, patches.at(-1)!.oldFileName!);
		const outside = join(root, "outside.js");
		writeFileSync(outside, readFileSync(path));
		rmSync(path);
		symlinkSync(outside, path);
		await expect(manager.install(packageDir, { local: true })).rejects.toThrow(/Unsafe native subagent repair path/);
		expect(readFileSync(outside, "utf8")).toBe(originalSource(patches.at(-1)!));
	});

	it("repairs a managed npm install after npm finishes", async () => {
		const installed = join(root, "agent", "npm", "node_modules", "pi-subagents");
		const originals = fixture(installed);
		vi.spyOn(manager as unknown as InstallerCommands, "runNpmCommand").mockResolvedValue();
		await manager.install("npm:pi-subagents@0.78.0");
		expectRepaired(originals);
	});

	it("repairs a configured npm batch update after replacement", async () => {
		const installed = join(root, "agent", "npm", "node_modules", "pi-subagents");
		const originals = fixture(installed);
		settings.setPackages(["npm:pi-subagents"]);
		vi.spyOn(manager as unknown as InstallerCommands, "runNpmCommand").mockResolvedValue();
		await manager.update();
		expectRepaired(originals);
	});

	it("repairs a new git installation without running package lifecycle scripts", async () => {
		let originals = new Map<string, string>();
		vi.spyOn(manager as unknown as InstallerCommands, "runCommand").mockImplementation(async (_command, args) => {
			if (args[0] === "clone") originals = fixture(args.at(-1)!);
		});
		await manager.install("git:github.com/example/native-subagents");
		expect(originals.size).toBe(4);
		expectRepaired(originals);
	});
});
