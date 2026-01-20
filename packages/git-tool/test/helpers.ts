import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempDirSync } from "@oh-my-pi/pi-utils";
import { type ExecResult, git } from "../src/utils";

export { git, type ExecResult };

export interface TestRepo {
	readonly path: string;
	run(...args: string[]): ExecResult;
	remove(): void;
	writeFile(path: string, content: string): void;
}

export function createTestRepo(): TestRepo {
	const tempDir = createTempDirSync("@wt-test-");
	const repo = {
		_tempDir: tempDir,
		path: tempDir.path,
		remove: () => tempDir.remove(),
		run: (...args: string[]) => {
			const result = Bun.spawnSync(["git", ...args], {
				cwd: tempDir.path,
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
			});
			return {
				stdout: result.stdout.toString(),
				stderr: result.stderr.toString(),
				exitCode: result.exitCode,
			};
		},
		writeFile(path: string, content: string) {
			writeFileSync(join(tempDir.path, path), content);
		},
	};
	repo.run("init", "-b", "main");
	repo.run("config", "user.email", "test@example.com");
	repo.run("config", "user.name", "Test User");
	return repo;
}

export function writeFile(path: string, content: string) {
	writeFileSync(path, content);
}
