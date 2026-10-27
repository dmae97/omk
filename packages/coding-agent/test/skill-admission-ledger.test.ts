import { describe, expect, it } from "vitest";
import {
	isSkillAdmissionEnabled,
	isSkillAdmissionRecord,
	makeSkillAdmissionRecord,
	SKILL_ADMISSION_CAP,
	SKILL_ADMISSION_POLICY_REVISION,
	SkillAdmissionLedger,
	type SkillAdmissionRecord,
	skillBodyDigest,
} from "../src/core/skill-admission-ledger.ts";

const d = (s: string) => skillBodyDigest(s);

describe("spec 106 A1 skill admission ledger", () => {
	it("flag parsing is default on; 0/false/off opt out", () => {
		expect(isSkillAdmissionEnabled({})).toBe(true);
		expect(isSkillAdmissionEnabled({ OMK_SKILL_ADMISSION: "0" })).toBe(false);
		expect(isSkillAdmissionEnabled({ OMK_SKILL_ADMISSION: " FALSE " })).toBe(false);
		expect(isSkillAdmissionEnabled({ OMK_SKILL_ADMISSION: "off" })).toBe(false);
		expect(isSkillAdmissionEnabled({ OMK_SKILL_ADMISSION: "1" })).toBe(true);
	});

	it("SK2: 9 admitted, two different new reservations in flight -> exactly one ok, cap holds with reservations", () => {
		const ledger = new SkillAdmissionLedger();
		for (let i = 0; i < 9; i++) {
			const r = ledger.reserve(`s${i}`, d(`b${i}`));
			if (!r.ok) throw new Error("unexpected");
			ledger.commit(r.requestId);
		}
		const a = ledger.reserve("new-a", d("a"));
		const b = ledger.reserve("new-b", d("b"));
		expect([a.ok, b.ok]).toEqual([true, false]);
		expect(b).toEqual({ ok: false, reason: "cap" });
		expect(ledger.used).toBe(SKILL_ADMISSION_CAP);
		if (a.ok) expect(ledger.release(a.requestId)).toBe(true);
		expect(ledger.reserve("new-b", d("b")).ok).toBe(true);
	});

	it("SK4: same body reuses its slot, a new digest takes a new slot, admitted slots are never released", () => {
		const ledger = new SkillAdmissionLedger();
		const first = ledger.reserve("pdf", d("v1"));
		if (!first.ok) throw new Error("unexpected");
		ledger.commit(first.requestId);
		expect(ledger.reserve("pdf", d("v1"))).toMatchObject({ ok: true, reused: true });
		expect(ledger.used).toBe(1);
		expect(ledger.reserve("pdf", d("v2"))).toMatchObject({ ok: true, reused: false });
		expect(ledger.used).toBe(2);
		expect(ledger.release(first.requestId)).toBe(false);
	});

	it("restore keeps the count and the cap (never reset to 0)", () => {
		const records = Array.from({ length: 10 }, (_, i) =>
			makeSkillAdmissionRecord(`s${i}`, d(`b${i}`), "explicit", "admitted", `sa-${i + 1}-x`),
		);
		const ledger = SkillAdmissionLedger.restore(records);
		expect(ledger.admitted).toBe(10);
		expect(ledger.reserve("eleventh", d("e"))).toEqual({ ok: false, reason: "cap" });
		expect(ledger.reserve("s3", d("b3"))).toMatchObject({ ok: true, reused: true });
	});

	it("SK7: legacy session with >10 bodies refuses new admissions", () => {
		const ledger = SkillAdmissionLedger.restore([]);
		ledger.markLegacy(11);
		expect(ledger.reserve("x", d("x"))).toEqual({ ok: false, reason: "legacy_over_cap" });
	});

	it("invariant guard: 200 seeded random reserve/commit/release interleavings, 0 cap violations", () => {
		let seed = 106;
		const rand = () => {
			seed = (seed * 1103515245 + 12345) % 2147483648;
			return seed / 2147483648;
		};
		let violations = 0;
		for (let run = 0; run < 200; run++) {
			const ledger = new SkillAdmissionLedger();
			const pending: string[] = [];
			for (let step = 0; step < 60; step++) {
				const op = rand();
				if (op < 0.6) {
					const r = ledger.reserve(`s${Math.floor(rand() * 20)}`, d(`v${Math.floor(rand() * 2)}`));
					if (r.ok && !r.reused) pending.push(r.requestId);
				} else if (pending.length > 0) {
					const id = pending.splice(Math.floor(rand() * pending.length), 1)[0] as string;
					if (op < 0.85) ledger.commit(id);
					else ledger.release(id);
				}
				if (ledger.used > SKILL_ADMISSION_CAP) violations++;
			}
		}
		expect(violations).toBe(0);
	});

	it("digestMode: records with and without the field are known; a #209-style record restores", () => {
		const r209 = {
			schemaVersion: 1,
			policyRevision: SKILL_ADMISSION_POLICY_REVISION,
			skillId: "old",
			digest: "d209",
			source: "explicit",
			status: "admitted",
			requestId: "sa-1-d209",
		};
		expect(isSkillAdmissionRecord(r209)).toBe(true);
		expect(isSkillAdmissionRecord({ ...r209, digestMode: "body" })).toBe(true);
		expect(isSkillAdmissionRecord({ ...r209, digestMode: "other" })).toBe(false);
		expect(makeSkillAdmissionRecord("a", "d", "read", "admitted", "sa-2-d").digestMode).toBe("body");
		const ledger = SkillAdmissionLedger.restore([r209 as SkillAdmissionRecord]);
		expect(ledger.isFailedClosed).toBe(false);
		expect(ledger.used).toBe(1);
		expect(ledger.reserve("old", "d209")).toMatchObject({ ok: true, reused: true });
	});
});
