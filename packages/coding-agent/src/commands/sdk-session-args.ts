export const SDK_SESSION_USAGE = [
	"Usage:",
	"  omk sdk session status [id] [--cwd <path>] [--session-dir <path>] [--json]",
	"  omk sdk session tail [id] [--cwd <path>] [--session-dir <path>] [--limit <n>]",
	"  omk sdk session inspect [id] [--cwd <path>] [--session-dir <path>]",
	"  omk sdk session send <id> <message> [--cwd <path>] [--session-dir <path>] [--live [--steer|--follow-up]]",
	"  omk sdk session status <id> --live",
	"  omk sdk session abort <id> --live",
].join("\n");

type ParsedArgs =
	| { kind: "absent" }
	| { kind: "help" }
	| { kind: "error"; message: string }
	| {
			kind: "run";
			action: "status" | "tail" | "inspect" | "send" | "abort";
			live: boolean;
			delivery: "prompt" | "steer" | "followUp";
			id?: string;
			cwd?: string;
			sessionDir?: string;
			limit: number;
			json: boolean;
			text?: string;
	  };

export function parseSdkSessionArgs(args: readonly string[]): ParsedArgs {
	if (args[0] !== "sdk" || args[1] !== "session") return { kind: "absent" };
	const rest = args.slice(2);
	if (rest.length === 0 || rest[0] === "--help" || rest[0] === "-h") return { kind: "help" };
	const action = rest[0];
	if (action !== "status" && action !== "tail" && action !== "inspect" && action !== "send" && action !== "abort")
		return { kind: "error", message: `unknown action: ${action}` };
	let id: string | undefined;
	let cwd: string | undefined;
	let sessionDir: string | undefined;
	let limit = 20;
	let json = false;
	let live = false;
	let delivery: "prompt" | "steer" | "followUp" = "prompt";
	const sendParts: string[] = [];
	for (let index = 1; index < rest.length; index += 1) {
		const arg = rest[index];
		if (arg === "--help" || arg === "-h") return { kind: "help" };
		if (arg === "--live") {
			live = true;
			continue;
		}
		if (arg === "--steer" || arg === "--follow-up") {
			if (delivery !== "prompt") return { kind: "error", message: "choose one delivery mode" };
			delivery = arg === "--steer" ? "steer" : "followUp";
			continue;
		}
		if (arg === "--json") {
			json = true;
			continue;
		}
		if (arg === "--cwd") {
			const value = rest[++index];
			if (value === undefined) return { kind: "error", message: "--cwd requires a path" };
			cwd = value;
			continue;
		}
		if (arg === "--session-dir") {
			const value = rest[++index];
			if (value === undefined) return { kind: "error", message: "--session-dir requires a path" };
			sessionDir = value;
			continue;
		}
		if (arg === "--limit") {
			const value = rest[++index];
			const parsed = Number(value);
			if (value === undefined || !Number.isSafeInteger(parsed) || parsed < 1)
				return { kind: "error", message: "--limit requires a positive integer" };
			limit = parsed;
			continue;
		}
		if (arg.startsWith("-")) return { kind: "error", message: `unknown argument: ${arg}` };
		if (id === undefined) {
			id = arg;
			continue;
		}
		if (action === "send") sendParts.push(arg);
		else return { kind: "error", message: `unexpected argument: ${arg}` };
	}
	if (live && (id === undefined || action === "tail" || action === "inspect"))
		return { kind: "error", message: "live control requires an exact id and status, send or abort" };
	if (action === "abort" && !live) return { kind: "error", message: "abort requires --live" };
	if (delivery !== "prompt" && (!live || action !== "send"))
		return { kind: "error", message: "delivery mode requires send --live" };
	if (action === "send") {
		if (id === undefined) return { kind: "error", message: "send requires a session id" };
		const text = sendParts.join(" ").trim();
		if (text.length === 0) return { kind: "error", message: "send requires message text" };
		return { kind: "run", action, id, cwd, sessionDir, limit, json, live, delivery, text };
	}
	return { kind: "run", action, id, cwd, sessionDir, limit, json, live, delivery };
}
