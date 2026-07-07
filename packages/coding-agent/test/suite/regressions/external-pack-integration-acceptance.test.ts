/**
 * algorithm-integration-v2 §7 — machine-checkable acceptance predicates for external-pack integration.
 *
 * Predicate 7 (repo typecheck gate): full `npm run check` is the CI gate for integration edits;
 * this file does not invoke `npm run check` or the full vitest suite inside test bodies.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { domainLoadoutProfiles, FALLBACK_DOMAIN_ID, getDomainProfile } from "../../../src/core/domain-loadouts.ts";
import { composeLoadout } from "../../../src/core/loadout-compose.ts";
import {
	forceSecurityHooks,
	SECURITY_HOOK_NAMES,
	stripWriteSkillsForAuthority,
	stripWriteToolsForAuthority,
} from "../../../src/core/loadout-safety.ts";
import { validateLoadoutProfile } from "../../../src/core/loadouts.ts";

const REPO_ROOT = join(import.meta.dirname, "../../../../../");
const CHECK_VENDORED_SKILLS = join(REPO_ROOT, "scripts/check-vendored-skills.mjs");
const TASTE_SOURCE = join(REPO_ROOT, ".omk/skills/taste-skill/SOURCE.md");
const CAVEMAN_SOURCE = join(REPO_ROOT, ".omk/skills/caveman/SOURCE.md");

function readPinnedCommitFromSourceMd(sourcePath: string): string | null {
	const text = readFileSync(sourcePath, "utf8");
	const patterns = [/\*\*Pinned commit\*\*:\s*`([0-9a-f]{40})`/i, /\*\*Pin \(commit hash\):\*\*\s*`([0-9a-f]{40})`/i];
	for (const pattern of patterns) {
		const match = pattern.exec(text);
		if (match) return match[1].toLowerCase();
	}
	return null;
}

function readScriptPinnedConstant(scriptText: string, constName: string): string | null {
	const match = new RegExp(`const ${constName} = "([0-9a-f]{40})";`).exec(scriptText);
	return match ? match[1].toLowerCase() : null;
}

describe("algorithm-integration-v2 §7 acceptance predicates", () => {
	it("predicate 1: every domainLoadoutProfiles() entry validates as LoadoutProfile", () => {
		const profiles = domainLoadoutProfiles();
		expect(Object.keys(profiles).length).toBeGreaterThanOrEqual(13);
		for (const [id, profile] of Object.entries(profiles)) {
			const result = validateLoadoutProfile(profile);
			expect(result.valid, `${id}: ${result.errors.join("; ")}`).toBe(true);
		}
	});

	it("predicate 2: composeLoadout with frontend-ui domain validates (reference loadout-compose)", () => {
		const composed = composeLoadout("coder", getDomainProfile("frontend-ui"));
		expect(validateLoadoutProfile(composed)).toEqual({ valid: true, errors: [] });
	});

	it("predicate 3: read-only authority strips write tools and write-like skills", () => {
		const tools = stripWriteToolsForAuthority(["read", "edit", "write"], "read-only");
		expect(tools.names).not.toContain("edit");
		expect(tools.names).not.toContain("write");
		expect(tools.names).toContain("read");

		const skills = stripWriteSkillsForAuthority(["analyze", "ship"], "read-only");
		expect(skills.names).not.toContain("ship");
		expect(skills.names).toContain("analyze");
	});

	it("predicate 5: getDomainProfile('__missing__') uses FALLBACK_DOMAIN_ID", () => {
		expect(getDomainProfile("__missing__").id).toBe(FALLBACK_DOMAIN_ID);
	});

	it("predicate 6: forceSecurityHooks includes every SECURITY_HOOK_NAMES entry", () => {
		const hooks = forceSecurityHooks([]);
		for (const hookName of SECURITY_HOOK_NAMES) {
			expect(hooks).toContain(hookName);
		}
	});

	it("maintenance: taste-skill and caveman SOURCE.md pins match check-vendored-skills.mjs constants", () => {
		const scriptText = readFileSync(CHECK_VENDORED_SKILLS, "utf8");
		const tasteScript = readScriptPinnedConstant(scriptText, "tastePinnedCommit");
		const cavemanScript = readScriptPinnedConstant(scriptText, "cavemanPinnedCommit");
		expect(tasteScript, "tastePinnedCommit in check script").not.toBeNull();
		expect(cavemanScript, "cavemanPinnedCommit in check script").not.toBeNull();

		const tasteSource = readPinnedCommitFromSourceMd(TASTE_SOURCE);
		const cavemanSource = readPinnedCommitFromSourceMd(CAVEMAN_SOURCE);
		expect(tasteSource, "taste-skill SOURCE.md pin").not.toBeNull();
		expect(cavemanSource, "caveman SOURCE.md pin").not.toBeNull();

		expect(tasteSource).toBe(tasteScript);
		expect(cavemanSource).toBe(cavemanScript);
	});
});
