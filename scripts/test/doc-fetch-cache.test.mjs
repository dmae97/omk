import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * `scripts/lib/doc-fetch-cache.sh` is the gate the `context7-mcp` skill runs before
 * spending one of its three permitted Context7 calls. A silent miss costs a call; a
 * silent stale hit serves outdated docs as current. Neither shows up in a type check,
 * so the contract is pinned here, under `check:constitution`.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const scriptPath = join(repoRoot, "scripts/lib/doc-fetch-cache.sh");
const KEY = "/vercel/next.js:middleware config";

let workDir;
let cacheDir;

function run(args, { input, env = {}, script = scriptPath } = {}) {
	const result = spawnSync("bash", [script, ...args], {
		cwd: workDir,
		encoding: "utf8",
		input,
		env: { ...process.env, DOC_CACHE_DIR: cacheDir, DOC_CACHE_TTL: "300", ...env },
	});
	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function put(key, etag, body) {
	const result = run(["put", key, etag, "-"], { input: body });
	assert.equal(result.status, 0, `put failed: ${result.stderr}`);
	return result;
}

/** Rewinds the single stored entry's timestamp so it falls outside the TTL. */
function expireAllEntries(secondsAgo = 400) {
	const metaFiles = readdirSync(cacheDir).filter((name) => name.endsWith(".meta"));
	assert.ok(metaFiles.length > 0, "expected at least one cache entry to expire");
	const cachedAt = Math.floor(Date.now() / 1000) - secondsAgo;
	for (const name of metaFiles) {
		const path = join(cacheDir, name);
		writeFileSync(path, readFileSync(path, "utf8").replace(/^cached_at=\d+$/m, `cached_at=${cachedAt}`));
	}
}

before(() => {
	workDir = mkdtempSync(join(tmpdir(), "doc-fetch-cache-"));
});

after(() => {
	rmSync(workDir, { recursive: true, force: true });
});

beforeEach(() => {
	cacheDir = join(workDir, `cache-${Date.now()}-${Math.random().toString(16).slice(2)}`);
});

describe("doc-fetch-cache get/put", () => {
	it("misses on an empty cache with exit 1 and no body", () => {
		const result = run(["get", KEY]);
		assert.equal(result.status, 1);
		assert.equal(result.stdout, "");
	});

	it("returns the stored body byte-for-byte and reports the ETag on stderr", () => {
		const body = "Next.js middleware docs\n  indented line\n한국어 줄\n";
		put(KEY, 'W/"abc123"', body);
		const result = run(["get", KEY]);
		assert.equal(result.status, 0);
		assert.equal(result.stdout, body);
		assert.match(result.stderr, /^ETAG:W\/"abc123"$/m);
	});

	it("accepts a body file as well as stdin", () => {
		const bodyPath = join(workDir, "body.txt");
		writeFileSync(bodyPath, "from file\n");
		const result = run(["put", KEY, "", bodyPath]);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(run(["get", KEY]).stdout, "from file\n");
	});

	it("keeps stdout body-only when no ETag was stored", () => {
		put(KEY, "", "no etag body\n");
		const result = run(["get", KEY]);
		assert.equal(result.status, 0);
		assert.equal(result.stdout, "no etag body\n");
		assert.equal(result.stderr, "");
	});

	it("normalizes keys: trim, collapse whitespace, lowercase", () => {
		put("  /Vercel/Next.js:Middleware \t Config  ", '"e1"', "normalized\n");
		const result = run(["get", KEY]);
		assert.equal(result.status, 0);
		assert.equal(result.stdout, "normalized\n");
		assert.equal(readdirSync(cacheDir).filter((name) => name.endsWith(".meta")).length, 1);
	});

	it("keeps distinct keys apart", () => {
		put("/vercel/next.js:middleware", "", "middleware\n");
		put("/vercel/next.js:routing", "", "routing\n");
		assert.equal(run(["get", "/vercel/next.js:middleware"]).stdout, "middleware\n");
		assert.equal(run(["get", "/vercel/next.js:routing"]).stdout, "routing\n");
	});
});

describe("doc-fetch-cache TTL and ETag revalidation", () => {
	it("treats an entry past DOC_CACHE_TTL as a miss but still exposes its ETag", () => {
		put(KEY, '"old"', "old body\n");
		expireAllEntries();

		assert.equal(run(["get", KEY]).status, 1);
		assert.equal(run(["stale", KEY]).status, 0);
		const etag = run(["etag", KEY]);
		assert.equal(etag.status, 0);
		assert.equal(etag.stdout, '"old"\n');
	});

	it("reports a fresh entry as not stale and a missing entry as stale", () => {
		assert.equal(run(["stale", KEY]).status, 0);
		put(KEY, "", "fresh\n");
		assert.equal(run(["stale", KEY]).status, 1);
	});

	it("touch restarts the TTL without replacing the body (ETag matched)", () => {
		put(KEY, '"same"', "unchanged body\n");
		expireAllEntries();
		assert.equal(run(["get", KEY]).status, 1);

		assert.equal(run(["touch", KEY]).status, 0);
		const result = run(["get", KEY]);
		assert.equal(result.status, 0);
		assert.equal(result.stdout, "unchanged body\n");
		assert.match(result.stderr, /^ETAG:"same"$/m);
	});

	it("put replaces body and ETag when the ETag changed", () => {
		put(KEY, '"v1"', "version one\n");
		expireAllEntries();
		put(KEY, '"v2"', "version two\n");

		const result = run(["get", KEY]);
		assert.equal(result.status, 0);
		assert.equal(result.stdout, "version two\n");
		assert.match(result.stderr, /^ETAG:"v2"$/m);
		assert.equal(run(["etag", KEY]).stdout, '"v2"\n');
	});

	it("honours a custom DOC_CACHE_TTL", () => {
		put(KEY, "", "long lived\n");
		expireAllEntries(400);
		assert.equal(run(["get", KEY], { env: { DOC_CACHE_TTL: "1000" } }).status, 0);
		assert.equal(run(["get", KEY], { env: { DOC_CACHE_TTL: "300" } }).status, 1);
	});

	it("purge removes only expired entries", () => {
		put("stale-key", "", "stale\n");
		expireAllEntries();
		put("fresh-key", "", "fresh\n");

		const result = run(["purge"]);
		assert.equal(result.status, 0);
		assert.match(result.stdout, /purged 1 stale entries/);
		assert.equal(run(["get", "stale-key"]).status, 1);
		assert.equal(run(["get", "fresh-key"]).stdout, "fresh\n");
		assert.equal(readdirSync(cacheDir).filter((name) => name.endsWith(".meta")).length, 1);
	});
});

describe("doc-fetch-cache errors", () => {
	it("fails with exit 2 on usage errors and says why", () => {
		for (const args of [[], ["bogus", KEY], ["get"], ["put", KEY, "etag"], ["purge", "extra"]]) {
			const result = run(args);
			assert.equal(result.status, 2, `args ${JSON.stringify(args)} should be a usage error`);
			assert.match(result.stderr, /usage:/);
		}
	});

	it("rejects an empty key, a missing body file, and a malformed TTL", () => {
		const emptyKey = run(["get", "   "]);
		assert.equal(emptyKey.status, 2);
		assert.match(emptyKey.stderr, /key must not be empty/);

		const missingBody = run(["put", KEY, "", join(workDir, "does-not-exist")]);
		assert.equal(missingBody.status, 2);
		assert.match(missingBody.stderr, /does not exist/);
		assert.equal(run(["get", KEY]).status, 1, "a failed put must not leave a partial entry");

		const badTtl = run(["get", KEY], { env: { DOC_CACHE_TTL: "5m" } });
		assert.equal(badTtl.status, 2);
		assert.match(badTtl.stderr, /DOC_CACHE_TTL/);
	});

	it("exits 1 for etag/touch when no entry exists", () => {
		assert.equal(run(["etag", KEY]).status, 1);
		assert.equal(run(["touch", KEY]).status, 1);
	});

	it("exits 2 and writes nothing when no sha256 tool is available", (t) => {
		// Bash drops errexit inside "$(...)" unless inherit_errexit is on, which once let a failed
		// hash fall through to an empty entry path: put reported success, stale reported fresh.
		const binDir = join(workDir, `bin-${Date.now()}`);
		mkdirSync(binDir);
		for (const tool of ["bash", "cat", "cp", "mv", "mkdir", "mktemp", "sed", "tr", "cut", "head", "date", "rm", "dirname"]) {
			const found = (process.env.PATH ?? "").split(delimiter).map((dir) => join(dir, tool)).find(existsSync);
			if (!found) return t.skip(`${tool} not found on PATH`);
			symlinkSync(found, join(binDir, tool));
		}
		const env = { PATH: binDir, DOC_CACHE_DIR: cacheDir, DOC_CACHE_TTL: "300" };
		const options = { cwd: workDir, encoding: "utf8", env };

		const putResult = spawnSync("bash", [scriptPath, "put", KEY, "", "-"], { ...options, input: "body\n" });
		assert.equal(putResult.status, 2);
		assert.match(putResult.stderr, /no sha256sum, shasum, or openssl/);
		assert.deepEqual(readdirSync(cacheDir), [], "a failed put must not create an entry");
		for (const subcommand of ["get", "stale", "etag", "touch"]) {
			assert.equal(spawnSync("bash", [scriptPath, subcommand, KEY], options).status, 2, `${subcommand} exit code`);
		}
	});
});

describe("doc-fetch-cache default location", () => {
	it("stores entries under <repo>/.omk/cache/docs relative to the script, not the caller's cwd", () => {
		// A copy of the script in a fake repository layout proves the default resolves against the
		// script's own location. Running against the real repository would write into the checkout.
		const fakeRepo = join(workDir, "fake-repo");
		mkdirSync(join(fakeRepo, "scripts/lib"), { recursive: true });
		const fakeScript = join(fakeRepo, "scripts/lib/doc-fetch-cache.sh");
		cpSync(scriptPath, fakeScript);
		const elsewhere = join(workDir, "elsewhere");
		mkdirSync(elsewhere, { recursive: true });

		const result = spawnSync("bash", [fakeScript, "put", KEY, "", "-"], {
			cwd: elsewhere,
			encoding: "utf8",
			input: "default location\n",
			env: { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("DOC_CACHE_"))) },
		});
		assert.equal(result.status, 0, result.stderr);
		assert.ok(existsSync(join(fakeRepo, ".omk/cache/docs")), "cache directory should sit next to the repository");
		assert.equal(readdirSync(elsewhere).length, 0, "nothing should be written into the caller's cwd");
	});
});
