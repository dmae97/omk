import type { ExtensionRunner } from "./extensions/runner.ts";
import type { SessionShutdown } from "./session-shutdown.ts";

/** Only a registered command gets a session-replacement control frame. */
export async function tryExecuteSessionCommand(
	text: string,
	runner: ExtensionRunner,
	shutdown: SessionShutdown,
): Promise<boolean> {
	const spaceIndex = text.indexOf(" ");
	const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
	const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);
	const command = runner.getCommand(commandName);
	if (!command) return false;
	const ctx = runner.createCommandContext();
	try {
		await shutdown.runCommand(() => command.handler(args, ctx));
	} catch (error) {
		runner.emitError({
			extensionPath: `command:${commandName}`,
			event: "command",
			error: error instanceof Error ? error.message : String(error),
		});
	}
	return true;
}
