import { decideExploration } from "../core/explorer/exploration-policy.ts";
import { exploreCodebase } from "../core/explorer/explorer.ts";

const USAGE = "usage: omk explore [--auto [--searches N] [--files N] [--pressure P]] <question>";

/** `omk explore <question>`: print a read-only evidence pack of paths and line ranges. */
export async function runExploreCommand(args: string[]): Promise<{ handled: boolean; exitCode: number }> {
	if (args[0] !== "explore") return { handled: false, exitCode: 0 };
	let auto = false;
	let searches: number | undefined;
	let files: number | undefined;
	let pressure: number | undefined;
	const rest: string[] = [];
	for (let index = 1; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--auto") auto = true;
		else if (arg === "--searches") searches = Number(args[++index]);
		else if (arg === "--files") files = Number(args[++index]);
		else if (arg === "--pressure") pressure = Number(args[++index]);
		else rest.push(arg);
	}
	const question = rest.join(" ").trim();
	if (question === "--help" || question === "-h") {
		process.stdout.write(`${USAGE}\n`);
		return { handled: true, exitCode: 0 };
	}
	if (question.length === 0) {
		process.stderr.write(`${USAGE}\n`);
		return { handled: true, exitCode: 2 };
	}
	if ([searches, files, pressure].some((value) => value !== undefined && !Number.isFinite(value))) {
		process.stderr.write(`${USAGE}\n`);
		return { handled: true, exitCode: 2 };
	}
	if (auto) {
		const decision = decideExploration({
			expectedSearches: searches,
			expectedFiles: files,
			contextPressure: pressure,
		});
		if (decision.mode === "direct") {
			process.stdout.write(`${JSON.stringify({ decision }, null, 2)}\n`);
			return { handled: true, exitCode: 0 };
		}
		const result = await exploreCodebase({ cwd: process.cwd(), question });
		process.stdout.write(`${JSON.stringify({ decision, result }, null, 2)}\n`);
		return { handled: true, exitCode: 0 };
	}
	const result = await exploreCodebase({ cwd: process.cwd(), question });
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
	return { handled: true, exitCode: 0 };
}
