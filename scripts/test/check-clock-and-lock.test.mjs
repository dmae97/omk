import assert from "node:assert/strict";
import { test } from "node:test";
import { findClockAndLockIssues } from "../check-clock-and-lock.mjs";

const rules = (source) => findClockAndLockIssues(source, "fixture.ts").map((issue) => `${issue.line}:${issue.rule}`);

test("flags durations, TTLs and deadlines measured with two wall-clock reads", () => {
	const source = [
		"const startedAt = Date.now();", // 1
		"const elapsed = Date.now() - startedAt;", // 2
		"if (Date.now() - entry.fetchedAt < ttlMs) hit();", // 3
		"const deadline = Date.now() + timeoutMs;", // 4: building a deadline alone is not a comparison
		"while (Date.now() < deadline) await tick();", // 5
		"const now = Date.now();", // 6
		"const left = endTime - now;", // 7: a variable initialized from Date.now() counts
		"if (now >= expiresAt) refresh();", // 8
	].join("\n");
	assert.deepEqual(rules(source), ["2:clock", "3:clock", "5:clock", "7:clock", "8:clock"]);
});

test("sees through unit scaling and rounding of Date.now()", () => {
	const source = [
		"const left = resetsAt - Date.now() / 1000;", // 1
		"const ageSec = Math.floor(Date.now() / 1000) - startedSec;", // 2
		"if (Math.round(Date.now() * 1e-3) > limitSec) stop();", // 3
		"const nowSec = Math.floor(Date.now() / 1000);", // 4: scaled reads also mark the variable
		"if (nowSec - lastSec > 5) tick();", // 5
		"const id = `${Date.now() / 1000}`;", // 6: no comparison
	].join("\n");
	assert.deepEqual(rules(source), ["1:clock", "2:clock", "3:clock", "5:clock"]);
});

test("ignores Date.now() in comments, strings and non-comparison arithmetic", () => {
	const source = [
		"// const elapsed = Date.now() - startedAt;",
		"/* while (Date.now() < deadline) */",
		'const text = "Date.now() - startedAt";',
		"const expires = Date.now() + expiresInMs - SKEW_MS;",
		"const stamp = new Date(Date.now()).toISOString();",
		"const elapsed = performance.now() - startedAt;",
	].join("\n");
	assert.deepEqual(rules(source), []);
});

test("accepts a wall-clock comparison only with a stated reason", () => {
	const source = [
		"// wall-clock: expires is an absolute timestamp persisted by another process",
		"if (Date.now() >= credentials.expires) refresh();", // 2: comment directly above
		"if (Date.now() >= token.expiresAt) refresh(); // wall-clock: server-issued epoch expiry", // 3: same line
		"// wall-clock:",
		"if (Date.now() >= other.expires) refresh();", // 5: empty reason does not count
		"// wall-clock: covers only the next statement",
		"",
		"if (Date.now() >= late.expires) refresh();", // 8: a blank line breaks the link
		"/**",
		" * wall-clock: compared with a file mtime, which the kernel stamps from the wall clock",
		" */",
		"if (Date.now() - stat.mtimeMs > maxAgeMs) stale();", // 12: doc comment block directly above
	].join("\n");
	assert.deepEqual(rules(source), ["5:clock", "8:clock"]);
});

test("requires an explicit stale window on every proper-lockfile lock", () => {
	const source = [
		'import lockfile from "proper-lockfile";',
		"lockfile.lockSync(path, { realpath: false });", // 2
		"lockfile.lockSync(path, { realpath: false, stale: 30_000 });", // 3
		"lockfile.lockSync(path);", // 4
		"lockfile.lockSync(path, options);", // 5: cannot see the window
	].join("\n");
	assert.deepEqual(rules(source), ["2:lock", "4:lock", "5:lock"]);
});

test("requires onCompromised on async proper-lockfile locks", () => {
	const source = [
		'import lockfile, { lock } from "proper-lockfile";',
		"await lockfile.lock(path, { stale: 30_000 });", // 2: default handler throws from a timer
		"await lockfile.lock(path, { stale: 30_000, onCompromised: (error) => { lost = error; } });", // 3
		"await lock(path, { stale: 30_000 });", // 4: named import
		"lockfile.unlock(path);", // 5: not a lock call
	].join("\n");
	assert.deepEqual(rules(source), ["2:lock", "4:lock"]);
});

test("only treats proper-lockfile imports as locks", () => {
	const source = ['import lockfile from "./my-lock.ts";', "lockfile.lockSync(path, {});"].join("\n");
	assert.deepEqual(rules(source), []);
});

test("accepts a lock call with a stated lock-ok reason", () => {
	const source = [
		'import lockfile from "proper-lockfile";',
		"// lock-ok: options are built by withStaleWindow(), which always sets stale",
		"lockfile.lockSync(path, withStaleWindow(options));",
	].join("\n");
	assert.deepEqual(rules(source), []);
});
