/**
 * Custom help renderer for the coding agent CLI.
 */
import { CommandHelp, Help } from "@oclif/core";
import { getExtraHelpText } from "./args";

export default class OclifHelp extends Help {
	protected async showRootHelp(): Promise<void> {
		await super.showRootHelp();
		const rootCommand = this.config.findCommand("index");
		if (rootCommand) {
			const rootHelp = new CommandHelp(rootCommand, this.config, {
				...this.opts,
				sections: ["arguments", "flags", "examples"],
			});
			const output = rootHelp.generate();
			if (output.trim().length > 0) {
				process.stdout.write(`\n${output}\n`);
			}
		}
		const extra = getExtraHelpText();
		if (extra.trim().length > 0) {
			process.stdout.write(`\n${extra}\n`);
		}
	}
}
