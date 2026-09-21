import type { RunContract } from "omk-protocol";
import type { RunAuthority } from "./authority-runtime.ts";
import type { VerifiedRunJournal } from "./journal.ts";

export interface RunPhaseContext {
	readonly contract: RunContract;
	readonly runPath: string;
	readonly journal: VerifiedRunJournal;
	readonly authority: RunAuthority;
	readonly signal?: AbortSignal;
}
