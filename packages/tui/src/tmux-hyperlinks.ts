import { execFileSync } from "node:child_process";

export type TmuxRunner = (args: readonly string[]) => string;

function defaultRunTmux(args: readonly string[]): string {
	return execFileSync("tmux", [...args], {
		encoding: "utf8",
		timeout: 250,
		stdio: ["ignore", "pipe", "ignore"],
	});
}

export function probeTmuxHyperlinks(runTmux: TmuxRunner = defaultRunTmux): boolean {
	try {
		const clientFeatures = runTmux(["display-message", "-p", "#{client_termfeatures}"]).trim();
		if (clientFeatures.length > 0) {
			return clientFeatures
				.split(",")
				.map((feature) => feature.trim())
				.includes("hyperlinks");
		}
		// Detached startup (e.g. `tmux new-session -d` before attach) has no client yet;
		// check server terminal-features so OSC 8 is not permanently disabled by startup order.
		const serverFeatures = runTmux(["show", "-sv", "terminal-features"]);
		return /(?:^|:|,)hyperlinks(?::|,|$)/m.test(serverFeatures);
	} catch {
		return false;
	}
}
