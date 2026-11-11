import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromptSkillFreeze } from "../../src/core/prompt-skill-message.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { SKILL_ADMISSION_ENTRY_TYPE } from "../../src/core/skill-admission-ledger.ts";
import {
	admitSkillBody,
	expandSkillCommand,
	restoreSkillAdmissionLedger,
} from "../../src/core/skill-admission-session.ts";
import { autoLoadSkills } from "../../src/core/skill-auto-load.ts";
import type { Skill } from "../../src/core/skills.ts";
import { createTestResourceLoader } from "../utilities.ts";
import { createHarness, type Harness } from "./harness.ts";

const dirs: string[] = [];
const harnesses: Harness[] = [];
const QUERY = "extract text from pdf invoice files";
const ON = { OMK_SKILL_AUTO_LOAD: "1", OMK_SKILL_ADMISSION: "1" };
afterEach(() => {
	for (const harness of harnesses.splice(0)) harness.cleanup();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	vi.unstubAllEnvs();
});

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "omk-skill-context-"));
	dirs.push(root);
	const baseDir = join(root, "pdf-extract");
	mkdirSync(baseDir);
	const filePath = join(baseDir, "SKILL.md");
	const body = "Inspect embedded text before selecting OCR. Check extraction output against the source.";
	writeFileSync(filePath, `---\nname: pdf-extract\ndescription: ${QUERY}\n---\n${body}\n`);
	const skill: Skill = {
		name: "pdf-extract",
		description: QUERY,
		baseDir,
		filePath,
		disableModelInvocation: false,
		sourceInfo: { path: filePath, source: "test", scope: "user", origin: "top-level" },
	};
	const store = SessionManager.inMemory(root);
	const anchor = store.appendMessage({ role: "user", content: "start", timestamp: Date.now() });
	const load = () => autoLoadSkills({ store, skills: [skill], query: QUERY, env: ON });
	const remember = () => {
		const content = load();
		expect(content).toContain(body);
		return store.appendCustomMessageEntry("prompt-skills", content ?? "", false);
	};
	return { root, skill, body, store, anchor, load, remember };
}

describe("auto skill context feedback", () => {
	it("restores a compacted body without spending another lifetime admission slot", () => {
		const f = fixture();
		f.remember();
		const kept = f.store.appendMessage({ role: "user", content: "continue", timestamp: Date.now() });
		f.store.appendCompaction("the invoice task is in progress", kept, 10_000);
		expect(JSON.stringify(f.store.buildSessionContext().messages)).not.toContain(f.body);
		f.remember();
		expect(f.load()).toBeUndefined();
		expect(restoreSkillAdmissionLedger(f.store.getEntries()).used).toBe(1);
	});

	it("retained bodies are not loaded twice when compaction keeps their message", () => {
		const f = fixture();
		const kept = f.remember();
		f.store.appendCompaction("summary", kept, 10_000);
		expect(f.load()).toBeUndefined();
	});

	it("does not duplicate an explicit body in the pending user prompt", () => {
		const f = fixture();
		const query = expandSkillCommand(`/skill:${f.skill.name} ${QUERY}`, [f.skill], f.store, "explicit", () => {});
		expect(query).toContain(f.body);
		expect(autoLoadSkills({ store: f.store, skills: [f.skill], query, env: ON })).toBeUndefined();
		expect(restoreSkillAdmissionLedger(f.store.getEntries()).used).toBe(1);
	});

	it("restores a body from another branch and permits reuse even at the lifetime cap", () => {
		const f = fixture();
		f.remember();
		for (let i = 0; i < 9; i++) expect(admitSkillBody(f.store, `other-${i}`, `body-${i}`, "explicit", ON)).toBe(true);
		f.store.branch(f.anchor);
		f.remember();
		expect(f.load()).toBeUndefined();
		expect(restoreSkillAdmissionLedger(f.store.getEntries()).used).toBe(10);
	});

	it("a changed body still needs a new slot and a restoration obeys the prompt budget", () => {
		const f = fixture();
		f.remember();
		f.store.branch(f.anchor);
		expect(
			autoLoadSkills({ store: f.store, skills: [f.skill], query: QUERY, env: ON, budgetTokens: 0 }),
		).toBeUndefined();
		for (let i = 0; i < 9; i++) admitSkillBody(f.store, `other-${i}`, `body-${i}`, "explicit", ON);
		writeFileSync(f.skill.filePath, "updated instructions");
		expect(f.load()).not.toContain("updated instructions");
		expect(restoreSkillAdmissionLedger(f.store.getEntries()).used).toBe(10);
	});

	it("records context restoration without retaining skill contents or paths in telemetry", async () => {
		const f = fixture();
		f.remember();
		f.store.branch(f.anchor);
		const result = await new PromptSkillFreeze(() => f.store).turn({
			base: { cwd: f.root },
			provider: undefined,
			selection: { names: [], source: undefined },
			defaults: [],
			skills: [f.skill],
			harnessQuery: QUERY,
			budgetQuery: QUERY,
			contextPressure: () => false,
			contextBudget: () => undefined,
			env: { ...ON, OMK_RUN_LOG_DIR: f.root },
		});
		expect(result.messages.some((message) => String(message.content).includes(f.body))).toBe(true);
		const raw = readFileSync(join(f.root, "skill-autoload.jsonl"), "utf8");
		const record = JSON.parse(raw.trim()) as {
			candidates: { restoredFromHistory: boolean }[];
			admittedTotal: number;
		};
		expect(record.candidates[0]?.restoredFromHistory).toBe(true);
		expect(record.admittedTotal).toBe(1);
		for (const privateText of [f.body, f.skill.name, f.root]) expect(raw).not.toContain(privateText);
	});

	it("native AgentSession sends the restored body after a committed compaction", async () => {
		vi.stubEnv("OMK_SKILL_AUTO_LOAD", "1");
		vi.stubEnv("OMK_SKILL_ADMISSION", "1");
		const f = fixture();
		const harness = await createHarness({
			resourceLoader: {
				...createTestResourceLoader(),
				getSkills: () => ({ skills: [f.skill], diagnostics: [] }),
			},
		});
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("first response")]);
		await harness.session.prompt(QUERY);
		const kept = harness.sessionManager.getLeafId();
		expect(kept).toBeTruthy();
		harness.sessionManager.appendCompaction("task summary without instructions", kept ?? "", 10_000);
		harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
		harness.setResponses([fauxAssistantMessage("second response")]);
		await harness.session.prompt(QUERY);
		expect(
			harness.session.messages.filter(
				(message) =>
					message.role === "custom" &&
					message.customType === "prompt-skills" &&
					String(message.content).includes(f.body),
			),
		).toHaveLength(1);
		expect(
			harness.sessionManager
				.getEntries()
				.filter((entry) => entry.type === "custom" && entry.customType === SKILL_ADMISSION_ENTRY_TYPE),
		).toHaveLength(1);
	});
});
