import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadProjectContextFiles } from "../src/core/resource-loader.ts";

describe("Pi 1.2 worktree context compatibility", () => {
	it("keeps a nested worktree symlinked AGENTS.md visible without dropping project context", () => {
		const root = mkdtempSync(join(tmpdir(), "omk-worktree-context-"));
		try {
			const main = join(root, "project");
			const worktree = join(main, ".worktrees", "fixture");
			const agentDir = join(root, "agent");
			mkdirSync(worktree, { recursive: true });
			mkdirSync(agentDir);
			writeFileSync(join(main, "AGENTS.md"), "WORKTREE_CONTEXT_MARKER");
			symlinkSync(join(main, "AGENTS.md"), join(worktree, "AGENTS.md"));
			const files = loadProjectContextFiles({ cwd: worktree, agentDir });
			expect(files.find((file) => file.path === join(worktree, "AGENTS.md"))?.content).toBe(
				"WORKTREE_CONTEXT_MARKER",
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
