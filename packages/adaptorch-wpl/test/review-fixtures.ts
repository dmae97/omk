/** Synthetic review fixtures; the original external report and 17 result JSONs were unavailable. */
import type { ReviewEvidenceInput } from "../src/review-evidence.ts";
import type { ReviewRecord, ReviewStore } from "../src/review-store.ts";

export function reviewFixture(): ReviewEvidenceInput {
	return {
		packetId: "synthetic-packet",
		specRevision: "spec-v1",
		disclosureApproved: true,
		specification: [{ id: "bounds", text: "Accept lengths 1 through 10 and reject values outside that range." }],
		diff: "--- a/src/bounds.ts\n+++ b/src/bounds.ts\n@@ -1 +1 @@\n+return length >= 1 && length <= 10;",
		tests: [
			{
				id: "unit",
				specItemIds: ["bounds"],
				command: "npm test -- bounds",
				output: "2 tests passed",
				execution: "executed",
				exitCode: 0,
				executedAt: "2026-10-04T00:00:00Z",
			},
		],
	};
}

/** Tests only. Production requires FileReviewStore or an atomic durable application store. */
export class SyntheticReviewStore implements ReviewStore {
	readonly records = new Map<string, ReviewRecord>();
	async read(key: string) {
		return structuredClone(this.records.get(key));
	}
	async compareAndSwap(key: string, revision: number | null, next: ReviewRecord) {
		if ((this.records.get(key)?.revision ?? null) !== revision) return false;
		this.records.set(key, structuredClone(next));
		return true;
	}
}
