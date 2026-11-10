import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, openPostgres, type Db } from "../src/db.ts";

export function dataDir(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	return resolve(process.env.OMK_GATEWAY_DATA_DIR ?? join(here, "..", ".data", "pglite"));
}

export function configDir(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	return resolve(process.env.OMK_GATEWAY_CONFIG_DIR ?? join(here, "..", "config"));
}

/** A PGlite dir is single-process: refuse to open it while the server holds it. */
export function assertServerStopped(): void {
	const lock = `${dataDir()}.lock`;
	if (!existsSync(lock)) return;
	const pid = Number(readFileSync(lock, "utf8"));
	try {
		process.kill(pid, 0);
	} catch {
		return;
	}
	console.error(`The gateway server (pid ${pid}) is running and holds the data dir. Stop it first.`);
	process.exit(2);
}

export function args(argv: string[]): Record<string, string | true> {
	const out: Record<string, string | true> = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i] as string;
		if (!a.startsWith("--")) continue;
		const next = argv[i + 1];
		if (next !== undefined && !next.startsWith("--")) {
			out[a.slice(2)] = next;
			i++;
		} else out[a.slice(2)] = true;
	}
	return out;
}

/** Opens Postgres when OMK_GATEWAY_DATABASE_URL is set; otherwise the PGlite data dir (and refuses if the server holds it). */
export async function openCliDb(): Promise<Db> {
	const url = process.env.OMK_GATEWAY_DATABASE_URL;
	if (url) return openPostgres(url);
	assertServerStopped();
	return openDb(dataDir());
}
