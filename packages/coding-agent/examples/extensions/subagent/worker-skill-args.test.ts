/** Spec 106 SK6: flag off => worker skill launch args identical to the legacy branch, enforceCapabilities on and off. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionEntry } from "../../../src/core/session-manager.ts";
import { admitWorkerSkills, type SkillAdmissionStore } from "../../../src/core/skill-admission-session.ts";
import {
	buildEnforcementArgs,
	type CapabilityCatalog,
	type ValidatedCapabilities,
	type WorkerSkillAdmit,
	workerSkillArgs,
} from "./capabilities.ts";

const dirs: string[] = [];
afterEach(() => {
	vi.unstubAllEnvs();
	while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "omk-sk6-"));
	dirs.push(root);
	const skills = new Map<string, string>();
	for (const name of ["alpha", "beta"]) {
		mkdirSync(join(root, name));
		const file = join(root, name, "SKILL.md");
		writeFileSync(file, `---\nname: ${name}\n---\nbody ${name}\n`);
		skills.set(name, file);
	}
	const catalog: CapabilityCatalog = { skills, hooks: new Set(), mcp: new Set() };
	const validated: ValidatedCapabilities = {
		skills: ["alpha", "beta"],
		mcp: [],
		hooks: [],
		unknownSkills: [],
		unknownMcp: [],
		unknownHooks: [],
	};
	const entries: SessionEntry[] = [];
	const store: SkillAdmissionStore = {
		getEntries: () => entries,
		appendCustomEntry: (customType, data) =>
			entries.push({ type: "custom", customType, data, id: `${entries.length}`, parentId: null, timestamp: "" }),
	};
	const admit: WorkerSkillAdmit = (granted) => admitWorkerSkills(store, granted);
	return { catalog, validated, entries, admit };
}

describe("spec 106 SK6 worker skill args", () => {
	it("flag off: args identical to legacy with enforceCapabilities on and off, no ledger writes", () => {
		vi.stubEnv("OMK_SKILL_ADMISSION", "0");
		const { catalog, validated, entries, admit } = fixture();
		expect(workerSkillArgs(validated, () => catalog, true, admit)).toEqual({
			args: buildEnforcementArgs(validated, catalog),
			notices: [],
		});
		expect(workerSkillArgs(validated, () => catalog, false, admit)).toEqual({ args: [], notices: [] });
		expect(workerSkillArgs(undefined, () => catalog, true, admit)).toEqual({ args: [], notices: [] });
		expect(workerSkillArgs(validated, () => catalog, true, undefined).args).toEqual(
			buildEnforcementArgs(validated, catalog),
		);
		expect(entries).toHaveLength(0);
	});

	it("flag on: admitted skills only, regardless of enforceCapabilities", () => {
		vi.stubEnv("OMK_SKILL_ADMISSION", "1");
		const { catalog, validated, entries, admit } = fixture();
		const expected = ["--no-skills", "--skill", catalog.skills.get("alpha"), "--skill", catalog.skills.get("beta")];
		expect(workerSkillArgs(validated, () => catalog, false, admit).args).toEqual(expected);
		expect(workerSkillArgs(validated, () => catalog, true, admit).args).toEqual(expected);
		expect(entries).toHaveLength(2);
	});
});
