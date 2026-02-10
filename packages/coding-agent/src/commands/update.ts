/**
 * Check for and install updates.
 */
import { Command, Flags } from "@oh-my-pi/pi-utils/cli";
import { runUpdateCommand } from "../cli/update-cli";
import { initTheme } from "../modes/theme/theme";

export default class Update extends Command {
	static description = "Check for and install updates";

	static flags = {
		force: Flags.boolean({ char: "f", description: "Force update", default: false }),
		check: Flags.boolean({ char: "c", description: "Check for updates without installing", default: false }),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(Update);
		await initTheme();
		await runUpdateCommand({ force: flags.force, check: flags.check });
	}
}
