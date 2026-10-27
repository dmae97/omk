/**
 * Spec 117 end to end through AgentSession and the faux provider (usage = estimate of the prompt it received):
 * flag off is byte-identical to the pre-117 path, flag-off runs still write `prompt` and `read` observe lines,
 * and an auto-load budget check leaves compaction headroom state untouched (AL5b).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { subagentWorkerEnv } from "../../examples/extensions/subagent/worker-env.ts";
import {
	compactionHysteresisConfigFor,
	getCompactionHeadroomThreshold,
} from "../../src/core/compaction/compaction-headroom.ts";
import { PromptSkillFreeze } from "../../src/core/prompt-skill-message.ts";
import { autoLoadSkills } from "../../src/core/skill-auto-load.ts";
import { sha256 } from "../../src/core/skill-autoload-observe.ts";
import type { Skill } from "../../src/core/skills.ts";
import { createReadTool } from "../../src/core/tools/read.ts";
import { createTestResourceLoader } from "../utilities.ts";
import { createHarness, type Harness } from "./harness.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
	while (cleanups.length > 0) cleanups.pop()?.();
	vi.unstubAllEnvs();
});

function tmp(): string {
	const dir = mkdtempSync(join(tmpdir(), "omk-117e2e-"));
	cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

function writeSkill(root: string, name: string, description: string, body: string): Skill {
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

const QUERY = "extract text from the pdf invoice files";

async function harnessWith(skills: Skill[], skillRoot: string): Promise<Harness> {
	const harness = await createHarness({
		resourceLoader: { ...createTestResourceLoader(), getSkills: () => ({ skills, diagnostics: [] }) },
		tools: [createReadTool(skillRoot)],
	});
	cleanups.push(() => harness.cleanup());
	return harness;
}

/** First provider request, timestamps and the per-harness temp dir normalized; plus the faux-reported input tokens. */
async function firstRequest(
	harness: Harness,
	featureAbsent: boolean,
): Promise<{ bytes: string; input: number; rawLength: number }> {
	if (featureAbsent) {
		// The pre-117 wiring: no admission store, so the auto-load code path never runs.
		(harness.session as unknown as { _promptSkillFreeze: PromptSkillFreeze })._promptSkillFreeze =
			new PromptSkillFreeze();
	}
	let captured: string | undefined;
	harness.setResponses([
		(context) => {
			captured = JSON.stringify(context, (key, value) => (key === "timestamp" ? 0 : value));
			return fauxAssistantMessage("done");
		},
	]);
	await harness.session.prompt(QUERY);
	if (!captured) throw new Error(`no request ${JSON.stringify(harness.session.messages).slice(0, 600)}`);
	const bytes = captured.split(harness.tempDir).join("<TMP>");
	const assistant = harness.session.messages.find((m) => m.role === "assistant");
	const input = assistant?.role === "assistant" ? assistant.usage.input : -1;
	return { bytes, input, rawLength: captured.length };
}

