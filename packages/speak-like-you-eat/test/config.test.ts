// Source: https://github.com/wtfzambo/speak-like-you-eat (MIT), adapted for OMK.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadEffectiveConfig, parseConfig, readConfig, writeConfigAtomically } from "../src/config.ts";

const enabledConfig = { enabled: true, model: { provider: "openai", id: "gpt-test" } } as const;
const directories: string[] = [];

afterEach(async () => {
	await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("SLYE configuration", () => {
	it("validates the strict enabled and disabled schema", () => {
		expect(parseConfig(enabledConfig)).toEqual(enabledConfig);
		expect(parseConfig({ enabled: false })).toEqual({ enabled: false });
		expect(parseConfig({ enabled: false, model: enabledConfig.model })).toEqual({
			enabled: false,
			model: enabledConfig.model,
		});
		for (const invalid of [
			null,
			[],
			"config",
			{ enabled: "true", model: enabledConfig.model },
			{ enabled: true },
			{ enabled: false, extra: true },
			{ enabled: true, model: { provider: "", id: "gpt-test" } },
			{ enabled: true, model: { provider: "openai", id: " " } },
			{ enabled: true, model: { provider: "openai", id: "gpt-test", extra: true } },
		]) {
			expect(parseConfig(invalid)).toBeUndefined();
		}
	});

	it("uses trusted project configuration as a complete override", async () => {
		const directory = await mkdtemp(join(tmpdir(), "omk-slye-config-"));
		directories.push(directory);
		const globalPath = join(directory, "global.json");
		const projectPath = join(directory, "project.json");
		await writeConfigAtomically(globalPath, { enabled: false });
		await writeConfigAtomically(projectPath, enabledConfig);
		expect(await loadEffectiveConfig(globalPath, projectPath, true)).toEqual({
			kind: "valid",
			path: projectPath,
			scope: "project",
			config: enabledConfig,
		});
		expect(await loadEffectiveConfig(globalPath, projectPath, false)).toEqual({
			kind: "valid",
			path: globalPath,
			scope: "global",
			config: { enabled: false },
		});
	});

	it("blocks global fallback for an invalid trusted project file", async () => {
		const directory = await mkdtemp(join(tmpdir(), "omk-slye-config-"));
		directories.push(directory);
		const globalPath = join(directory, "global.json");
		const projectPath = join(directory, "project.json");
		await writeConfigAtomically(globalPath, enabledConfig);
		await writeFile(projectPath, "{ not json", "utf8");
		expect(await loadEffectiveConfig(globalPath, projectPath, true)).toEqual({ kind: "invalid", path: projectPath });
	});

	it("writes readable configuration atomically and retains a disabled model", async () => {
		const directory = await mkdtemp(join(tmpdir(), "omk-slye-config-"));
		directories.push(directory);
		const path = join(directory, ".omk", "slye.json");
		const config = { enabled: false, model: enabledConfig.model } as const;
		await writeConfigAtomically(path, config);
		expect(await readFile(path, "utf8")).toBe(
			'{\n  "enabled": false,\n  "model": {\n    "provider": "openai",\n    "id": "gpt-test"\n  }\n}\n',
		);
		expect(await readConfig(path)).toEqual({ kind: "valid", path, config });
	});
});
