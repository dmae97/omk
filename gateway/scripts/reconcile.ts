// Usage: npm run reconcile [-- --month 2026-11]   (stop the gateway server first)
import { openDb } from "../src/db.js";
import { reportFromDb } from "../src/reconcile.js";
import { args, assertServerStopped, dataDir } from "./_cli.js";

const a = args(process.argv.slice(2));
assertServerStopped();
const db = await openDb(dataDir());
const rep = await reportFromDb(db, typeof a.month === "string" ? a.month : undefined);
await db.close();
console.log(JSON.stringify(rep, null, 2));
process.exit(rep.invariant_violations.length ? 1 : 0);
