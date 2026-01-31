import { describe, expect, it } from "bun:test";
import { __testing as shellSessionTesting } from "@oh-my-pi/pi-coding-agent/exec/shell-session";

describe("shell session wrappers", () => {
	it("builds posix wrapper with cwd, prefix, and marker", () => {
		const script = shellSessionTesting.buildPosixCommandScript(
			"echo hello",
			"/tmp/workdir",
			"strace -f",
			"__OMP_CMD_DONE__abc__",
			{ FOO: "bar" },
		);

		expect(script).toContain("set +e");
		expect(script).toContain("cd -- '/tmp/workdir'");
		expect(script).toContain("export FOO='bar'");
		expect(script).toContain("strace -f echo hello");
		expect(script).toContain('exit() { if [ -n "$1" ]; then return "$1"; else return 0; fi; }');
		expect(script).toContain("trap - INT");
		expect(script).toContain("printf '\\n__OMP_CMD_DONE__abc__%d\\n' \"$__omp_status\"");
	});

	it("builds fish wrapper with marker and restore", () => {
		const script = shellSessionTesting.buildFishCommandScript(
			"echo hi",
			"/tmp/fishdir",
			undefined,
			"__OMP_CMD_DONE__xyz__",
			{ BAR: "baz" },
		);

		expect(script).toContain("cd -- '/tmp/fishdir'");
		expect(script).toContain("set -lx BAR 'baz'");
		expect(script).toContain('printf "\\n__OMP_CMD_DONE__xyz__%d\\n"');
	});
});
