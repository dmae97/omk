/**
 * Spec 117: skill auto-load (`OMK_SKILL_AUTO_LOAD`, default on, `0`/`false`/`off` opts out; requires skill admission, also default on) and the
 * always-on observe log `<OMK_RUN_LOG_DIR>/skill-autoload.jsonl`.
 *
 * Candidates come from the existing selector ranking (`selectSkills`, `SKILL_STRONG_THRESHOLD`); only strong
 * picks are loaded, at most `MAX_SELECTED_SKILLS` per prompt, each through `admitSkillBody(..., "auto")`. The
 * ambiguous band (weak..strong) is only logged. Bodies go in a `prompt-skills` message, never the system prompt.
 * Flag off and run log off: returns before any work. Log lines hold hashes, booleans and numbers only.
 */
import { resolve } from "node:path";
import { isDefaultOnEnvFlag } from "./env-flag.ts";
import { RUN_LOG_DIR_ENV, type RunLogRecord } from "./run-log.ts";
import { isSkillAdmissionEnabled, SKILL_ADMISSION_ENTRY_TYPE, skillBodyDigest } from "./skill-admission-ledger.ts";
import { admitSkillBody, readSkillFileBody, type SkillAdmissionStore } from "./skill-admission-session.ts";
import {
	type AutoLoadStore,
	logSkillAutoload,
	nextSkillAutoloadSeq,
	sha256,
	skillAutoloadSessionId,
} from "./skill-autoload-observe.ts";
import { MAX_SELECTED_SKILLS, SKILL_STRONG_THRESHOLD, SKILL_WEAK_THRESHOLD, selectSkills } from "./skill-selector.ts";
import type { Skill } from "./skills.ts";
import { editParentSessionId } from "./tools/edit-match-observe.ts";

export const SKILL_AUTO_LOAD_ENV = "OMK_SKILL_AUTO_LOAD";
/** Dedicated skill-body budget per prompt (estimated tokens, 4 bytes each); never touches compaction state. */
export const SKILL_AUTO_LOAD_BUDGET_TOKENS = 12_000;

export type { AutoLoadStore } from "./skill-autoload-observe.ts";

let warned = false;

export function skillAutoLoadFlag(env: NodeJS.ProcessEnv = process.env): boolean {
	return isDefaultOnEnvFlag(env[SKILL_AUTO_LOAD_ENV]);
}

/** On only with skill admission on; with admission opted out it stays off and warns once, only if the flag was set explicitly. */
export function skillAutoLoadActive(
	env: NodeJS.ProcessEnv = process.env,
	warn: (line: string) => void = (line) => process.stderr.write(line),
): boolean {
	if (!skillAutoLoadFlag(env)) return false;
	if (isSkillAdmissionEnabled(env)) return true;
	if (!warned && env[SKILL_AUTO_LOAD_ENV] !== undefined) {
		warned = true;
		warn(
			`[omk] ${SKILL_AUTO_LOAD_ENV} needs skill admission (OMK_SKILL_ADMISSION is opted out); skill auto-load stays off.\n`,
		);
	}
	return false;
}

/** Test hooks. */
export function resetSkillAutoLoadWarning(): void {
	warned = false;
}

function admittedKeys(store: SkillAdmissionStore): Set<string> {
	const keys = new Set<string>();
	for (const entry of store.getEntries()) {
		if (entry.type !== "custom" || entry.customType !== SKILL_ADMISSION_ENTRY_TYPE) continue;
		const data = entry.data as { skillId?: unknown; digest?: unknown; status?: unknown } | undefined;
		if (data?.status === "admitted") keys.add(`${data.skillId}\u0000${data.digest}`);
	}
	return keys;
}

export interface AutoLoadInput {
	readonly store: AutoLoadStore;
	readonly skills: readonly Skill[];
	readonly query: string;
	readonly env?: NodeJS.ProcessEnv;
	readonly budgetTokens?: number;
	readonly warn?: (line: string) => void;
}

interface Pick {
	readonly skill: Skill;
	readonly band: "strong" | "ambiguous";
}

