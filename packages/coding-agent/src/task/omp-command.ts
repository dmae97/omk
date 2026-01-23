import process from "node:process";

interface OmpCommand {
	cmd: string;
	args: string[];
	shell: boolean;
}

const DEFAULT_CMD = process.platform === "win32" ? "omp.cmd" : "omp";
const DEFAULT_SHELL = process.platform === "win32";

export function resolveOmpCommand(): OmpCommand {
	const envCmd = process.env.OMP_SUBPROCESS_CMD;
	if (envCmd?.trim()) {
		return { cmd: envCmd, args: [], shell: DEFAULT_SHELL };
	}

	const entry = process.argv[1];
	if (entry && (entry.endsWith(".ts") || entry.endsWith(".js"))) {
		return { cmd: process.execPath, args: [entry], shell: false };
	}

	return { cmd: DEFAULT_CMD, args: [], shell: DEFAULT_SHELL };
}
