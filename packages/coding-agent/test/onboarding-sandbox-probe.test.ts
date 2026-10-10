import { describe, expect, it } from "vitest";
import { classifySandboxBackendProbe } from "../src/core/sandbox/backend.ts";
import {
	BUBBLEWRAP_PROBE_ARGS,
	explainLinuxSandboxFailure,
	probeBubblewrap,
	readLinuxSandboxHost,
	userNamespacesEnabledFromProc,
} from "../src/core/sandbox/linux-probe.ts";

const files = (entries: Record<string, string>) => (path: string) => entries[path];

describe("functional bubblewrap probe", () => {
	it("starts bwrap with the production namespace flags and reports success", () => {
		const calls: Array<{ command: string; args: readonly string[] }> = [];
		const probe = probeBubblewrap((command, args) => {
			calls.push({ command, args });
			return { status: 0, stderr: "" };
		});
		expect(probe).toEqual({ ok: true, detail: "" });
		expect(calls[0].command).toBe("bwrap");
		expect(calls[0].args).toEqual(BUBBLEWRAP_PROBE_ARGS);
		expect(BUBBLEWRAP_PROBE_ARGS).toContain("--unshare-all");
		// /bin/true is absent on NixOS and Guix; a missing binary would read as a broken sandbox there.
		expect(BUBBLEWRAP_PROBE_ARGS.slice(-3)).toEqual(["/bin/sh", "-c", ":"]);
	});

	it("keeps bwrap's own error when the namespace cannot be created", () => {
		const probe = probeBubblewrap(() => ({
			status: 1,
			stderr:
				"bwrap: Creating new namespace failed: nesting depth or /proc/sys/user/max_*_namespaces exceeded (ENOSPC)\n",
		}));
		expect(probe.ok).toBe(false);
		expect(probe.detail).toContain("ENOSPC");
	});

	it("reports a spawn error (for example a timeout) as a failed probe", () => {
		expect(
			probeBubblewrap(() => ({ status: null, stderr: "", error: new Error("spawnSync bwrap ETIMEDOUT") })),
		).toEqual({
			ok: false,
			detail: "spawnSync bwrap ETIMEDOUT",
		});
	});
});

describe("static Linux facts", () => {
	it("reads user namespace switches from /proc without spawning sysctl", () => {
		expect(userNamespacesEnabledFromProc(files({}))).toBe(true);
		expect(userNamespacesEnabledFromProc(files({ "/proc/sys/kernel/unprivileged_userns_clone": "0\n" }))).toBe(false);
		expect(userNamespacesEnabledFromProc(files({ "/proc/sys/user/max_user_namespaces": "0\n" }))).toBe(false);
		expect(userNamespacesEnabledFromProc(files({ "/proc/sys/user/max_user_namespaces": "32045\n" }))).toBe(true);
	});

	it("maps the distribution to its bubblewrap install command", () => {
		const host = (osRelease: string) => readLinuxSandboxHost(files({ "/etc/os-release": osRelease }), () => false);
		expect(host("ID=ubuntu\nID_LIKE=debian\n").installCommand).toBe("sudo apt install bubblewrap");
		expect(host('ID="fedora"\n').installCommand).toBe("sudo dnf install bubblewrap");
		expect(host("ID=arch\n").installCommand).toBe("sudo pacman -S bubblewrap");
		expect(host('ID="opensuse-tumbleweed"\nID_LIKE="opensuse suse"\n').installCommand).toBe(
			"sudo zypper install bubblewrap",
		);
		expect(host("ID=nixos\n").installCommand).toBeUndefined();
	});

	it("detects the AppArmor user namespace restriction and containers", () => {
		const host = readLinuxSandboxHost(
			files({ "/proc/sys/kernel/apparmor_restrict_unprivileged_userns": "1\n", "/proc/1/cgroup": "0::/\n" }),
			() => false,
		);
		expect(host).toMatchObject({ apparmorRestrictsUserns: true, inContainer: false });
		expect(readLinuxSandboxHost(files({}), (path) => path === "/.dockerenv").inContainer).toBe(true);
	});
});

describe("classification with a functional probe", () => {
	const failed = { ok: false, detail: "bwrap: setting up uid map: Permission denied" };

	it("does not report a backend as available when bwrap cannot start", () => {
		const status = classifySandboxBackendProbe({
			platform: "linux",
			bubblewrapAvailable: true,
			userNamespacesEnabled: true,
			functional: failed,
			host: { apparmorRestrictsUserns: false, inContainer: false },
		});
		expect(status.backendAvailable).toBe(false);
		expect(status.unavailableReason).toContain("setting up uid map");
	});

	it("gives a host-specific fix", () => {
		const reason = (host: { apparmorRestrictsUserns: boolean; inContainer: boolean; installCommand?: string }) =>
			explainLinuxSandboxFailure({
				bubblewrapAvailable: true,
				userNamespacesEnabled: true,
				functional: failed,
				host,
			});
		expect(reason({ apparmorRestrictsUserns: true, inContainer: false })).toMatch(/AppArmor/);
		expect(reason({ apparmorRestrictsUserns: false, inContainer: true })).toMatch(/container/);
		expect(
			explainLinuxSandboxFailure({
				bubblewrapAvailable: false,
				userNamespacesEnabled: true,
				host: { apparmorRestrictsUserns: false, inContainer: false, installCommand: "sudo apt install bubblewrap" },
			}),
		).toContain("Fix: sudo apt install bubblewrap");
	});

	it("always offers the explicit audit escape hatch, never a silent downgrade", () => {
		const reason = explainLinuxSandboxFailure({ bubblewrapAvailable: false, userNamespacesEnabled: true });
		expect(reason).toContain("OMK_BASH_SANDBOX=audit");
	});

	it("trusts a passing probe over static user-namespace facts (setuid bwrap)", () => {
		expect(
			classifySandboxBackendProbe({
				platform: "linux",
				bubblewrapAvailable: true,
				userNamespacesEnabled: false,
				functional: { ok: true, detail: "" },
			}),
		).toMatchObject({ backendAvailable: true });
	});

	it("keeps a passing functional probe available", () => {
		expect(
			classifySandboxBackendProbe({
				platform: "linux",
				bubblewrapAvailable: true,
				userNamespacesEnabled: true,
				functional: { ok: true, detail: "" },
			}),
		).toMatchObject({ backendAvailable: true });
	});

	it("tells native Windows users about WSL2", () => {
		expect(classifySandboxBackendProbe({ platform: "unsupported", hostPlatform: "win32" }).unavailableReason).toMatch(
			/WSL2/,
		);
	});
});
