import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	DEVIN_HARNESS_DOMAIN_ID,
	DEVIN_PLAYBOOK_MAX_APPEND_CHARS,
	DEVIN_PROVIDER,
	DEVIN_SWE2_CONTEXT_WINDOW,
	DEVIN_SWE2_EFFORTS,
	DEVIN_SWE2_MODEL_ID,
	type DevinHarnessIntent,
	devinHarnessAutoApplyEnabled,
	devinPlaybookAppendForProvider,
	isDevinProvider,
	isDevinSwe2Effort,
	loadDevinPlaybookAppend,
	recommendedDevinEffortForIntent,
	recommendedDevinSkillTierForIntent,
	selectDevinHarnessSkills,
} from "../src/core/devin-harness.ts";
import { getDomainProfile } from "../src/core/domain-loadouts.ts";
import { capabilityGateNames } from "../src/core/loadout-safety.ts";
import { defaultModelPerProvider } from "../src/core/model-resolver.ts";

const intents: readonly DevinHarnessIntent[] = ["code", "debug", "test", "repo"];
const allowed = new Set(capabilityGateNames(getDomainProfile(DEVIN_HARNESS_DOMAIN_ID).skills));

const skill = (name: string, description: string, disableModelInvocation = false) => ({
	name,
	description,
	filePath: `/skills/${name}/SKILL.md`,
	baseDir: `/skills/${name}`,
	disableModelInvocation,
});

const inventory = [
	skill("packages", "Multi-package repository context"),
	skill("programming", "TypeScript Python Rust Go implementation"),
	skill("debugging", "Runtime failures, hanging, crash, empty response"),
	skill("tdd-workflow", "Test-driven development red green refactor coverage"),
	skill("understand-anything", "Repository graph architecture comprehension"),
	skill("headroom", "Compress oversized context window"),
	skill("image-prompt", "Image generation prompt compiler"),
];

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("Devin SWE-2 harness identity", () => {
	it("binds to the built-in devin provider and its SWE-2 default", () => {
		expect(DEVIN_PROVIDER).toBe("devin");
		expect(isDevinProvider("devin")).toBe(true);
		expect(isDevinProvider("xai")).toBe(false);
		expect(isDevinProvider(undefined)).toBe(false);
		expect(defaultModelPerProvider.devin).toBe(DEVIN_SWE2_MODEL_ID);
		expect(DEVIN_SWE2_CONTEXT_WINDOW).toBe(1_000_000);
	});

	it("accepts only the medium/high/max effort ladder", () => {
		expect(DEVIN_SWE2_EFFORTS).toEqual(["medium", "high", "max"]);
		for (const level of ["off", "minimal", "low", "xhigh", "ultra", undefined]) {
			expect(isDevinSwe2Effort(level)).toBe(false);
		}
		for (const level of DEVIN_SWE2_EFFORTS) expect(isDevinSwe2Effort(level)).toBe(true);
	});

	it("recommends a supported effort and a small allowlisted skill tier per intent", () => {
		for (const intent of intents) {
			expect(isDevinSwe2Effort(recommendedDevinEffortForIntent(intent))).toBe(true);
			const skills = recommendedDevinSkillTierForIntent(intent);
			expect(skills.length).toBeLessThanOrEqual(3);
			expect(skills.every((name) => allowed.has(name))).toBe(true);
		}
		expect(recommendedDevinEffortForIntent("code")).toBe("medium");
		expect(recommendedDevinEffortForIntent("debug")).toBe("max");
		expect(recommendedDevinSkillTierForIntent("test")).toEqual(["tdd-workflow", "programming"]);
	});
});

describe("devinHarnessAutoApplyEnabled", () => {
	it("defaults on and honors the documented off values", () => {
		expect(devinHarnessAutoApplyEnabled({})).toBe(true);
		expect(devinHarnessAutoApplyEnabled({ OMK_DEVIN_HARNESS: "1" })).toBe(true);
		for (const off of ["0", "false", "off", "no", " OFF "]) {
			expect(devinHarnessAutoApplyEnabled({ OMK_DEVIN_HARNESS: off })).toBe(false);
		}
		// The Grok flag never governs the Devin harness.
		expect(devinHarnessAutoApplyEnabled({ OMK_GROK_HARNESS: "0" })).toBe(true);
	});
});

describe("selectDevinHarnessSkills", () => {
	it("grants only allowlisted skills, at most three, and never explicit-only ones", () => {
		const selected = selectDevinHarnessSkills("the agent is hanging and the response is empty", inventory);
		expect(selected).toContain("debugging");
		expect(selected.length).toBeLessThanOrEqual(3);
		expect(selected.every((name) => allowed.has(name))).toBe(true);
		expect(selected).not.toContain("image-prompt");
		expect(
			selectDevinHarnessSkills("fix this typescript bug", [
				skill("programming", "TypeScript Python Rust Go implementation", true),
			]),
		).toEqual([]);
	});

	it("adds headroom only under lexical or measured context pressure", () => {
		expect(selectDevinHarnessSkills("edit the python module", inventory)).not.toContain("headroom");
		expect(selectDevinHarnessSkills("compress the oversized context window", inventory)).toContain("headroom");
		expect(selectDevinHarnessSkills("edit the python module", inventory, { contextPressure: true })).toContain(
			"headroom",
		);
	});

	it("yields an empty grant instead of the full allowlist without signals", () => {
		expect(selectDevinHarnessSkills("hello there", inventory)).toEqual([]);
	});
});

describe("devin.md operator overlay", () => {
	it("is appended only for the devin provider and truncated at the cap", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "omk-devin-harness-"));
		vi.stubEnv("OMK_CODING_AGENT_DIR", agentDir);
		try {
			expect(loadDevinPlaybookAppend()).toBeUndefined();
			writeFileSync(join(agentDir, "devin.md"), "  \n");
			expect(devinPlaybookAppendForProvider("devin")).toBeUndefined();
			writeFileSync(join(agentDir, "devin.md"), "# SWE-2 overlay\nkeep exploration focused\n");
			expect(devinPlaybookAppendForProvider("devin")).toBe("# SWE-2 overlay\nkeep exploration focused");
			expect(devinPlaybookAppendForProvider("xai")).toBeUndefined();
			writeFileSync(join(agentDir, "devin.md"), "x".repeat(DEVIN_PLAYBOOK_MAX_APPEND_CHARS + 10));
			const truncated = loadDevinPlaybookAppend() ?? "";
			expect(truncated.startsWith("x".repeat(DEVIN_PLAYBOOK_MAX_APPEND_CHARS))).toBe(true);
			expect(truncated).toContain("devin.md truncated for system prompt");
		} finally {
			rmSync(agentDir, { recursive: true, force: true });
		}
	});
});
