import { spawn } from "node:child_process";

async function runTmuxShow(option: string): Promise<string | undefined> {
	return new Promise((resolve) => {
		const proc = spawn("tmux", ["show", "-gv", option], { stdio: ["ignore", "pipe", "ignore"] });
		let stdout = "";
		const timer = setTimeout(() => {
			proc.kill();
			resolve(undefined);
		}, 2000);
		proc.stdout?.on("data", (data) => {
			stdout += data.toString();
		});
		proc.on("error", () => {
			clearTimeout(timer);
			resolve(undefined);
		});
		proc.on("close", (code) => {
			clearTimeout(timer);
			resolve(code === 0 ? stdout.trim() : undefined);
		});
	});
}

export async function checkTmuxKeyboardSetup(): Promise<string | undefined> {
	if (!process.env.TMUX) return undefined;
	const [extendedKeys, extendedKeysFormat] = await Promise.all([
		runTmuxShow("extended-keys"),
		runTmuxShow("extended-keys-format"),
	]);
	if (extendedKeys === undefined) return undefined;
	if (extendedKeys !== "on" && extendedKeys !== "always") {
		return "tmux extended-keys is off. Modified Enter keys may not work. Add `set -g extended-keys on` to ~/.tmux.conf and restart tmux.";
	}
	if (extendedKeysFormat === "xterm") {
		return "tmux extended-keys-format is xterm. OMK works best with csi-u. Add `set -g extended-keys-format csi-u` to ~/.tmux.conf and restart tmux.";
	}
	return undefined;
}
