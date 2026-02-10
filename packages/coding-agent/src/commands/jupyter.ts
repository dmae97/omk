/**
 * Manage the shared Jupyter gateway.
 */
import { Args, Command } from "@oh-my-pi/pi-utils/cli";
import { type JupyterAction, type JupyterCommandArgs, runJupyterCommand } from "../cli/jupyter-cli";
import { initTheme } from "../modes/theme/theme";

const ACTIONS: JupyterAction[] = ["kill", "status"];

export default class Jupyter extends Command {
	static description = "Manage the shared Jupyter gateway";

	static args = {
		action: Args.string({
			description: "Jupyter action",
			required: false,
			options: ACTIONS,
		}),
	};

	async run(): Promise<void> {
		const { args } = await this.parse(Jupyter);
		const action = (args.action ?? "status") as JupyterAction;

		const cmd: JupyterCommandArgs = {
			action,
		};

		await initTheme();
		await runJupyterCommand(cmd);
	}
}
