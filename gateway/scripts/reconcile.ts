// Usage: npm run reconcile [-- --month 2026-11]   (with PGlite, stop the gateway server first)
import { reportFromDb } from "../src/reconcile.ts";
import { args, openCliDb } from "./_cli.ts";

const a = args(process.argv.slice(2));
const db = await openCliDb();
const rep = await reportFromDb(db, typeof a.month === "string" ? a.month : undefined);
await db.close();
console.log(JSON.stringify(rep, null, 2));
process.exit(rep.invariant_violations.length ? 1 : 0);
