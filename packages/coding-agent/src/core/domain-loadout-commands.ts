import type { LoadoutCommands } from "./loadouts.ts";

export function commands(mode: LoadoutCommands["mode"], extras?: Partial<LoadoutCommands>): LoadoutCommands {
	return { mode, ...extras };
}
