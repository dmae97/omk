import { describe, expect, it } from "vitest";
import type { CommandRisk } from "../src/core/command-safety.ts";
import {
	classifyShellCommand,
	isDestructiveFilesystem,
	isPrivilegeEscalation,
	isProtectedGitOperation,
} from "../src/core/command-safety.ts";

function expectVerdict(command: string, risk: CommandRisk, rule: string): void {
	const verdict = classifyShellCommand(command);
	expect(verdict).toMatchObject({ risk, rule });
	expect(verdict.reason.length).toBeGreaterThan(0);
}

describe("command safety classifier", () => {
	it("blocks non-negotiable destructive filesystem patterns", () => {
		expectVerdict("rm -rf /", "block", "fs.rm_rf_root");
		expectVerdict("sudo rm -rf /", "block", "fs.rm_rf_root");
		expectVerdict("rm -fr ~", "block", "fs.rm_rf_home");
		expectVerdict("mkfs.ext4 /dev/sda", "block", "fs.mkfs");
		expectVerdict("dd if=/dev/zero of=/dev/sda", "block", "fs.dd_block_device");
		expectVerdict(":(){ :|:& };:", "block", "process.fork_bomb");
	});

	it("requires confirmation for protected privilege and git operations", () => {
		expectVerdict("git reset --hard HEAD~1", "confirm", "git.reset_hard");
		expectVerdict("git clean -fd", "confirm", "git.clean_force");
		expectVerdict("git add -A", "confirm", "git.add_all");
		expectVerdict("git commit --no-verify -m x", "confirm", "git.no_verify");
		expectVerdict("git push --force", "confirm", "git.force_push");
		expectVerdict("sudo apt update", "confirm", "priv.sudo");
	});

	it("allows ordinary scoped commands", () => {
		expectVerdict("ls -la", "allow", "command.allow");
		expectVerdict("git status", "allow", "command.allow");
		expectVerdict("npm run check", "allow", "command.allow");
		expectVerdict("rm -rf node_modules/.cache", "allow", "command.allow");
		expectVerdict("rm -rf ./dist", "allow", "command.allow");
		expectVerdict("git add packages/coding-agent/src/foo.ts", "allow", "command.allow");
	});

	it("returns the highest severity verdict across compound commands", () => {
		expectVerdict("npm ci && git reset --hard", "confirm", "git.reset_hard");
		expectVerdict("echo hi; rm -rf /", "block", "fs.rm_rf_root");
		expectVerdict("sleep 1 & rm -rf /", "block", "fs.rm_rf_root");
		expectVerdict("echo hi\nrm -rf /", "block", "fs.rm_rf_root");
		expectVerdict("build &", "allow", "command.allow");
	});

	it("normalizes env prefixes, whitespace, sudo prefixes, and rm flag order", () => {
		expectVerdict("  FOO=bar   sudo   rm   -fr   /  ", "block", "fs.rm_rf_root");
		expectVerdict("rm -Rf /*", "block", "fs.rm_rf_root");
		expectVerdict("git clean -d -f", "confirm", "git.clean_force");
	});

	it("exposes reusable predicate helpers", () => {
		expect(isDestructiveFilesystem("sudo rm -rf /")).toBe(true);
		expect(isDestructiveFilesystem("rm -rf node_modules/.cache")).toBe(false);
		expect(isProtectedGitOperation("git add -A")).toBe(true);
		expect(isProtectedGitOperation("git add packages/coding-agent/src/foo.ts")).toBe(false);
		expect(isPrivilegeEscalation("FOO=bar sudo apt update")).toBe(true);
		expect(isPrivilegeEscalation("npm run check")).toBe(false);
	});

	it("is deterministic for repeated classifications", () => {
		const command = " npm ci && git push --force ";
		expect(classifyShellCommand(command)).toEqual(classifyShellCommand(command));
	});
});
