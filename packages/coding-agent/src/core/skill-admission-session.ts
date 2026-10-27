/**
 * Spec 106 A1: AgentSession's single skill admission decision, persisted in the session file.
 * Every body-delivering path (explicit `/skill:` in prompt, steer, followUp, SK3 model `read` of a SKILL.md,
 * SK6 worker hand-off; SDK callers through `AgentSession.admitSkillBody`) goes through {@link admitSkillBody}.
 * Flag off: always admitted, nothing written.
 */
import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { stripFrontmatter } from "../utils/frontmatter.ts";
import type { SessionEntry, SessionManager } from "./session-manager.ts";
import {
	isSkillAdmissionEnabled,
	isSkillAdmissionRecord,
	makeSkillAdmissionRecord,
	SKILL_ADMISSION_CAP,
	SKILL_ADMISSION_ENTRY_TYPE,
	SkillAdmissionLedger,
	type SkillAdmissionRecord,
	type SkillAdmissionSource,
	skillBodyDigest,
} from "./skill-admission-ledger.ts";
import { observeSkillRead } from "./skill-autoload-observe.ts";
import type { Skill } from "./skills.ts";
import { resolveReadPath } from "./tools/path-utils.ts";

/** What admission needs from a session: AgentSession passes its SessionManager, extensions pass ctx + appendEntry. */
export interface SkillAdmissionStore {
	getEntries(): readonly SessionEntry[];
	appendCustomEntry(customType: string, data?: unknown): unknown;
}

/** The slot identity of a skill body: SKILL.md without frontmatter, so every path (explicit, read, worker) dedupes. */
export function readSkillFileBody(filePath: string): string {
	return stripFrontmatter(readFileSync(filePath, "utf-8")).trim();
}

function refusalNotice(skillId: string, reason: string): string {
	return `[skill admission] "${skillId}" was not loaded: ${reason}.`;
}

