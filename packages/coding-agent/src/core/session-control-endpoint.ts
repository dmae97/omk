import { closeSync, constants, fstatSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
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
