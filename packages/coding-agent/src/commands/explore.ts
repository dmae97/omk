import { exploreCodebase } from "../core/explorer/explorer.ts";

const USAGE = "usage: omk explore <question>";

/** `omk explore <question>`: print a read-only evidence pack of paths and line ranges. */
export async function runExploreCommand(args: string[]): Promise<{ handled: boolean; exitCode: number }> {
	if (args[0] !== "explore") return { handled: false, exitCode: 0 };
	const question = args.slice(1).join(" ").trim();
	if (question === "--help" || question === "-h") {
		process.stdout.write(`${USAGE}\n`);
		return { handled: true, exitCode: 0 };
	}
	if (question.length === 0) {
		process.stderr.write(`${USAGE}\n`);
		return { handled: true, exitCode: 2 };
	}
	const result = await exploreCodebase({ cwd: process.cwd(), question });
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
	return { handled: true, exitCode: 0 };
}