const SKILL_BLOCK = /^<skill name="([^"]+)" location="[^"]+">\n([\s\S]*?)\n<\/skill>(?:\n\n[\s\S]+)?$/;

/** Rebuild from the whole session file: resume, compaction and model switch never reset the count. */
export function restoreSkillAdmissionLedger(entries: readonly SessionEntry[]): SkillAdmissionLedger {
	const records: SkillAdmissionRecord[] = [];
	const legacyBodies = new Set<string>();
	let unknownRecord = false;
	for (const entry of entries) {
		if (entry.type === "custom" && entry.customType === SKILL_ADMISSION_ENTRY_TYPE) {
			if (isSkillAdmissionRecord(entry.data)) records.push(entry.data);
			else unknownRecord = true;
			continue;
		}
		if (entry.type !== "message" || entry.message.role !== "user") continue;
		const content = entry.message.content;
		const texts =
			typeof content === "string" ? [content] : content.flatMap((p) => (p.type === "text" ? [p.text] : []));
		for (const text of texts) {
			const match = text.match(SKILL_BLOCK);
			if (match) legacyBodies.add(`${match[1]}\u0000${skillBodyDigest(match[2] ?? "")}`);
		}
	}
	const ledger = SkillAdmissionLedger.restore(records);
	// Unknown schemaVersion/policyRevision: fail closed (refuse new admissions), never restart from 0.
	if (unknownRecord) ledger.markUnknownRecord();
	// SK7: only a session that never wrote a ledger is reconstructed from history.
	if (records.length === 0 && !unknownRecord) ledger.markLegacy(legacyBodies.size);
	return ledger;
}

/** Host decision for one skill body. Returns true to deliver, otherwise the refusal reason for an explicit notice. */
export function admitSkillBody(
	sessionManager: SkillAdmissionStore | SessionManager,
	skillId: string,
	body: string,
	source: SkillAdmissionSource,
	env: NodeJS.ProcessEnv = process.env,
): true | string {
	if (!isSkillAdmissionEnabled(env)) return true;
	const ledger = restoreSkillAdmissionLedger(sessionManager.getEntries());
	const digest = skillBodyDigest(body);
	const decision = ledger.reserve(skillId, digest);
	if (!decision.ok) {
		if (decision.reason === "cap") return `session skill cap ${SKILL_ADMISSION_CAP} reached`;
		if (decision.reason === "unknown_record")
			return "session has skill admission records of an unknown version (fail closed)";
		return `session already holds more than ${SKILL_ADMISSION_CAP} skill bodies (legacy)`;
	}
	if (decision.reused) return true;
	// reserve and commit run in one synchronous turn; the expanded text is handed straight to the request.
	ledger.commit(decision.requestId);
	sessionManager.appendCustomEntry(
		SKILL_ADMISSION_ENTRY_TYPE,
		makeSkillAdmissionRecord(skillId, digest, source, "admitted", decision.requestId),
	);
	return true;
}

/**
 * Expand `/skill:name args` to its body (moved from AgentSession unchanged), gated by {@link admitSkillBody}.
 * A refused skill is replaced by an explicit notice, never silently dropped.
 */
export function expandSkillCommand(
	text: string,
	skills: readonly Skill[],
	sessionManager: SessionManager,
	source: SkillAdmissionSource,
	onError: (skill: Skill, error: unknown) => void,
): string {
	if (!text.startsWith("/skill:")) return text;
	const spaceIndex = text.indexOf(" ");
	const skillName = spaceIndex === -1 ? text.slice(7) : text.slice(7, spaceIndex);
	const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim();
	const skill = skills.find((s) => s.name === skillName);
	if (!skill) return text; // Unknown skill, pass through
	try {
		const content = readFileSync(skill.filePath, "utf-8");
		const body = stripFrontmatter(content).trim();
		const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
		const admitted = admitSkillBody(sessionManager, skill.name, body, source);
		const head = admitted === true ? skillBlock : refusalNotice(skill.name, admitted);
		return args ? `${head}\n\n${args}` : head;
	} catch (err) {
		onError(skill, err);
		return text; // Return original on error
	}
}

/**
 * SK3: the model reading a SKILL.md with the `read` tool delivers that skill's body, so it takes a slot too.
 * Returns a replacement tool result (the explicit refusal notice) when refused; undefined keeps the result as is.
 * Flag off, other tools, errors and non-SKILL.md paths: undefined without touching the ledger.
 */
export function gateSkillRead(
	sessionManager: SkillAdmissionStore | SessionManager,
	skills: () => readonly Skill[],
	cwd: string,
	toolName: string,
	args: unknown,
	isError: boolean,
	env: NodeJS.ProcessEnv = process.env,
): { content: { type: "text"; text: string }[]; details: undefined } | undefined {
	observeSkillRead(sessionManager, skills, cwd, toolName, args, isError, env); // spec 117 run log, no flag
	if (toolName !== "read" || isError || !isSkillAdmissionEnabled(env)) return undefined;
	const rawPath = (args as { path?: unknown } | undefined)?.path;
	if (typeof rawPath !== "string") return undefined;
	const filePath = resolve(resolveReadPath(rawPath, cwd));
	if (basename(filePath) !== "SKILL.md") return undefined;
	let body: string;
	try {
		body = readSkillFileBody(filePath);
	} catch {
		return undefined; // the read succeeded but the file vanished; nothing delivered can be identified
	}
	const skillId = skills().find((s) => resolve(s.filePath) === filePath)?.name ?? basename(dirname(filePath));
	const admitted = admitSkillBody(sessionManager, skillId, body, "read", env);
	if (admitted === true) return undefined;
	return { content: [{ type: "text", text: refusalNotice(skillId, admitted) }], details: undefined };
}

/**
 * SK6: skill bodies handed to a worker lane. Flag off: undefined (caller keeps its legacy args, byte-identical).
 * Flag on: each granted skill goes through {@link admitSkillBody} with source "worker"; the worker is restricted to
 * the admitted ones (`--no-skills` + `--skill <path>`), so it cannot load a body the parent session never admitted.
 */
export function admitWorkerSkills(
	sessionManager: SkillAdmissionStore,
	skills: readonly { name: string; filePath: string }[],
	env: NodeJS.ProcessEnv = process.env,
): { args: string[]; notices: string[] } | undefined {
	if (!isSkillAdmissionEnabled(env)) return undefined;
	const args = ["--no-skills"];
	const notices: string[] = [];
	for (const skill of skills) {
		let body: string;
		try {
			body = readSkillFileBody(skill.filePath);
		} catch {
			notices.push(refusalNotice(skill.name, "skill file unreadable"));
			continue;
		}
		const admitted = admitSkillBody(sessionManager, skill.name, body, "worker", env);
		if (admitted === true) args.push("--skill", skill.filePath);
		else notices.push(refusalNotice(skill.name, admitted));
	}
	return { args, notices };
}
