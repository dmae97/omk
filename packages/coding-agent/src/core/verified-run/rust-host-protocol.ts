import { VerifiedRunError } from "./storage.ts";

export type RustHostEvent =
	| { readonly type: "spawned"; readonly pid: number }
	| { readonly type: "ready"; readonly info: unknown }
	| { readonly type: "output"; readonly channel: "stdout" | "stderr"; readonly data: Buffer }
	| {
			readonly type: "finished";
			readonly exitCode: number | null;
			readonly failure: string | null;
			readonly durationMs: number;
	  }
	| { readonly type: "error"; readonly code: string };

export function parseRustHostEvent(line: string, requestId: string): RustHostEvent {
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch {
		throw new VerifiedRunError("native_host_protocol");
	}
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new VerifiedRunError("native_host_protocol");
	const row = value as Record<string, unknown>;
	if (row.requestId !== requestId) throw new VerifiedRunError("native_host_protocol");
	const keys = (fields: readonly string[]) =>
		Object.keys(row).length === fields.length + 2 &&
		Object.keys(row).every((key) => ["type", "requestId", ...fields].includes(key));
	switch (row.type) {
		case "spawned":
			if (keys(["pid"]) && typeof row.pid === "number" && Number.isSafeInteger(row.pid) && row.pid > 1)
				return { type: "spawned", pid: row.pid };
			break;
		case "ready":
			if (keys(["info"]) && typeof row.info === "object" && row.info !== null && !Array.isArray(row.info))
				return { type: "ready", info: row.info };
			break;
		case "output":
			if (
				keys(["channel", "data"]) &&
				(row.channel === "stdout" || row.channel === "stderr") &&
				Array.isArray(row.data) &&
				row.data.length <= 4096 &&
				row.data.every((n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 255)
			)
				return { type: "output", channel: row.channel, data: Buffer.from(row.data) };
			break;
		case "finished":
			if (
				keys(["exitCode", "failure", "durationMs"]) &&
				(row.exitCode === null ||
					(typeof row.exitCode === "number" &&
						Number.isInteger(row.exitCode) &&
						row.exitCode >= 0 &&
						row.exitCode <= 255)) &&
				(row.failure === null || (typeof row.failure === "string" && /^[a-z_]{1,64}$/.test(row.failure))) &&
				typeof row.durationMs === "number" &&
				Number.isSafeInteger(row.durationMs) &&
				row.durationMs >= 0
			)
				return { type: "finished", exitCode: row.exitCode, failure: row.failure, durationMs: row.durationMs };
			break;
		case "error":
			if (keys(["code"]) && typeof row.code === "string" && /^[a-z_]{1,64}$/.test(row.code))
				return { type: "error", code: row.code };
			break;
	}
	throw new VerifiedRunError("native_host_protocol");
}
