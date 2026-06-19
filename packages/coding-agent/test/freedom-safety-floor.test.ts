import { describe, expect, it } from "vitest";
import {
	checkFsDestructionClause,
	checkPrivilegeClause,
	checkScopeClause,
	checkSecretsClause,
	redactSecrets,
	runSafetyFloor,
	type ToolCallContext,
} from "../src/core/freedom/safety-floor.ts";

function bash(command: string, grant?: ToolCallContext["laneGrant"]): ToolCallContext {
	return { tool: "bash", args: { command }, laneGrant: grant };
}

function read(path: string, grant?: ToolCallContext["laneGrant"]): ToolCallContext {
	return { tool: "read", args: { path }, laneGrant: grant };
}

function write(path: string, grant?: ToolCallContext["laneGrant"]): ToolCallContext {
	return { tool: "write", args: { path }, laneGrant: grant };
}

describe("safety-floor secrets clause", () => {
	it("denies reading .env", () => {
		expect(checkSecretsClause(read("/repo/.env")).kind).toBe("deny-hard");
		expect(checkSecretsClause(read("./.env.local")).kind).toBe("deny-hard");
	});

	it("denies reading SSH private keys", () => {
		expect(checkSecretsClause(read("/home/u/.ssh/id_rsa")).kind).toBe("deny-hard");
		expect(checkSecretsClause(read("/home/u/.ssh/deploy_ed25519")).kind).toBe("deny-hard");
	});

	it("denies reading .pem and .key files", () => {
		expect(checkSecretsClause(read("/etc/server.pem")).kind).toBe("deny-hard");
		expect(checkSecretsClause(read("/etc/server.key")).kind).toBe("deny-hard");
	});

	it("denies basenames containing 'secret' or 'token'", () => {
		expect(checkSecretsClause(read("/repo/my-secret.txt")).kind).toBe("deny-hard");
		expect(checkSecretsClause(read("/repo/auth-token.json")).kind).toBe("deny-hard");
	});

	it("denies bash commands that cat a secret file", () => {
		expect(checkSecretsClause(bash("cat /repo/.env")).kind).toBe("deny-hard");
		expect(checkSecretsClause(bash("less ./.env.production")).kind).toBe("deny-hard");
	});

	it("passes ordinary reads and bash commands", () => {
		expect(checkSecretsClause(read("/repo/src/index.ts")).kind).toBe("pass");
		expect(checkSecretsClause(bash("ls -la /repo")).kind).toBe("pass");
	});
});

describe("safety-floor privilege clause", () => {
	it("requires confirm for sudo regardless of mode", () => {
		expect(checkPrivilegeClause(bash("sudo apt install x")).kind).toBe("require-confirm");
		expect(checkPrivilegeClause(bash("ls && sudo reboot")).kind).toBe("require-confirm");
	});

	it("requires confirm for su, doas, setuid bit, setcap", () => {
		expect(checkPrivilegeClause(bash("su -")).kind).toBe("require-confirm");
		expect(checkPrivilegeClause(bash("doas reboot")).kind).toBe("require-confirm");
		expect(checkPrivilegeClause(bash("chmod u+s /usr/bin/foo")).kind).toBe("require-confirm");
		expect(checkPrivilegeClause(bash("setcap cap_net_raw+ep /usr/bin/foo")).kind).toBe("require-confirm");
	});

	it("passes for ordinary bash", () => {
		expect(checkPrivilegeClause(bash("ls -la /tmp")).kind).toBe("pass");
	});
});

describe("safety-floor fs destruction clause", () => {
	it("hard-denies rm -rf at root or home", () => {
		expect(checkFsDestructionClause(bash("rm -rf /")).kind).toBe("deny-hard");
		expect(checkFsDestructionClause(bash("rm -rf ~")).kind).toBe("deny-hard");
		expect(checkFsDestructionClause(bash("rm -rf $HOME")).kind).toBe("deny-hard");
		expect(checkFsDestructionClause(bash("rm -fr /")).kind).toBe("deny-hard");
	});

	it("hard-denies mkfs and dd to /dev", () => {
		expect(checkFsDestructionClause(bash("mkfs.ext4 /dev/sda1")).kind).toBe("deny-hard");
		expect(checkFsDestructionClause(bash("dd if=/dev/zero of=/dev/sda bs=1M")).kind).toBe("deny-hard");
	});

	it("hard-denies the classic fork bomb signature", () => {
		expect(checkFsDestructionClause(bash(":(){ :|:& };:")).kind).toBe("deny-hard");
	});

	it("passes scoped rm -rf on a subdir", () => {
		expect(checkFsDestructionClause(bash("rm -rf /tmp/build")).kind).toBe("pass");
	});
});

describe("safety-floor scope clause", () => {
	it("passes when no lane grant is supplied", () => {
		expect(checkScopeClause(write("/repo/src/x.ts")).kind).toBe("pass");
	});

	it("denies writes outside writeScope", () => {
		const grant = { writeScope: ["/repo/src/**"] };
		expect(checkScopeClause(write("/etc/passwd", grant)).kind).toBe("deny-hard");
		expect(checkScopeClause(write("/repo/src/foo.ts", grant)).kind).toBe("pass");
	});

	it("denies bash redirects outside executeScope", () => {
		const grant = { executeScope: ["/repo/**"] };
		expect(checkScopeClause(bash("echo x > /etc/hosts", grant)).kind).toBe("deny-hard");
		expect(checkScopeClause(bash("echo x > /repo/out.log", grant)).kind).toBe("pass");
		expect(checkScopeClause(bash("ls", grant)).kind).toBe("pass");
	});
});

describe("redactSecrets", () => {
	it("redacts npm tokens", () => {
		expect(redactSecrets("token: npm_AAAAAAAAAAAAAAAA")).toContain("***REDACTED***");
		expect(redactSecrets("npm_AAAAAAAAAAAAAAAA")).toBe("***REDACTED***");
	});

	it("redacts GitHub and Slack tokens", () => {
		expect(redactSecrets(`auth ghp_${"A".repeat(36)}`)).toContain("***REDACTED***");
		expect(redactSecrets("xoxb-12345-abcdef")).toContain("***REDACTED***");
	});

	it("redacts AWS and OpenAI-style tokens", () => {
		expect(redactSecrets("AKIAABCDEFGHIJ123456")).toContain("***REDACTED***");
		expect(redactSecrets(`sk-proj-${"A".repeat(40)}`)).toContain("***REDACTED***");
	});

	it("returns input unchanged when no secret is present", () => {
		expect(redactSecrets("hello world 12345")).toBe("hello world 12345");
		expect(redactSecrets("")).toBe("");
	});
});

describe("runSafetyFloor composition", () => {
	it("returns pass for ordinary bash", () => {
		expect(runSafetyFloor(bash("ls -la")).kind).toBe("pass");
	});

	it("prefers deny-hard over require-confirm when both fire", () => {
		// "sudo rm -rf /" triggers privilege (confirm) AND fs destruction (deny-hard).
		// fs destruction is evaluated before privilege so deny wins.
		expect(runSafetyFloor(bash("sudo rm -rf /")).kind).toBe("deny-hard");
	});

	it("returns deny-hard for secrets even when no other clause fires", () => {
		expect(runSafetyFloor(read("/repo/.env")).kind).toBe("deny-hard");
	});

	it("returns require-confirm when only privilege clause fires", () => {
		expect(runSafetyFloor(bash("sudo apt install x")).kind).toBe("require-confirm");
	});
});
