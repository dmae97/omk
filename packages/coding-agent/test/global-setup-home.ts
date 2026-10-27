/**
 * Hermetic HOME for every way the suite runs. test.sh already points HOME at a throwaway directory,
 * but the documented one-file command (`vitest --run test/x.test.ts`, AGENTS.md) and `npm test` run
 * vitest directly. The resource loader reads user-level directories such as ~/.agents/skills
 * (docs/skills.md), so a developer's personal skills were admitted into test sessions and shifted the
 * session revisions tests assert on.
 *
 * Runs in the main process before any worker starts, so every worker and every process a test spawns
 * inherits the isolated HOME and no module ever sees the real one. One directory per run, as in
 * test.sh, removed on teardown; per-file cleanup missed files that failed to load. Toolchains that
 * locate themselves through HOME keep their real homes, as in test.sh.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default function setup(): () => void {
	const previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
	if (previous.HOME) {
		process.env.RUSTUP_HOME ??= join(previous.HOME, ".rustup");
		process.env.CARGO_HOME ??= join(previous.HOME, ".cargo");
		process.env.COREPACK_HOME ??= join(previous.HOME, ".cache/node/corepack");
		process.env.npm_config_cache ??= join(previous.HOME, ".npm");
	}
	const isolatedHome = mkdtempSync(join(tmpdir(), "omk-test-home-"));
	process.env.HOME = isolatedHome;
	if (process.platform === "win32") process.env.USERPROFILE = isolatedHome;
	return () => {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		rmSync(isolatedHome, { recursive: true, force: true });
	};
}
