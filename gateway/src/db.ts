import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { Pool, type PoolClient } from "pg";
import { SCHEMA } from "./schema.ts";

export type DbKind = "pglite" | "postgres";

export interface Queryable {
	query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Db extends Queryable {
	kind: DbKind;
	transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
	close(): Promise<void>;
}

function asQueryable(client: { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> }): Queryable {
	return {
		query: async (sql, params) => {
			const r = await client.query(sql, params as any[]);
			return { rows: r.rows as any[] };
		},
	};
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
	// PGlite is a single connection: serialize query and transaction so a
	// transactional reserve cannot overlap another in-flight operation.
	let chain = Promise.resolve();
	const serial = <T>(fn: () => Promise<T>): Promise<T> => {
		const run = chain.then(fn, fn);
		chain = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	};
	return {
		kind: "pglite",
		query: (sql, params) =>
			serial(async () => {
				const r = await pg.query(sql, params as any[]);
				return { rows: r.rows as any[] };
			}),
		transaction: (fn) =>
			serial(() =>
				pg.transaction(async (tx) =>
					fn({
						query: async (sql: string, params?: unknown[]) => {
							const r = await tx.query(sql, params as any[]);
							return { rows: r.rows as any[] };
						},
					}),
				),
			),
		close: () => serial(() => pg.close()),
	};
}

/**
 * Multi-connection Postgres (for hosting and the cap-race test). Selected by
 * `OMK_GATEWAY_DATABASE_URL`. The URL is never logged. PGlite remains the default.
 */
export async function openPostgres(url: string): Promise<Db> {
	const pool = new Pool({ connectionString: url, max: 80, idleTimeoutMillis: 5_000, connectionTimeoutMillis: 10_000 });
	const db: Db = {
		kind: "postgres",
		query: async (sql, params) => {
			const r = await pool.query(sql, params as any[]);
			return { rows: r.rows as any[] };
		},
		transaction: async (fn) => {
			const client: PoolClient = await pool.connect();
			try {
				await client.query("BEGIN");
				const result = await fn(asQueryable(client));
				await client.query("COMMIT");
				return result;
			} catch (e) {
				try {
					await client.query("ROLLBACK");
				} catch {}
				throw e;
			} finally {
				client.release();
			}
		},
		close: () => pool.end(),
	};
	const setup = await pool.connect();
	try {
		await setup.query(SCHEMA);
	} finally {
		setup.release();
	}
	return db;
}

/** PGlite unless `url` or `OMK_GATEWAY_DATABASE_URL` is set. */
export async function openGatewayDb(opts?: { dir?: string; url?: string }): Promise<Db> {
	const url = opts?.url ?? process.env.OMK_GATEWAY_DATABASE_URL;
	if (url) return openPostgres(url);
	return openDb(opts?.dir);
}
