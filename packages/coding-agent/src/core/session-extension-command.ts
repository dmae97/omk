import type { ExtensionRunner } from "./extensions/runner.ts";
import type { SessionShutdown } from "./session-shutdown.ts";

function commandName(text: string): string {
	const spaceIndex = text.indexOf(" ");
	return spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
}

/** Whether `/name args` names a registered command, which runs at once instead of starting a turn. */
export function isSessionCommand(text: string, runner: ExtensionRunner): boolean {
	return text.startsWith("/") && runner.getCommand(commandName(text)) !== undefined;
}

/** Only a registered command gets a session-replacement control frame. */
export async function tryExecuteSessionCommand(
	text: string,
	runner: ExtensionRunner,
	shutdown: SessionShutdown,
): Promise<boolean> {
	const spaceIndex = text.indexOf(" ");
	const name = commandName(text);
	const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);
	const command = runner.getCommand(name);
	if (!command) return false;
	const ctx = runner.createCommandContext();
	try {
		await shutdown.runCommand(() => command.handler(args, ctx));
	} catch (error) {
		runner.emitError({
			extensionPath: `command:${name}`,
			event: "command",
			error: error instanceof Error ? error.message : String(error),
		});
	}
	return true;
}
