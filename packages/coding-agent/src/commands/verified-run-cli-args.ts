import { parseRetention } from "../core/verified-run/run-gc.ts";
import { VerifiedRunError } from "../core/verified-run/storage.ts";

export const USAGE = `Usage: omk run plan --contract FILE [--json]
       omk run start --contract FILE --approve DIGEST --command-id ID [--state-dir DIR]
       omk run inspect|evidence|status|events ID [--state-dir DIR] [--json]
       omk run authority [--state-dir DIR] [--json]
       omk run inspect ID --recovery|--writer-recovery|--task-recovery [--state-dir DIR]
       omk run retry-tasks ID --execute --tasks ID[,ID...]|- --approve DIGEST --base DIGEST --revision N --generation N --command-id ID [--state-dir DIR]
       omk run restart-writer ID --execute --approve DIGEST --base DIGEST --revision N --generation N --command-id ID [--state-dir DIR]
       omk run resume ID --execute --approve DIGEST --candidate DIGEST --revision N --generation N --command-id ID [--state-dir DIR]
       omk run publish ID --execute --contract FILE --approve DIGEST --candidate DIGEST --parent OID --receipt DIGEST --revision N --generation N --command-id ID [--state-dir DIR]
       omk run artifact ID --candidate DIGEST --path PATH [--state-dir DIR]
       omk run cancel ID [--wait-ms N] [--state-dir DIR] [--json]
       omk run gc [--older-than DURATION] [--execute] [--state-dir DIR] [--json]
The opt-in command, scripted-agent and bounded command-DAG profiles never apply changes to the original workspace.
Resume rechecks a fixed candidate. Writer/task recovery preserves input checkpoints and budgets. Command-DAG concurrency defaults to 1 and supports an explicit cap of 2.
Cancel (SIGINT, SIGTERM or omk run cancel from another shell) pauses the run: restart-writer, resume or retry-tasks continue it inside the original budget.
GC removes only derived workspaces of runs that can no longer recover (default --older-than 7d); without --execute it reports what it would remove.
Plan amendment, managed apply and TUI/RPC control are not implemented.`;

const ACTIONS = [
	"plan",
	"start",
	"resume",
	"restart-writer",
	"retry-tasks",
	"publish",
	"cancel",
	"gc",
	"inspect",
	"status",
	"events",
	"authority",
	"evidence",
	"artifact",
] as const;
const SWITCHES = ["--json", "--execute", "--recovery", "--writer-recovery", "--task-recovery"];
const RECOVERY = ["--execute", "--approve", "--revision", "--generation", "--command-id", "--state-dir", "--json"];
const PUBLISH = ["--contract", "--candidate", "--parent", "--receipt", ...RECOVERY];

export interface Parsed {
	readonly action: (typeof ACTIONS)[number];
	readonly id: string | undefined;
	readonly flags: ReadonlyMap<string, string>;
}

function allowedFlags(action: Parsed["action"]): readonly string[] {
	switch (action) {
		case "plan":
			return ["--contract", "--json"];
		case "start":
			return ["--contract", "--approve", "--command-id", "--state-dir", "--json"];
		case "resume":
			return ["--candidate", ...RECOVERY];
		case "restart-writer":
			return ["--base", ...RECOVERY];
		case "retry-tasks":
			return ["--base", "--tasks", ...RECOVERY];
		case "publish":
			return PUBLISH;
		case "artifact":
			return ["--candidate", "--path", "--state-dir", "--json"];
		case "inspect":
			return ["--state-dir", "--json", "--recovery", "--writer-recovery", "--task-recovery"];
		case "cancel":
			return ["--wait-ms", "--state-dir", "--json"];
		case "gc":
			return ["--older-than", "--execute", "--state-dir", "--json"];
		default:
			return ["--state-dir", "--json"];
	}
}

export function parse(args: readonly string[]): Parsed {
	const action = ACTIONS.find((name) => name === args[1]);
	if (!action) throw new VerifiedRunError("usage");
	const hasId = action !== "plan" && action !== "start" && action !== "authority" && action !== "gc";
	const id = hasId ? args[2] : undefined;
	if (hasId && (!id || id.startsWith("--"))) throw new VerifiedRunError("usage");
	const allowed = allowedFlags(action);
	const flags = new Map<string, string>();
	for (let index = hasId ? 3 : 2; index < args.length; index++) {
		const flag = args[index];
		if (!allowed.includes(flag) || flags.has(flag)) throw new VerifiedRunError("usage");
		const value = SWITCHES.includes(flag) ? "true" : args[++index];
		if (!value || value.startsWith("--")) throw new VerifiedRunError("usage");
		flags.set(flag, value);
	}
	if (["--recovery", "--writer-recovery", "--task-recovery"].filter((flag) => flags.has(flag)).length > 1)
		throw new VerifiedRunError("usage");
	return { action, id, flags };
}

export function required(parsed: Parsed, name: string): string {
	const value = parsed.flags.get(name);
	if (!value) throw new VerifiedRunError("usage");
	return value;
}

/** How long `cancel` waits for the owner to release the run: 0–600000 ms, default 10000. */
export function waitMs(parsed: Parsed): number {
	const text = parsed.flags.get("--wait-ms") ?? "10000";
	const value = /^(0|[1-9][0-9]{0,5})$/.test(text) ? Number(text) : Number.NaN;
	if (!(value <= 600000)) throw new VerifiedRunError("usage");
	return value;
}

export const retention = (parsed: Parsed): number => parseRetention(parsed.flags.get("--older-than") ?? "7d");
