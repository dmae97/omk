import { randomUUID } from "node:crypto";
import { closeSync, constants, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { neoMcpConfig } from "./catalog.ts";

/** Create a new configuration only. Never merge, replace, or print an existing credential-bearing file. */
export function createNeoMcpConfig(root: string, ids: readonly string[]): string {
	const content = `${JSON.stringify(neoMcpConfig(ids, true), null, 2)}\n`;
	const directory = join(resolve(root), ".omk");
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const info = lstatSync(directory);
	if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Neo setup refuses a symlinked or non-directory .omk");
	const target = join(directory, "mcp.json");
	const temporary = join(directory, `.neo-mcp-${randomUUID()}.tmp`);
	let fd: number | undefined;
	let published = false;
	try {
		fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
		writeFileSync(fd, content, "utf8");
		fsyncSync(fd);
		closeSync(fd);
		fd = undefined;
		// Atomic no-replace publication: an existing mcp.json (including a symlink) wins.
		linkSync(temporary, target);
		published = true;
	} catch (error) {
		const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
		if (code === "EEXIST") throw new Error("mcp.json already exists; no changes made. Use neo mcp-config and review a manual merge.");
		throw new Error("Could not create MCP configuration; no existing configuration was overwritten.");
	} finally {
		if (fd !== undefined) closeSync(fd);
		try { unlinkSync(temporary); } catch { /* No credential data is logged. */ }
	}
	if (!published) throw new Error("MCP configuration was not published");
	return target;
}
