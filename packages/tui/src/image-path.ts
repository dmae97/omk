import { homedir } from "node:os";

/** Shorten home-prefixed absolute paths to ~/... for compact display. */
export function shortenImagePath(filename: string): string {
	const home = homedir();
	if (home && (filename === home || filename.startsWith(`${home}/`) || filename.startsWith(`${home}\\`))) {
		return `~${filename.slice(home.length)}`;
	}
	return filename;
}
