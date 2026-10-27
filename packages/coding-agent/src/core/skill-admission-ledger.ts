/**
 * Spec 106 A1: session skill admission ledger (flag `OMK_SKILL_ADMISSION`, default on; `0`/`false`/`off` opts out).
 *
 * The host decides which skill bodies reach the model; the model only proposes. One slot = one unique
 * skill body (`skillId` + sha256 digest) actually delivered in this session, capped at {@link SKILL_ADMISSION_CAP}.
 * State is persisted as versioned `skill_admission` session records and rebuilt from them on resume,
 * compaction and model switch; no path resets the count to 0.
 */

import { createHash } from "node:crypto";
import { isDefaultOnEnvFlag } from "./env-flag.ts";

export const SKILL_ADMISSION_CAP = 10;
export const SKILL_ADMISSION_ENTRY_TYPE = "skill_admission";
export const SKILL_ADMISSION_SCHEMA_VERSION = 1;
export const SKILL_ADMISSION_POLICY_REVISION = "106-a1-r1";

export type SkillAdmissionSource = "explicit" | "steer" | "followUp" | "read" | "default" | "worker" | "auto";
export type SkillAdmissionStatus = "reserved" | "admitted" | "released";

export interface SkillAdmissionRecord {
	readonly schemaVersion: typeof SKILL_ADMISSION_SCHEMA_VERSION;
	readonly policyRevision: string;
	readonly skillId: string;
	readonly digest: string;
	readonly source: SkillAdmissionSource;
	readonly status: SkillAdmissionStatus;
	readonly requestId: string;
	/** "body": digest of SKILL.md without frontmatter. Absent: a #209 record, digest of the wrapped `<skill>` block. */
	readonly digestMode?: SkillAdmissionDigestMode;
}

export type SkillAdmissionDigestMode = "body";

export type SkillAdmissionDecision =
	| { readonly ok: true; readonly requestId: string; readonly reused: boolean }
	| { readonly ok: false; readonly reason: "cap" | "legacy_over_cap" | "unknown_record" };

export function isSkillAdmissionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	// Default on; only `0`/`false`/`off` opt out.
	return isDefaultOnEnvFlag(env.OMK_SKILL_ADMISSION);
}

export function skillBodyDigest(body: string): string {
	return createHash("sha256").update(body, "utf8").digest("hex");
}

function slotKey(skillId: string, digest: string): string {
	return `${skillId}\u0000${digest}`;
}

export function isSkillAdmissionRecord(value: unknown): value is SkillAdmissionRecord {
	if (typeof value !== "object" || value === null) return false;
	const r = value as Record<string, unknown>;
	return (
		r.schemaVersion === SKILL_ADMISSION_SCHEMA_VERSION &&
		r.policyRevision === SKILL_ADMISSION_POLICY_REVISION &&
		typeof r.skillId === "string" &&
		typeof r.digest === "string" &&
		typeof r.requestId === "string" &&
		(r.digestMode === undefined || r.digestMode === "body") &&
		(r.status === "reserved" || r.status === "admitted" || r.status === "released")
	);
}

/** Pure ledger. `reserve` is synchronous, so a check-and-take runs in one JS turn (SK2). */
export class SkillAdmissionLedger {
	readonly cap: number;
	/** Slot key -> status of the slot; `released` slots are removed. */
	private readonly slots = new Map<string, { requestId: string; status: "reserved" | "admitted" }>();
	private readonly byRequest = new Map<string, string>();
	private legacyOverCap = false;
	private unknownRecord = false;
	private seq = 0;

	constructor(cap: number = SKILL_ADMISSION_CAP) {
		this.cap = cap;
	}

	/** Rebuild from persisted records (oldest first). Reserved-but-never-settled slots stay held (conservative). */
	static restore(records: readonly SkillAdmissionRecord[], cap: number = SKILL_ADMISSION_CAP): SkillAdmissionLedger {
		const ledger = new SkillAdmissionLedger(cap);
		for (const record of records) ledger.apply(record);
		return ledger;
	}

	/** SK7: a session with no ledger but more than `cap` delivered bodies refuses new admissions. */
	markLegacy(deliveredUniqueBodies: number): void {
		if (deliveredUniqueBodies > this.cap) this.legacyOverCap = true;
	}

	/** A record with an unknown schemaVersion/policyRevision was seen: fail closed, refuse every new admission. */
	markUnknownRecord(): void {
		this.unknownRecord = true;
	}

	get isFailedClosed(): boolean {
		return this.unknownRecord;
	}

	get isLegacyOverCap(): boolean {
		return this.legacyOverCap;
	}

	/** Slots counted against the cap: reserved + admitted. */
	get used(): number {
		return this.slots.size;
	}

	get admitted(): number {
		let n = 0;
		for (const slot of this.slots.values()) if (slot.status === "admitted") n++;
		return n;
	}

	reserve(skillId: string, digest: string): SkillAdmissionDecision {
		const key = slotKey(skillId, digest);
		const existing = this.slots.get(key);
		if (existing) return { ok: true, requestId: existing.requestId, reused: true };
		if (this.unknownRecord) return { ok: false, reason: "unknown_record" };
		if (this.legacyOverCap) return { ok: false, reason: "legacy_over_cap" };
		if (this.slots.size >= this.cap) return { ok: false, reason: "cap" };
		this.seq++;
		const requestId = `sa-${this.seq}-${digest.slice(0, 12)}`;
		this.slots.set(key, { requestId, status: "reserved" });
		this.byRequest.set(requestId, key);
		return { ok: true, requestId, reused: false };
	}

	commit(requestId: string): boolean {
		const key = this.byRequest.get(requestId);
		const slot = key ? this.slots.get(key) : undefined;
		if (!slot) return false;
		slot.status = "admitted";
		return true;
	}

	/** Only when failure before send is certain. Admitted slots are never released. */
	release(requestId: string): boolean {
		const key = this.byRequest.get(requestId);
		const slot = key ? this.slots.get(key) : undefined;
		if (!key || !slot || slot.status !== "reserved") return false;
		this.slots.delete(key);
		this.byRequest.delete(requestId);
		return true;
	}

	private apply(record: SkillAdmissionRecord): void {
		const key = slotKey(record.skillId, record.digest);
		const seq = Number.parseInt(record.requestId.split("-")[1] ?? "", 10);
		if (Number.isFinite(seq) && seq > this.seq) this.seq = seq;
		if (record.status === "released") {
			const slot = this.slots.get(key);
			if (slot?.status === "reserved") {
				this.slots.delete(key);
				this.byRequest.delete(slot.requestId);
			}
			return;
		}
		const slot = this.slots.get(key);
		if (slot) {
			if (record.status === "admitted") slot.status = "admitted";
			return;
		}
		this.slots.set(key, { requestId: record.requestId, status: record.status });
		this.byRequest.set(record.requestId, key);
	}
}

export function makeSkillAdmissionRecord(
	skillId: string,
	digest: string,
	source: SkillAdmissionSource,
	status: SkillAdmissionStatus,
	requestId: string,
): SkillAdmissionRecord {
	return {
		schemaVersion: SKILL_ADMISSION_SCHEMA_VERSION,
		policyRevision: SKILL_ADMISSION_POLICY_REVISION,
		skillId,
		digest,
		source,
		status,
		requestId,
		digestMode: "body",
	};
}
