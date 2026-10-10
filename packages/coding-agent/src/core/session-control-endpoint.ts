import { closeSync, constants, fstatSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { resolveDurableFileIdentity } from "./durable-file-identity.ts";
import { isRecord } from "./session-control-protocol.ts";

export interface SessionControlEndpoint {
	readonly version: 1;
	readonly sessionId: string;
	readonly sessionPath: string;
	readonly socketPath: string;
	readonly token: string;
}

export function controlEndpointPath(sessionPath: string): string {
	return `${sessionPath}.control.json`;
}

export function readControlEndpoint(sessionPath: string): SessionControlEndpoint {
	const fd = openSync(
		controlEndpointPath(sessionPath),
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	);
	try {
		const stat = fstatSync(fd);
		if (
			!stat.isFile() ||
			stat.nlink !== 1 ||
			stat.size > 8192 ||
			(stat.mode & 0o077) !== 0 ||
			(process.getuid && stat.uid !== process.getuid())
		)
			throw new Error("unsafe control endpoint");
		const value: unknown = JSON.parse(readFileSync(fd, "utf8"));
		if (
			!isRecord(value) ||
			value.version !== 1 ||
			typeof value.sessionId !== "string" ||
			typeof value.socketPath !== "string" ||
			typeof value.token !== "string" ||
			!/^[a-f0-9]{64}$/.test(value.token) ||
			value.sessionPath !== resolveDurableFileIdentity(sessionPath).canonicalPath
		)
			throw new Error("invalid control endpoint");
		return {
			version: 1,
			sessionId: value.sessionId,
			sessionPath: value.sessionPath,
			socketPath: value.socketPath,
			token: value.token,
		};
	} finally {
		closeSync(fd);
	}
}

export function publishControlEndpoint(endpoint: SessionControlEndpoint): void {
	writeFileSync(controlEndpointPath(endpoint.sessionPath), JSON.stringify(endpoint), { flag: "wx", mode: 0o600 });
}

/** One bounded connect: enough to see a live peer, short enough not to stall startup. */
function controlSocketReachable(socketPath: string, timeoutMs: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection(socketPath);
		const timer = setTimeout(() => {
			socket.destroy();
			resolve(false);
		}, timeoutMs);
		timer.unref?.();
		socket.once("connect", () => {
			clearTimeout(timer);
			socket.destroy();
			resolve(true);
		});
		socket.once("error", () => {
			clearTimeout(timer);
			resolve(false);
		});
	});
}

/**
 * A session that died without close() leaves `.control.json` behind, and `wx`
 * would lock out every later control lease for that session file. Reclaim the
 * file only when it is unreadable or its socket refuses a real connection;
 * a reachable peer means another live session owns this control lease.
 */
export async function publishFreshControlEndpoint(endpoint: SessionControlEndpoint): Promise<void> {
	try {
		publishControlEndpoint(endpoint);
		return;
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
	}
	const path = controlEndpointPath(endpoint.sessionPath);
	let stale = false;
	try {
		const existing = readControlEndpoint(endpoint.sessionPath);
		stale = !(await controlSocketReachable(existing.socketPath, 500));
	} catch {
		stale = true;
	}
	if (stale) {
		unlinkSync(path);
		publishControlEndpoint(endpoint);
		return;
	}
	throw new Error("session control already active for this session file");
}

export function removeControlEndpoint(endpoint: SessionControlEndpoint): void {
	try {
		const current = readControlEndpoint(endpoint.sessionPath);
		if (current.token !== endpoint.token || current.socketPath !== endpoint.socketPath)
			throw new Error("control endpoint ownership changed");
		unlinkSync(controlEndpointPath(endpoint.sessionPath));
	} catch (error) {
		if (!isRecord(error) || error.code !== "ENOENT") throw error;
	}
}