describe("spec 117 e2e", () => {
	const fixtureSkills = (root: string) => [
		writeSkill(root, "pdf-extract", "extract text from pdf invoice files", "PDF-BODY"),
		writeSkill(root, "kubernetes-deploy", "deploy helm charts to kubernetes clusters", "K8S-BODY"),
	];

	it.each([
		["explicit 0", { OMK_SKILL_AUTO_LOAD: "0" }],
		["admission only", { OMK_SKILL_AUTO_LOAD: "0", OMK_SKILL_ADMISSION: "1" }],
		["auto-load without admission", { OMK_SKILL_AUTO_LOAD: "1", OMK_SKILL_ADMISSION: "0" }],
	])(
		"flag off (%s, run log on): first request bytes identical to the feature-absent path",
		async (_name, env) => {
			const root = tmp();
			const skills = fixtureSkills(root);
			const absent = await firstRequest(await harnessWith(skills, root), true);
			expect(absent.bytes).not.toContain("PDF-BODY");
			expect(absent.input).toBeGreaterThan(0);
			vi.stubEnv("OMK_RUN_LOG_DIR", tmp());
			for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
			const off = await firstRequest(await harnessWith(skills, root), false);
			expect(off.bytes).toBe(absent.bytes);
			// Usage is compared with a tolerance on purpose: each harness gets a random tmp dir name, so the raw prompt
			// length (and the faux usage estimate, ~4 chars/token) can differ by a few chars, while the context bytes
			// above are exactly equal after normalizing timestamps and that tmp dir.
			const slack = Math.ceil(Math.abs(off.rawLength - absent.rawLength) / 4) + 1;
			expect(off.input).toBeGreaterThan(0);
			expect(Math.abs(off.input - absent.input)).toBeLessThanOrEqual(slack);
		},
		60_000,
	);

	it("control: flag on changes the same request (the body is delivered)", async () => {
		const root = tmp();
		const skills = fixtureSkills(root);
		const absent = await firstRequest(await harnessWith(skills, root), true);
		vi.stubEnv("OMK_SKILL_AUTO_LOAD", "1");
		vi.stubEnv("OMK_SKILL_ADMISSION", "1");
		const on = await firstRequest(await harnessWith(skills, root), false);
		expect(on.bytes).toContain("PDF-BODY");
		expect(on.input).toBeGreaterThan(absent.input);
	}, 60_000);

	it("default on (env unset): the same request delivers the body", async () => {
		const root = tmp();
		const skills = fixtureSkills(root);
		vi.stubEnv("OMK_SKILL_AUTO_LOAD", undefined);
		vi.stubEnv("OMK_SKILL_ADMISSION", undefined);
		const on = await firstRequest(await harnessWith(skills, root), false);
		expect(on.bytes).toContain("PDF-BODY");
	}, 60_000);

	it("flag off (admission off): prompt and read lines are both written for G1", async () => {
		const root = tmp();
		const log = tmp();
		const skills = [writeSkill(root, "pdf-extract", "extract text from pdf invoice files", "PDF-BODY")];
		vi.stubEnv("OMK_RUN_LOG_DIR", log);
		vi.stubEnv("OMK_SKILL_AUTO_LOAD", "0");
		vi.stubEnv("OMK_SKILL_ADMISSION", "0");
		const harness = await harnessWith(skills, root);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("read", { path: skills[0]?.filePath })], { stopReason: "toolUse" }),
			fauxAssistantMessage("ok"),
		]);
		await harness.session.prompt(QUERY);
		const lines = readFileSync(join(log, "skill-autoload.jsonl"), "utf8")
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l) as Record<string, unknown>);
		const prompt = lines.find((l) => l.kind === "prompt");
		const read = lines.find((l) => l.kind === "read");
		expect(prompt).toMatchObject({ flags: { autoLoad: false, admission: false } });
		expect(prompt?.candidates).toEqual([
			expect.objectContaining({ nameSha256: sha256("pdf-extract"), band: "strong", wouldLoad: true, loaded: false }),
		]);
		expect(read).toMatchObject({ nameSha256: sha256("pdf-extract") });
		// Flag off never admits anything.
		expect(
			harness.sessionManager.getEntries().some((e) => e.type === "custom" && e.customType === "skill_admission"),
		).toBe(false);
	});

	it("AL5b: an auto-load budget check leaves compaction headroom (trigger, rearm, hysteresis) unchanged", async () => {
		const root = tmp();
		const big = "y".repeat(8000);
		const skills = [
			writeSkill(root, "pdf-extract", "extract pdf invoice text", `A${big}`),
			writeSkill(root, "pdf-invoice", "pdf invoice text", `B${big}`),
		];
		const harness = await harnessWith(skills, root);
		const session = harness.session as unknown as { _compactionHysteresisState: unknown };
		const settings = harness.settingsManager.getCompactionSettings();
		const window = harness.getModel().contextWindow;
		const snapshot = () =>
			JSON.stringify({
				state: session._compactionHysteresisState,
				settings: harness.settingsManager.getCompactionSettings(),
				threshold: getCompactionHeadroomThreshold(window, settings),
				hysteresis: compactionHysteresisConfigFor(window, settings),
			});
		const before = snapshot();
		const env = { OMK_SKILL_AUTO_LOAD: "1", OMK_SKILL_ADMISSION: "1" };
		const content = autoLoadSkills({
			store: harness.sessionManager,
			skills,
			query: "extract pdf invoice text",
			env,
			budgetTokens: 2500,
		});
		expect(content).toContain(`A${big}`);
		expect(content).not.toContain(`B${big}`);
		expect(snapshot()).toBe(before);
		// The auto-load modules do not import compaction code at all.
		for (const file of ["skill-auto-load.ts", "skill-autoload-observe.ts"]) {
			const src = readFileSync(join(__dirname, "../../src/core", file), "utf8");
			expect(src).not.toMatch(/from "\.\/compaction/);
		}
	});

	// Auto-load is default on, so the worker env always carries OMK_SKILL_AUTO_LOAD=0 (AL7), whatever the parent has.
	it("worker env always opts out of auto-load, independent of the parent value", () => {
		const parent = { OMK_TRUST_PROJECT: "0", OMK_SKILL_ADMISSION: "1", PATH: "/bin" };
		for (const v of [undefined, "0", "1"]) {
			const env = subagentWorkerEnv(v === undefined ? parent : { ...parent, OMK_SKILL_AUTO_LOAD: v }, "0");
			expect(env.OMK_SKILL_AUTO_LOAD).toBe("0");
		}
	});
});
