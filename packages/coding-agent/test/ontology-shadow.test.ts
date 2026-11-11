import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { observeOntologyShadow } from "../src/core/ontology-shadow.ts";
import { resolveOntologyShadowScope } from "../src/core/ontology-shadow-store.ts";
import type { ResourceLoader } from "../src/index.ts";
import { createHarness } from "./suite/harness.ts";
import { createTestResourceLoader } from "./utilities.ts";

let previousShadow: string | undefined;
let previousGovernor: string | undefined;

function git(cwd: string, ...args: string[]): void {
	const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
	expect(result.status, result.stderr).toBe(0);
}

function resourceLoader(): ResourceLoader {
	const base = createTestResourceLoader();
	return {
		...base,
		getSkills: () => ({
			diagnostics: [],
			skills: [
				{
					name: "ontology-test",
					description: "repository cache audit specialist",
					filePath: "/skills/ontology-test/SKILL.md",
					baseDir: "/skills/ontology-test",
					sourceInfo: { source: "test", scope: "project", origin: "top-level", path: "/skills/ontology-test" },
					disableModelInvocation: false,
					contentHash: "ontology-content",
				},
				{
					name: "hidden-shadow",
					description: "unadmitted-shadow-secret",
					filePath: "/skills/hidden-shadow/SKILL.md",
					baseDir: "/skills/hidden-shadow",
					sourceInfo: { source: "test", scope: "project", origin: "top-level", path: "/skills/hidden-shadow" },
					disableModelInvocation: true,
					contentHash: "hidden-content",
				},
			],
		}),
	} satisfies ResourceLoader;
}

describe("ontology shadow observation", () => {
	beforeEach(() => {
		previousShadow = process.env.OMK_ONTOLOGY_SHADOW;
		previousGovernor = process.env.OMK_CONTEXT_GOVERNOR;
	});

	afterEach(() => {
		if (previousShadow === undefined) delete process.env.OMK_ONTOLOGY_SHADOW;
		else process.env.OMK_ONTOLOGY_SHADOW = previousShadow;
		if (previousGovernor === undefined) delete process.env.OMK_CONTEXT_GOVERNOR;
		else process.env.OMK_CONTEXT_GOVERNOR = previousGovernor;
	});

	it("does not resolve a scope or touch the store when fully disabled", () => {
		let resolutions = 0;
		const result = observeOntologyShadow({
			cwd: "/path/that/does/not/exist",
			enabled: false,
			query: "secret query",
			resources: { contextFiles: [], skills: [] },
			nativeItems: [],
			selectedItemIds: [],
			scopeResolver: () => {
				resolutions++;
				throw new Error("must not resolve");
			},
		});
		expect(result.status).toBe("disabled");
		expect(resolutions).toBe(0);
	});

	it("observes a real native plan without changing its prompt or session messages", async () => {
		process.env.OMK_CONTEXT_GOVERNOR = "1";
		process.env.OMK_ONTOLOGY_SHADOW = "1";
		const harness = await createHarness({
			settings: { contextBudget: { enabled: true } },
			resourceLoader: resourceLoader(),
		});
		const root = harness.tempDir;
		git(root, "init", "--quiet");
		git(root, "config", "user.email", "ontology@example.invalid");
		git(root, "config", "user.name", "Ontology Test");
		git(root, "commit", "--quiet", "--allow-empty", "-m", "initial");
		harness.session.setActiveToolsByName(harness.session.getActiveToolNames());
		try {
			const before = harness.session.systemPrompt;
			const beforeMessages = JSON.stringify(harness.session.messages);
			harness.session.setActiveToolsByName(harness.session.getActiveToolNames());

			expect(harness.session.systemPrompt.replaceAll(/\s*<cache_decision[^/]*\/>/g, "")).toBe(
				before.replaceAll(/\s*<cache_decision[^/]*\/>/g, ""),
			);
			expect(JSON.stringify(harness.session.messages)).toBe(beforeMessages);
			await harness.session.prompt("please audit my repository cache");
			expect(harness.session.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
			const observation = harness.session.ontologyShadowObservation;
			expect(observation?.status, JSON.stringify(observation)).toBe("compared");
			expect(observation?.shadowSelectedIds).toContain("skill:ontology-test");
			expect(observation?.candidateCount).toBeGreaterThan(0);

			const store = readFileSync(resolveOntologyShadowScope(root).storePath, "utf8");
			expect(store).not.toContain("please audit my repository cache");
			expect(store).not.toContain(root);
			expect(store).not.toContain("hidden-shadow");
			expect(store).not.toContain("unadmitted-shadow-secret");
		} finally {
			harness.cleanup();
		}
	});
});
