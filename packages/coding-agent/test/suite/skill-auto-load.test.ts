/**
 * Spec 117 (`OMK_SKILL_AUTO_LOAD`): strong-only auto-load through `admitSkillBody(..., "auto")`, the once-per-process
 * warning without `OMK_SKILL_ADMISSION`, worker env, and the `skill-autoload.jsonl` observe log (G1/G2 fixtures).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { subagentWorkerEnv } from "../../examples/extensions/subagent/worker-env.ts";
import { PROMPT_SKILLS_CUSTOM_TYPE, PromptSkillFreeze } from "../../src/core/prompt-skill-message.ts";
import type { SessionEntry } from "../../src/core/session-manager.ts";
import { SKILL_ADMISSION_ENTRY_TYPE } from "../../src/core/skill-admission-ledger.ts";
import { gateSkillRead, restoreSkillAdmissionLedger } from "../../src/core/skill-admission-session.ts";
import { autoLoadSkills, resetSkillAutoLoadWarning, skillAutoLoadActive } from "../../src/core/skill-auto-load.ts";
import {
	nextSkillAutoloadSeq,
	SKILL_AUTOLOAD_SEQ_SESSION_CAP,
	sha256,
	skillAutoLoadSeqSessionCount,
} from "../../src/core/skill-autoload-observe.ts";
import type { Skill } from "../../src/core/skills.ts";
import type { BuildSystemPromptOptions } from "../../src/core/system-prompt.ts";

const dirs: string[] = [];
afterEach(() => {
	while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
	resetSkillAutoLoadWarning();
});

function tmp(): string {
	const dir = mkdtempSync(join(tmpdir(), "omk-117-"));
	dirs.push(dir);
	return dir;
}

function skill(root: string, name: string, description: string, body = `body of ${name}`): Skill {
	const dir = join(root, "skills", name);
	mkdirSync(dir, { recursive: true });
	const filePath = join(dir, "SKILL.md");
	writeFileSync(filePath, `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`);
	return {
		name,
		description,
		filePath,
		baseDir: dir,
		sourceInfo: { path: filePath, source: "test", scope: "user", origin: "top-level" },
		disableModelInvocation: false,
	};
}

class Store {
	entries: SessionEntry[] = [];
	getEntries(): readonly SessionEntry[] {
		return this.entries;
	}
	appendCustomEntry(customType: string, data?: unknown): unknown {
		this.entries.push({ type: "custom", customType, data } as unknown as SessionEntry);
		return undefined;
	}
	getSessionId(): string {
		return "sess-117";
	}
	records(): { skillId: string; source: string; status: string }[] {
		return this.entries
			.filter((e) => e.type === "custom" && e.customType === SKILL_ADMISSION_ENTRY_TYPE)
			.map((e) => (e as unknown as { data: { skillId: string; source: string; status: string } }).data)
			.filter((r) => r.status === "admitted");
	}
}

const ON = { OMK_SKILL_AUTO_LOAD: "1", OMK_SKILL_ADMISSION: "1" };
const QUERY = "extract text from the pdf invoice files";

function fixture(root = tmp()) {
	return {
		root,
		pdf: skill(root, "pdf-extract", "extract text from pdf invoice files", "PDF-BODY-SECRET"),
		other: skill(root, "kubernetes-deploy", "deploy helm charts to kubernetes clusters", "K8S-BODY"),
	};
}

function readLog(dir: string): Record<string, unknown>[] {
	try {
		return readFileSync(join(dir, "skill-autoload.jsonl"), "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
	} catch {
		return [];
	}
}

describe("spec 117 flag gating", () => {
	it("off: no message, no record, no log, no warning", () => {
		const { pdf, other } = fixture();
		const store = new Store();
		const warn: string[] = [];
		for (const env of [
			{ OMK_SKILL_AUTO_LOAD: "0" },
			{ OMK_SKILL_AUTO_LOAD: "off", OMK_SKILL_ADMISSION: "1" },
			{ OMK_SKILL_ADMISSION: "0" },
		]) {
			expect(autoLoadSkills({ store, skills: [pdf, other], query: QUERY, env, warn: (l) => warn.push(l) })).toBe(
				undefined,
			);
		}
		expect(store.entries).toHaveLength(0);
		expect(warn).toHaveLength(0);
	});

	it("flag without OMK_SKILL_ADMISSION: off, exactly one warning per process", () => {
		const { pdf } = fixture();
		const warn: string[] = [];
		for (const store of [new Store(), new Store()]) {
			const env = { OMK_SKILL_AUTO_LOAD: "1", OMK_SKILL_ADMISSION: "0" };
			expect(autoLoadSkills({ store, skills: [pdf], query: QUERY, env, warn: (l) => warn.push(l) })).toBe(undefined);
			expect(store.entries).toHaveLength(0);
		}
		expect(warn).toHaveLength(1);
		expect(skillAutoLoadActive(ON)).toBe(true);
	});

	it("default on: unset env loads the strong candidate; 0/false/off opt out", () => {
		const { pdf, other } = fixture();
		expect(autoLoadSkills({ store: new Store(), skills: [pdf, other], query: QUERY, env: {} })).toContain(
			"PDF-BODY-SECRET",
		);
		for (const v of ["0", "false", "OFF"]) {
			expect(skillAutoLoadActive({ OMK_SKILL_AUTO_LOAD: v })).toBe(false);
		}
	});
});

describe("spec 117 auto-load (AL1–AL5)", () => {
	it("AL1/AL1b: strong candidate is loaded with source auto (never default)", () => {
		const { pdf, other } = fixture();
		const store = new Store();
		const content = autoLoadSkills({ store, skills: [pdf, other], query: QUERY, env: ON });
		expect(content).toContain("PDF-BODY-SECRET");
		expect(content).not.toContain("K8S-BODY");
		expect(store.records().map((r) => [r.skillId, r.source])).toEqual([["pdf-extract", "auto"]]);
	});

	it("AL2: unrelated prompt loads nothing", () => {
		const { pdf, other } = fixture();
		const store = new Store();
		expect(autoLoadSkills({ store, skills: [pdf, other], query: "what time is it", env: ON })).toBe(undefined);
		expect(store.entries).toHaveLength(0);
	});

	it("AL2b: ambiguous-band candidate is logged only (band ambiguous, wouldLoad false)", () => {
		const { pdf } = fixture();
		const log = tmp();
		const store = new Store();
		const env = { ...ON, OMK_RUN_LOG_DIR: log };
		expect(autoLoadSkills({ store, skills: [pdf], query: "invoice files weather forecast", env })).toBe(undefined);
		expect(store.entries).toHaveLength(0);
		const [line] = readLog(log);
		expect(line?.candidates).toEqual([
			expect.objectContaining({ band: "ambiguous", wouldLoad: false, loaded: false }),
		]);
	});

	it("AL3: 9 admitted + 2 strong candidates => 1 loaded, 1 cap refusal without body", () => {
		const root = tmp();
		const store = new Store();
		const warm = Array.from({ length: 9 }, (_, i) => skill(root, `warm-${i}`, `warm helper ${i}`));
		for (const s of warm) autoLoadSkills({ store, skills: [s], query: `warm helper ${s.name.slice(5)}`, env: ON });
		expect(store.records()).toHaveLength(9);
		const a = skill(root, "pdf-extract", "extract pdf invoice text", "BODY-A");
		const b = skill(root, "pdf-invoice", "pdf invoice text extract", "BODY-B");
		const content = autoLoadSkills({ store, skills: [a, b], query: "extract pdf invoice text", env: ON }) ?? "";
		expect(store.records()).toHaveLength(10);
		expect(content.match(/BODY-[AB]/g)).toHaveLength(1);
		expect(content).toContain("<skill_candidate");
	});

	it("AL4: same skill on two prompts => one record, body sent once", () => {
		const { pdf } = fixture();
		const store = new Store();
		expect(autoLoadSkills({ store, skills: [pdf], query: QUERY, env: ON })).toContain("PDF-BODY-SECRET");
		expect(autoLoadSkills({ store, skills: [pdf], query: QUERY, env: ON })).toBe(undefined);
		expect(store.records()).toHaveLength(1);
		// AL6: resume rebuilds the count from the auto record; it is never reset.
		expect(restoreSkillAdmissionLedger(store.entries).used).toBe(1);
	});

	it("AL5: over the skill budget the lowest-ranked body is dropped", () => {
		const root = tmp();
		const big = "x".repeat(4000);
		const a = skill(root, "pdf-extract", "extract pdf invoice text", `A${big}`);
		const b = skill(root, "pdf-invoice", "pdf invoice text", `B${big}`);
		const log = tmp();
		const store = new Store();
		const env = { ...ON, OMK_RUN_LOG_DIR: log };
		const content = autoLoadSkills({
			store,
			skills: [a, b],
			query: "extract pdf invoice text",
			env,
			budgetTokens: 1500,
		});
		expect(store.records().map((r) => r.skillId)).toEqual(["pdf-extract"]);
		expect(content).not.toContain(`B${big}`);
		const cands = readLog(log)[0]?.candidates as { overBudget: boolean; loaded: boolean }[];
		expect(cands.map((c) => [c.loaded, c.overBudget])).toEqual([
			[true, false],
			[false, true],
		]);
	});

	it("max 3 strong loads per prompt", () => {
		const root = tmp();
		const skills = Array.from({ length: 5 }, (_, i) => skill(root, `pdf-tool-${i}`, "extract pdf invoice text"));
		const store = new Store();
		autoLoadSkills({ store, skills, query: "extract pdf invoice text", env: ON });
		expect(store.records()).toHaveLength(3);
	});
});

describe("spec 117 delivery and workers", () => {
	const base = {} as BuildSystemPromptOptions;
	const input = (skills: Skill[], env: NodeJS.ProcessEnv) => ({
		base,
		provider: undefined,
		selection: { names: [], source: undefined },
		defaults: ["kubernetes-deploy"],
		skills,
		harnessQuery: QUERY,
		budgetQuery: QUERY,
		contextPressure: () => false,
		contextBudget: () => undefined,
		env,
		now: () => 1,
	});

	it("body goes in a prompt-skills message; system prompt options unchanged; defaults not loaded", async () => {
		const { pdf, other } = fixture();
		const store = new Store();
		const off = await new PromptSkillFreeze(() => store).turn(input([pdf, other], { OMK_SKILL_AUTO_LOAD: "0" }));
		const on = await new PromptSkillFreeze(() => store).turn(input([pdf, other], ON));
		expect(off.messages).toHaveLength(0);
		expect(on.options).toEqual(off.options);
		expect(on.messages).toHaveLength(1);
		expect(on.messages[0]?.customType).toBe(PROMPT_SKILLS_CUSTOM_TYPE);
		expect(String(on.messages[0]?.content)).not.toContain("K8S-BODY");
	});

	it("AL7: worker env forces auto-load off and suggest off", () => {
		const env = subagentWorkerEnv({ ...ON, OMK_SKILL_SEARCH_SUGGEST: "1" });
		expect(env.OMK_SKILL_AUTO_LOAD).toBe("0");
		expect(subagentWorkerEnv({}).OMK_SKILL_AUTO_LOAD).toBe("0");
		expect(env.OMK_SKILL_SEARCH_SUGGEST).toBe("0");
		expect(skillAutoLoadActive(env)).toBe(false);
	});
});

describe("spec 117 skill-autoload.jsonl", () => {
	it("written only with OMK_RUN_LOG_DIR; flag off => loaded false, no names/paths/text", () => {
		const { root, pdf, other } = fixture();
		const log = tmp();
		const store = new Store();
		autoLoadSkills({
			store,
			skills: [pdf, other],
			query: QUERY,
			env: { OMK_RUN_LOG_DIR: log, OMK_SKILL_AUTO_LOAD: "0", OMK_SKILL_ADMISSION: "0" },
		});
		const lines = readLog(log);
		expect(lines).toHaveLength(1);
		const line = lines[0] as Record<string, unknown>;
		expect(line).toMatchObject({
			kind: "prompt",
			sessionId: "sess-117",
			flags: { autoLoad: false, admission: false },
		});
		expect(line.candidates).toEqual([
			expect.objectContaining({ nameSha256: sha256("pdf-extract"), band: "strong", wouldLoad: true, loaded: false }),
		]);
		const raw = readFileSync(join(log, "skill-autoload.jsonl"), "utf8");
		for (const banned of ["pdf-extract", "kubernetes", "PDF-BODY", root]) expect(raw).not.toContain(banned);
		const strings: string[] = [];
		JSON.parse(raw, (_k, v) => {
			if (typeof v === "string") strings.push(v);
			return v;
		});
		for (const s of strings) expect(s.length <= 64 || /^[0-9a-f]{64}$/.test(s)).toBe(true);
		expect(store.entries).toHaveLength(0);
	});

	it("a skill-file read yields one read line joinable by nameSha256; G1/G2 recomputed from the fixture", () => {
		const { pdf, other } = fixture();
		const log = tmp();
		const env = { OMK_RUN_LOG_DIR: log };
		const store = new Store();
		autoLoadSkills({ store, skills: [pdf, other], query: QUERY, env });
		const notes = join(pdf.baseDir, "ref.md");
		writeFileSync(notes, "ref");
		gateSkillRead(store, () => [pdf, other], "/", "read", { path: notes }, false, env);
		gateSkillRead(store, () => [pdf, other], "/", "read", { path: "/etc/hostname" }, false, env);
		const lines = readLog(log);
		const reads = lines.filter((l) => l.kind === "read");
		expect(reads).toEqual([expect.objectContaining({ nameSha256: sha256("pdf-extract"), sessionId: "sess-117" })]);
		// G1 for this task: strong wouldLoad picks with no read line.
		const readSet = new Set(reads.map((r) => r.nameSha256));
		const prompt = lines.find((l) => l.kind === "prompt") as {
			candidates: { nameSha256: string; wouldLoad: boolean }[];
		};
		const unread = prompt.candidates.filter((c) => c.wouldLoad && !readSet.has(c.nameSha256));
		expect(unread).toHaveLength(0);
		// G2 flag-off preview: unused share of wouldLoad picks = 0 / 1.
		expect(prompt.candidates.filter((c) => c.wouldLoad)).toHaveLength(1);
	});

	it("no read line without the run log", () => {
		const { pdf } = fixture();
		const log = tmp();
		gateSkillRead(new Store(), () => [pdf], "/", "read", { path: pdf.filePath }, false, {});
		expect(readLog(log)).toHaveLength(0);
	});

	it("seq counter is bounded to 1000 sessions", () => {
		for (let i = 0; i < SKILL_AUTOLOAD_SEQ_SESSION_CAP + 5; i++) nextSkillAutoloadSeq(`s-${i}`);
		expect(skillAutoLoadSeqSessionCount()).toBe(SKILL_AUTOLOAD_SEQ_SESSION_CAP);
	});
});
