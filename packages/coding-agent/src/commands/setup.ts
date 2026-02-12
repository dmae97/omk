/**
 * Install dependencies for optional features.
 */
import { Args, Command, Flags, renderCommandHelp } from "@oh-my-pi/pi-utils/cli";
import { runSetupCommand, type SetupCommandArgs, type SetupComponent } from "../cli/setup-cli";
import { initTheme } from "../modes/theme/theme";

const COMPONENTS: SetupComponent[] = ["python"];

export default class Setup extends Command {
	static description = "Install dependencies for optional features";

	static args = {
		component: Args.string({
			description: "Component to install",
			required: false,
			options: COMPONENTS,
		}),
	};

	static flags = {
		check: Flags.boolean({ char: "c", description: "Check if dependencies are installed" }),
		json: Flags.boolean({ description: "Output status as JSON" }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Setup);
		if (!args.component) {
			renderCommandHelp("omp", "setup", Setup);
			return;
		}
		const cmd: SetupCommandArgs = {
			component: args.component as SetupComponent,
			flags: {
				json: flags.json,
				check: flags.check,
			},
		};
		await initTheme();
		await runSetupCommand(cmd);
	}
}
