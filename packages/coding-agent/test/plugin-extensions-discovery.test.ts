import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { discoverAndLoadExtensions } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/loader";
import { getAgentDir, setAgentDir, TempDir } from "@oh-my-pi/pi-utils";

describe("plugin extension discovery", () => {
	let projectDir: TempDir;
	let tempHomeDir = "";
	let originalHome: string | undefined;
	const originalAgentDir = getAgentDir();

	beforeEach(() => {
		projectDir = TempDir.createSync("@pi-plugin-ext-");
		originalHome = process.env.HOME;
		tempHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-plugin-home-"));
		process.env.HOME = tempHomeDir;
		setAgentDir(path.join(tempHomeDir, ".omp", "agent"));

		const pluginsDir = path.join(tempHomeDir, ".omp", "plugins");
		const pluginDir = path.join(pluginsDir, "node_modules", "@demo", "plugin");
		fs.mkdirSync(path.join(pluginDir, "dist"), { recursive: true });
		fs.writeFileSync(
			path.join(pluginsDir, "package.json"),
			JSON.stringify({
				name: "omp-plugins",
				private: true,
				dependencies: {
					"@demo/plugin": "1.0.0",
				},
			}),
		);
		fs.writeFileSync(
			path.join(pluginDir, "package.json"),
			JSON.stringify({
				name: "@demo/plugin",
				version: "1.0.0",
				omp: {
					extensions: ["./dist/extension.ts"],
				},
			}),
		);
		fs.writeFileSync(
			path.join(pluginDir, "dist", "extension.ts"),
			`
				export default function(pi) {
					pi.registerCommand("plugin-ext", { handler: async () => {} });
				}
			`,
		);
	});

	afterEach(() => {
		projectDir.removeSync();
		fs.rmSync(tempHomeDir, { recursive: true, force: true });
		if (originalHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = originalHome;
		}
		setAgentDir(originalAgentDir);
	});

	it("loads installed plugin extensions declared in package.json", async () => {
		const result = await discoverAndLoadExtensions([], projectDir.path());
		const extension = result.extensions.find(ext => ext.path.endsWith(path.join("dist", "extension.ts")));

		expect(result.errors).toHaveLength(0);
		expect(extension).toBeDefined();
		expect(extension?.commands.has("plugin-ext")).toBe(true);
	});
});
