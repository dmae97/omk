import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { SCHEMA } from "./schema.js";

export interface Queryable {
	query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Db extends Queryable {
	transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
	close(): Promise<void>;
}

/**
 * Embedded Postgres (PGlite, WASM). Same SQL dialect as a server Postgres, no external service needed.
 * `dir` undefined = in-memory. A PGlite data dir must only be opened by ONE process at a time.
 */
export async function openDb(dir?: string): Promise<Db> {
	if (dir) mkdirSync(dir, { recursive: true });
	const pg = dir ? new PGlite(dir) : new PGlite();
	await pg.waitReady;
	await pg.exec(SCHEMA);
	return {
		query: async (sql, params) => {
			const r = await pg.query(sql, params as any[]);
			return { rows: r.rows as any[] };
		},
		transaction: (fn) =>
			pg.transaction(async (tx) =>
				fn({
					query: async (sql: string, params?: unknown[]) => {
						const r = await tx.query(sql, params as any[]);
						return { rows: r.rows as any[] };
					},
				}),
			),
		close: () => pg.close(),
	};
}
