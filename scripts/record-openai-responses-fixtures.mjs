#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const args = process.argv.slice(2);
const check = args.includes("--check");
const modes = { "--history": ["openai-responses-history", "omk.openai-responses-history.v1", 19], "--images": ["openai-responses-images", "omk.openai-responses-images.v1", 10], "--headers": ["openai-responses-headers", "omk.openai-responses-headers.v1", 16] };
const selectors = args.filter((arg) => arg !== "--check");
if (args.length !== selectors.length + Number(check) || selectors.length > 1 || (selectors.length && !Object.hasOwn(modes, selectors[0])))
	throw new Error("usage: record-openai-responses-fixtures.mjs [--history|--images|--headers] [--check]");
const [name, schema, count] = modes[selectors[0]] ?? ["openai-responses", "omk.openai-responses-request.v1", 47];
const home = mkdtempSync(join(tmpdir(), "omk-oai-responses-"));
try {
	// Allowlisted environment: no OMK_CACHE_RETENTION, OPENAI_* or inherited auth.
	const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home, OMK_CODING_AGENT_DIR: join(home, "agent") };
	const run = spawnSync(process.execPath, ["--import", "tsx", `scripts/fixtures/${name}-recorder.ts`], { env, encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
	if (run.error || run.status !== 0) throw new Error(`openai-responses recorder failed: ${run.error?.message ?? run.stderr}`);
	const data = JSON.parse(run.stdout);
	if (data.schema !== schema || data.cases.length !== count) throw new Error("incomplete openai-responses oracle");
	const text = `${JSON.stringify(data, null, 2)}\n`;
	if (/\/home\/|\/mnt\/|sk-[A-Za-z0-9]/.test(text)) throw new Error("fixture privacy scan failed");
	const target = `native/omk-providers/tests/fixtures/${name}.json`;
	if (check) {
		if (readFileSync(target, "utf8") !== text) throw new Error("Node openai-responses drift");
	} else writeFileSync(target, text, { flag: "wx" });
	console.log(`PASS: ${data.cases.length} independent Node openai-responses requests`);
} finally {
	rmSync(home, { recursive: true, force: true });
}