/** Returns the `<prompt_skills>` content with the loaded bodies, or undefined (flag off, nothing loaded). */
export function autoLoadSkills(input: AutoLoadInput): string | undefined {
	const env = input.env ?? process.env;
	const active = skillAutoLoadActive(env, input.warn);
	const observe = Boolean(env[RUN_LOG_DIR_ENV]?.trim());
	if (!active && !observe) return undefined;
	if (active) return runAutoLoad(input, env, true, observe);
	// Observe-only (flag off, run log on): selection, body reads and logging never reach the prompt or throw.
	try {
		runAutoLoad(input, env, false, true);
	} catch {
		// swallowed: a flag-off prompt must stay unchanged
	}
	return undefined;
}

function runAutoLoad(
	input: AutoLoadInput,
	env: NodeJS.ProcessEnv,
	active: boolean,
	observe: boolean,
): string | undefined {
	const invocable = input.skills.filter((skill) => !skill.disableModelInvocation);
	const byName = new Map(invocable.map((skill) => [skill.name, skill]));
	const picks: Pick[] = [];
	for (const score of selectSkills({ task: input.query, skills: invocable }).scores) {
		const skill = byName.get(score.name);
		if (!skill || score.score < SKILL_WEAK_THRESHOLD) continue;
		picks.push({ skill, band: score.score >= SKILL_STRONG_THRESHOLD ? "strong" : "ambiguous" });
	}
	const strongPicks = picks.filter((pick) => pick.band === "strong").slice(0, MAX_SELECTED_SKILLS);
	const ambiguousPicks = picks.filter((pick) => pick.band === "ambiguous").slice(0, MAX_SELECTED_SKILLS);
	if (strongPicks.length === 0 && ambiguousPicks.length === 0 && !observe) return undefined;
	const already = admittedKeys(input.store);
	const budget = input.budgetTokens ?? SKILL_AUTO_LOAD_BUDGET_TOKENS;
	let usedTokens = 0;
	let alreadyAdmitted = 0;
	const blocks: string[] = [];
	const refused: Skill[] = [];
	const candidates: RunLogRecord[] = [];
	for (const pick of [...strongPicks, ...ambiguousPicks]) {
		let body: string | undefined;
		try {
			body = readSkillFileBody(pick.skill.filePath);
		} catch {
			body = undefined;
		}
		const digest = body === undefined ? null : skillBodyDigest(body);
		const isAdmitted = digest !== null && already.has(`${pick.skill.name}\u0000${digest}`);
		if (isAdmitted) alreadyAdmitted++;
		const wouldLoad = pick.band === "strong" && body !== undefined && !isAdmitted;
		const bodyBytes = body === undefined ? 0 : Buffer.byteLength(body, "utf8");
		const bodyTokens = Math.ceil(bodyBytes / 4);
		let loaded = false;
		let capRefused = false;
		let overBudget = false;
		if (active && wouldLoad && body !== undefined) {
			if (usedTokens + bodyTokens > budget) overBudget = true;
			else if (admitSkillBody(input.store, pick.skill.name, body, "auto", env) === true) {
				loaded = true;
				usedTokens += bodyTokens;
				blocks.push(skillBlock(pick.skill, body));
			} else {
				capRefused = true;
				refused.push(pick.skill);
			}
		}
		candidates.push({
			nameSha256: sha256(pick.skill.name),
			digest,
			pathHash: sha256(resolve(pick.skill.baseDir)),
			band: pick.band,
			wouldLoad,
			loaded,
			capRefused,
			overBudget,
			bodyBytes,
			bodyTokens,
		});
	}
	if (observe) {
		const sessionId = skillAutoloadSessionId(input.store);
		logSkillAutoload(
			{
				kind: "prompt",
				sessionId,
				parentSessionId: editParentSessionId(env),
				seq: nextSkillAutoloadSeq(sessionId),
				requestTokensBefore: null,
				alreadyAdmitted,
				admittedTotal: already.size + blocks.length,
				flags: { autoLoad: skillAutoLoadFlag(env), admission: isSkillAdmissionEnabled(env) },
				candidates,
			},
			env,
		);
	}
	if (blocks.length === 0 && refused.length === 0) return undefined;
	return renderAutoLoadMessage(blocks, refused);
}

function skillBlock(skill: Skill, body: string): string {
	return `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
}

export function renderAutoLoadMessage(blocks: readonly string[], refused: readonly Skill[]): string {
	const lines = [
		"<prompt_skills>",
		"Skills loaded for this prompt (auto-selected). Apply only when relevant.",
		...blocks,
	];
	for (const skill of refused) lines.push(`<skill_candidate name="${skill.name}" location="${skill.filePath}" />`);
	lines.push("</prompt_skills>");
	return lines.join("\n");
}
