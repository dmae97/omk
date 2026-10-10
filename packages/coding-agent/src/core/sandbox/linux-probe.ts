/**
 * Linux sandbox readiness: static facts read from /proc and /etc, plus one
 * functional bubblewrap start that proves the namespaces OMK needs can be created.
 *
 * `command -v bwrap` alone is not proof. Hardened containers, Ubuntu's AppArmor
 * user-namespace restriction and `user.max_user_namespaces=0` all leave the binary
 * on PATH while every sandboxed spawn fails. The functional probe runs the same
 * namespace flags as `buildBubblewrapArgv`, so a pass here predicts a pass there.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

export interface BubblewrapFunctionalProbe {
	readonly ok: boolean;
	/** bwrap stderr (or the spawn error) when the probe failed; empty on success. */
	readonly detail: string;
}

export interface LinuxSandboxHost {
	/** Distribution install command for bubblewrap, when the distribution is known. */
	readonly installCommand?: string;
	/** `kernel.apparmor_restrict_unprivileged_userns` is 1 (Ubuntu 23.10 and later). */
	readonly apparmorRestrictsUserns: boolean;
	readonly inContainer: boolean;
}

type ReadText = (path: string) => string | undefined;
type RunProbe = (command: string, args: readonly string[]) => { status: number | null; stderr: string; error?: Error };

const PROBE_TIMEOUT_MS = 3_000;

/**
 * Namespace flags shared with buildBubblewrapArgv; the probe command does nothing else. It runs
 * `/bin/sh -c :` rather than `/bin/true` because non-FHS hosts (NixOS, Guix) ship only /bin/sh.
 */
export const BUBBLEWRAP_PROBE_ARGS: readonly string[] = [
	"--die-with-parent",
	"--new-session",
	"--unshare-all",
	"--ro-bind",
	"/",
	"/",
	"--proc",
	"/proc",
	"--dev",
	"/dev",
	"--",
	"/bin/sh",
	"-c",
	":",
];

const readTextFile: ReadText = (path) => {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
};

const runSpawnSync: RunProbe = (command, args) => {
	const result = spawnSync(command, args, { encoding: "utf8", timeout: PROBE_TIMEOUT_MS, stdio: "pipe" });
	return { status: result.status, stderr: result.stderr ?? "", error: result.error };
};

/** Static user-namespace availability from /proc, without spawning `sysctl`. */
export function userNamespacesEnabledFromProc(read: ReadText = readTextFile): boolean {
	const debianSwitch = read("/proc/sys/kernel/unprivileged_userns_clone")?.trim();
	if (debianSwitch === "0") return false;
	const maxUserNamespaces = read("/proc/sys/user/max_user_namespaces")?.trim();
	return maxUserNamespaces !== "0";
}

/** Start bwrap with the production namespace flags and report whether it ran. */
export function probeBubblewrap(run: RunProbe = runSpawnSync): BubblewrapFunctionalProbe {
	const result = run("bwrap", BUBBLEWRAP_PROBE_ARGS);
	if (result.error) return { ok: false, detail: result.error.message };
	if (result.status === 0) return { ok: true, detail: "" };
	const stderr = result.stderr.trim().replace(/^bwrap:\s*/, "");
	return { ok: false, detail: stderr || `bwrap exited with status ${String(result.status)}` };
}

function osReleaseIds(read: ReadText): string[] {
	const text = read("/etc/os-release") ?? "";
	const ids: string[] = [];
	for (const line of text.split("\n")) {
		const match = /^(ID|ID_LIKE)=("?)([^"\n]*)\2$/.exec(line.trim());
		if (match) ids.push(...match[3].toLowerCase().split(/\s+/));
	}
	return ids;
}

const INSTALL_COMMANDS: ReadonlyArray<readonly [readonly string[], string]> = [
	[["debian", "ubuntu"], "sudo apt install bubblewrap"],
	[["fedora", "rhel", "centos"], "sudo dnf install bubblewrap"],
	[["arch"], "sudo pacman -S bubblewrap"],
	[["suse", "opensuse"], "sudo zypper install bubblewrap"],
	[["alpine"], "sudo apk add bubblewrap"],
];

export function readLinuxSandboxHost(
	read: ReadText = readTextFile,
	exists: (path: string) => boolean = existsSync,
): LinuxSandboxHost {
	const ids = osReleaseIds(read);
	const installCommand = INSTALL_COMMANDS.find(([family]) => family.some((id) => ids.includes(id)))?.[1];
	const cgroup = read("/proc/1/cgroup") ?? "";
	return {
		...(installCommand ? { installCommand } : {}),
		apparmorRestrictsUserns: read("/proc/sys/kernel/apparmor_restrict_unprivileged_userns")?.trim() === "1",
		inContainer:
			exists("/.dockerenv") || exists("/run/.containerenv") || /docker|kubepods|containerd|lxc/.test(cgroup),
	};
}

const AUDIT_ESCAPE =
	"To run without OS isolation instead, restart with OMK_BASH_SANDBOX=audit (every spawn is still recorded).";

/** One actionable sentence pair: what failed, then the smallest fix for this host. */
export function explainLinuxSandboxFailure(input: {
	readonly bubblewrapAvailable: boolean;
	readonly userNamespacesEnabled: boolean;
	readonly functional?: BubblewrapFunctionalProbe;
	readonly host?: LinuxSandboxHost;
}): string {
	const host = input.host;
	if (!input.bubblewrapAvailable) {
		const install = host?.installCommand ?? "install the bubblewrap package with your package manager";
		return `bwrap is not installed or unavailable. Fix: ${install}, then restart OMK. ${AUDIT_ESCAPE}`;
	}
	const detail = input.functional && !input.functional.ok ? ` (bwrap: ${input.functional.detail})` : "";
	if (host?.apparmorRestrictsUserns) {
		return `AppArmor blocks unprivileged user namespaces for bwrap${detail}. Fix: allow bwrap with an AppArmor profile that grants userns (see docs/sandbox-setup.md), then restart OMK. ${AUDIT_ESCAPE}`;
	}
	if (host?.inContainer) {
		return `This container does not allow user namespaces${detail}. Fix: run OMK on the host, or give the container a seccomp profile that permits unshare. ${AUDIT_ESCAPE}`;
	}
	if (!input.userNamespacesEnabled) {
		return `Unprivileged user namespaces are disabled. Fix: set user.max_user_namespaces above 0 (and kernel.unprivileged_userns_clone=1 on Debian kernels), then restart OMK. ${AUDIT_ESCAPE}`;
	}
	return `bwrap is installed but cannot start a sandbox${detail}. Fix: allow unprivileged user namespaces for your user (see docs/sandbox-setup.md), then restart OMK. ${AUDIT_ESCAPE}`;
}
