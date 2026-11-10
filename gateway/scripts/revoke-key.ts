// Usage: npm run revoke-key -- --key <key_id>   (stop the gateway server first)
import { openDb } from "../src/db.ts";
import { revoke } from "../src/admin.ts";
import { args, assertServerStopped, dataDir } from "./_cli.ts";

const a = args(process.argv.slice(2));
if (typeof a.key !== "string") {
	console.error("--key <key_id> is required");
	process.exit(1);
}
assertServerStopped();
const db = await openDb(dataDir());
const ok = await revoke(db, a.key, new Date());
await db.close();
console.log(ok ? `revoked ${a.key}` : `no such key ${a.key}`);
process.exit(ok ? 0 : 1);
