import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { $ } from "bun";
import { CONFIG_DIR_NAME } from "$c/config";
import { getControlDir, getControlPathTemplate, type SSHConnectionTarget } from "./connection-manager";

const REMOTE_DIR = join(homedir(), CONFIG_DIR_NAME, "remote");
const CONTROL_DIR = getControlDir();
const CONTROL_PATH = getControlPathTemplate();

const mountedPaths = new Set<string>();

function ensureDir(path: string, mode = 0o700): void {
	if (!existsSync(path)) {
		mkdirSync(path, { recursive: true, mode });
	}
	try {
		chmodSync(path, mode);
	} catch (err) {
		logger.debug("SSHFS dir chmod failed", { path, error: String(err) });
	}
}

function getMountName(host: SSHConnectionTarget): string {
	const raw = (host.name ?? host.host).trim();
	const sanitized = raw.replace(/[^a-zA-Z0-9._-]+/g, "_");
	return sanitized.length > 0 ? sanitized : "remote";
}

function getMountPath(host: SSHConnectionTarget): string {
	return join(REMOTE_DIR, getMountName(host));
}

function buildSshTarget(host: SSHConnectionTarget): string {
	return host.username ? `${host.username}@${host.host}` : host.host;
}

function buildSshfsArgs(host: SSHConnectionTarget): string[] {
	const args = [
		"-o",
		"reconnect",
		"-o",
		"ServerAliveInterval=15",
		"-o",
		"ServerAliveCountMax=3",
		"-o",
		"BatchMode=yes",
		"-o",
		"StrictHostKeyChecking=accept-new",
		"-o",
		"ControlMaster=auto",
		"-o",
		`ControlPath=${CONTROL_PATH}`,
		"-o",
		"ControlPersist=3600",
	];

	if (host.port) {
		args.push("-p", String(host.port));
	}

	if (host.keyPath) {
		args.push("-o", `IdentityFile=${host.keyPath}`);
	}

	return args;
}

async function unmountPath(path: string): Promise<boolean> {
	const fusermount = Bun.which("fusermount") ?? Bun.which("fusermount3");
	if (fusermount) {
		const result = await $`${fusermount} -u ${path}`.quiet().nothrow();
		if (result.exitCode === 0) return true;
	}

	const umount = Bun.which("umount");
	if (!umount) return false;
	const result = await $`${umount} ${path}`.quiet().nothrow();
	return result.exitCode === 0;
}

export function hasSshfs(): boolean {
	return Bun.which("sshfs") !== null;
}

export async function isMounted(path: string): Promise<boolean> {
	const mountpoint = Bun.which("mountpoint");
	if (!mountpoint) return false;
	const result = await $`${mountpoint} -q ${path}`.quiet().nothrow();
	return result.exitCode === 0;
}

export async function mountRemote(host: SSHConnectionTarget, remotePath = "/"): Promise<string | undefined> {
	if (!hasSshfs()) return undefined;

	ensureDir(REMOTE_DIR);
	ensureDir(CONTROL_DIR);

	const mountPath = getMountPath(host);
	ensureDir(mountPath);

	if (await isMounted(mountPath)) {
		mountedPaths.add(mountPath);
		return mountPath;
	}

	const target = `${buildSshTarget(host)}:${remotePath}`;
	const args = buildSshfsArgs(host);
	const result = await $`sshfs ${args} ${target} ${mountPath}`.nothrow();

	if (result.exitCode !== 0) {
		const detail = result.stderr.toString().trim();
		const suffix = detail ? `: ${detail}` : "";
		throw new Error(`Failed to mount ${target}${suffix}`);
	}

	mountedPaths.add(mountPath);
	return mountPath;
}

export async function unmountRemote(host: SSHConnectionTarget): Promise<boolean> {
	const mountPath = getMountPath(host);
	if (!(await isMounted(mountPath))) {
		mountedPaths.delete(mountPath);
		return false;
	}

	const success = await unmountPath(mountPath);
	if (success) {
		mountedPaths.delete(mountPath);
	}

	return success;
}

export async function unmountAll(): Promise<void> {
	for (const mountPath of Array.from(mountedPaths)) {
		await unmountPath(mountPath);
	}
	mountedPaths.clear();
}
