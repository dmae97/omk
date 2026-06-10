import { RUNTIME_USER_AGENT_NAME } from "../config.ts";

export function getPiUserAgent(version: string): string {
	const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
	return `${RUNTIME_USER_AGENT_NAME}/${version} (${process.platform}; ${runtime}; ${process.arch})`;
}
