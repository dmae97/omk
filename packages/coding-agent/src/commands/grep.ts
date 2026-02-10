/**
 * Test grep tool.
 */
import { Args, Command, Flags } from "@oh-my-pi/pi-utils/cli";
import { type GrepCommandArgs, runGrepCommand } from "../cli/grep-cli";
import { initTheme } from "../modes/theme/theme";

export default class Grep extends Command {
	static description = "Test grep tool";

	static args = {
		pattern: Args.string({ description: "Regex pattern to search for", required: false }),
		path: Args.string({ description: "Directory or file to search", required: false }),
	};

	static flags = {
		glob: Flags.string({ char: "g", description: "Filter files by glob pattern" }),
		limit: Flags.integer({ char: "l", description: "Max matches", default: 20 }),
		context: Flags.integer({ char: "C", description: "Context lines", default: 2 }),
		files: Flags.boolean({ char: "f", description: "Output file names only" }),
		count: Flags.boolean({ char: "c", description: "Output match counts per file" }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Grep);

		const mode: GrepCommandArgs["mode"] = flags.count ? "count" : flags.files ? "filesWithMatches" : "content";

		const cmd: GrepCommandArgs = {
			pattern: args.pattern ?? "",
			path: args.path ?? ".",
			glob: flags.glob,
			limit: flags.limit,
			context: flags.context,
			mode,
		};

		await initTheme();
		await runGrepCommand(cmd);
	}
}
