// Usage: npm run issue-key -- --label "alice" --plan A [--expires-in-days 30] [--allow-max-effort] [--user <usr_id>]
// Prints the token ONCE on stdout. Stop the gateway server first (single-process data dir).
import { issueKey } from "../src/admin.ts";
import { loadConfig } from "../src/config.ts";
import { openDb } from "../src/db.ts";
import { args, assertServerStopped, configDir, dataDir } from "./_cli.ts";

const a = args(process.argv.slice(2));
const config = loadConfig(configDir());
const plan = typeof a.plan === "string" ? a.plan : "A";
if (!config.limits.plans[plan]) {
	console.error(`unknown plan '${plan}'. Known: ${Object.keys(config.limits.plans).join(", ")}`);
	process.exit(1);
}
if (typeof a.label !== "string") {
	console.error("--label is required");
	process.exit(1);
}
assertServerStopped();
const db = await openDb(dataDir());
const now = new Date();
const days = typeof a["expires-in-days"] === "string" ? Number(a["expires-in-days"]) : null;
const r = await issueKey(db, {
	userId: typeof a.user === "string" ? a.user : undefined,
	label: a.label,
	plan,
	allowMaxEffort: a["allow-max-effort"] === true,
	expiresAt: days ? new Date(now.getTime() + days * 86_400_000) : null,
	now,
});
await db.close();
console.error(`user ${r.userId}  key ${r.keyId}  (the token below is shown once; only its hash is stored)`);
console.log(r.token);
