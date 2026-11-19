import { VerifiedRunError } from "./storage.ts";

export interface NativePhaseDeadline {
	readonly bootId: string;
	readonly deadlineMs: number;
}

export function parseNativePhaseDeadline(raw: unknown): NativePhaseDeadline {
	if (
		typeof raw !== "object" ||
		raw === null ||
		Array.isArray(raw) ||
		Object.keys(raw).sort().join(",") !== "bootId,deadlineMs" ||
		!("bootId" in raw) ||
		typeof raw.bootId !== "string" ||
		!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(raw.bootId) ||
		!("deadlineMs" in raw) ||
		typeof raw.deadlineMs !== "number" ||
		!Number.isSafeInteger(raw.deadlineMs) ||
		raw.deadlineMs <= 0
	)
		throw new VerifiedRunError("integrity");
	return Object.freeze({ bootId: raw.bootId, deadlineMs: raw.deadlineMs });
}
