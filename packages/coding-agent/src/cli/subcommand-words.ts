/**
 * First CLI words owned by the handlers in commands/run-command.ts and by
 * codexbar-cli.ts (`omk quota`).
 *
 * main.ts checks these before importing either module, so a headless
 * `-p --mode json` worker never loads the doctor/stats/provider/verified-run
 * handlers and their dependencies (spec 043). runCommand() applies the same
 * check first, so a handler that answers a word missing here fails its own
 * tests instead of silently becoming unreachable from main().
 */

/** Legacy `omk --doctor-provider <id>` alias; accepted anywhere in argv. */
export const DOCTOR_PROVIDER_FLAG = "--doctor-provider";

export const RUN_COMMAND_WORDS = ["provider", "run", "session", "doctor", "stats", "sdk", "router-feedback"] as const;

export const QUOTA_COMMAND = "quota";

/** Whether this argv may belong to a commands/run-command.ts handler. */
export function mayBeRunCommand(args: readonly string[]): boolean {
	return (RUN_COMMAND_WORDS as readonly string[]).includes(args[0] ?? "") || args.includes(DOCTOR_PROVIDER_FLAG);
}

/** Whether main.ts must hand this argv to codexbar-cli.ts. */
export function isQuotaCommand(args: readonly string[]): boolean {
	return args[0] === QUOTA_COMMAND;
}
