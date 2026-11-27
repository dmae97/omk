import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceSandboxPolicy } from "../src/core/sandbox/default-policy.ts";
import { resolveSandboxPath } from "../src/core/sandbox/path-resolver.ts";
import { decidePathAccess, type SandboxPolicy } from "../src/core/sandbox/policy.ts";
import { createWorkspaceWriteGuard } from "../src/core/tools/workspace-write-guard.ts";

let root: string;

beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "omk-p0-sandbox-")));
	mkdirSync(join(root, ".git", "hooks"), { recursive: true });
	writeFileSync(join(root, ".git", "config"), "[core]\n");
	writeFileSync(join(root, ".env"), "SECRET=1\n");
	writeFileSync(join(root, "normal.ts"), "export const ok = true;\n");
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("P0-2: permission and sandbox execution boundary hardening", () => {
	it("blocks symlink-to-secret bypass even when followSymlinks is enabled", () => {
		const alias = join(root, "innocent-notes.txt");
		symlinkSync(join(root, ".env"), alias);
		const policy: SandboxPolicy = {
			...createWorkspaceSandboxPolicy(root, "enforce"),
			filesystem: {
				...createWorkspaceSandboxPolicy(root, "enforce").filesystem,
				followSymlinks: true as unknown as false,
			},
		};
		const decision = decidePathAccess(policy, { kind: "read", path: alias }, (p) => resolveSandboxPath(root, p));
		expect(decision.allowed).toBe(false);
		expect(decision.rule).toBe("path.secret");
	});

	it("protects existing .git/hooks and .git/config in default workspace sandbox denyWrite", () => {
		const policy = createWorkspaceSandboxPolicy(root, "enforce");
		expect(policy.filesystem.denyWrite).toContain(join(root, ".git", "hooks"));
		expect(policy.filesystem.denyWrite).toContain(join(root, ".git", "config"));

		const hookWrite = decidePathAccess(
			policy,
			{ kind: "write", path: join(root, ".git", "hooks", "pre-commit") },
			(p) => resolveSandboxPath(root, p),
		);
		expect(hookWrite.allowed).toBe(false);
		expect(hookWrite.rule).toBe("path.deny_write");

		const normalWrite = decidePathAccess(policy, { kind: "write", path: join(root, "normal.ts") }, (p) =>
			resolveSandboxPath(root, p),
		);
		expect(normalWrite.allowed).toBe(true);
	});

	it("blocks write/edit tool writes targeting .git/hooks directly or through a symlink", () => {
		const guard = createWorkspaceWriteGuard([root]);
		const direct = guard(join(root, ".git", "hooks", "post-checkout"));
		expect(direct.allowed).toBe(false);

		const hookAlias = join(root, "safe-looking-dir");
		symlinkSync(join(root, ".git", "hooks"), hookAlias, "dir");
		const viaLink = guard(join(hookAlias, "pre-push"));
		expect(viaLink.allowed).toBe(false);

		// Normal workspace writes remain allowed.
		expect(guard(join(root, "normal.ts")).allowed).toBe(true);
	});
});
