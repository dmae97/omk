#!/usr/bin/env node
/**
 * Pre-commit half of the OMK scope-lease extension: refuse a commit whose index
 * holds a path that another live OMK session has leased, so a commit made from
 * a plain terminal obeys the same leases as one made inside a session.
 *
 * Lease files: `<git-common-dir>/omk-leases/<session>.json` with
 * `{ session, pid, host, worktree, branch, patterns, heartbeat }`. Patterns are
 * repo-relative paths or globs. Liveness matches the extension: same host means
 * the PID runs and the lease is under 24 h old; another host means a heartbeat
 * under 2 h old.
 *
 * A lease whose OMK process is an ancestor of this hook is the committer's own.
 * To commit a live session's files from another terminal, name that session:
 *   OMK_LEASE_AS=<session-prefix>[,<prefix>] git commit ...
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join, matchesGlob, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REMOTE_TTL_MS = 2 * 60 * 60 * 1000;
const LOCAL_MAX_MS = 24 * 60 * 60 * 1000;

export function pidAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error?.code === "EPERM";
	}
}

export function leaseLive(lease, now, host, alive = pidAlive) {
	const age = now - lease.heartbeat;
	if (lease.host === host) return age < LOCAL_MAX_MS && alive(lease.pid);
	return age < REMOTE_TTL_MS;
}

export function patternMatches(pattern, path) {
	return pattern === path || (/[*?[{]/.test(pattern) && matchesGlob(path, pattern));
}

function parentPid(pid) {
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
		return Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
	} catch {
		try {
			return Number(execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8" }).trim());
		} catch {
			return 0;
		}
	}
}

export function ancestorPids(pid = process.pid) {
	const seen = new Set();
	for (let p = pid; p > 1 && !seen.has(p); p = parentPid(p)) seen.add(p);
	return seen;
}

/** Conflicts as `{ path, lease }` for staged paths held by a live lease that is not the committer's. */
export function findConflicts({ leases, staged, now, host, ancestors, as = [], alive = pidAlive }) {
	const conflicts = [];
	for (const lease of leases) {
		if (!leaseLive(lease, now, host, alive)) continue;
		if (lease.host === host && ancestors.has(lease.pid)) continue;
		if (as.some((prefix) => prefix && lease.session.startsWith(prefix))) continue;
		for (const path of staged) {
			if (lease.patterns.some((p) => patternMatches(p, path))) conflicts.push({ path, lease });
		}
	}
	return conflicts;
}

export function readLeases(dir) {
	if (!existsSync(dir)) return [];
	const leases = [];
	for (const name of readdirSync(dir)) {
		if (!name.endsWith(".json")) continue;
		try {
			const lease = JSON.parse(readFileSync(join(dir, name), "utf8"));
			if (typeof lease?.session === "string" && Array.isArray(lease.patterns)) leases.push(lease);
		} catch {
			// A lease being rewritten is skipped; the session's own tool gate still applies.
		}
	}
	return leases;
}

function git(args) {
	return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const common = git(["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim();
	const leases = readLeases(join(common, "omk-leases"));
	if (leases.length === 0) process.exit(0);
	// Report a rename as a deletion and an addition so both paths are checked.
	const staged = git(["diff", "--cached", "--no-renames", "--name-only", "-z"]).split("\0").filter(Boolean);
	const conflicts = findConflicts({
		leases,
		staged,
		now: Date.now(),
		host: hostname(),
		ancestors: ancestorPids(),
		as: (process.env.OMK_LEASE_AS ?? "").split(",").map((s) => s.trim()),
	});
	if (conflicts.length === 0) process.exit(0);
	console.error("❌ Staged paths are leased by another live OMK session:");
	for (const { path, lease } of conflicts) {
		console.error(
			`  - ${path}: session ${lease.session.slice(0, 8)} (branch ${lease.branch}, worktree ${lease.worktree}, pid ${lease.pid}@${lease.host})`,
		);
	}
	console.error("Unstage them (git restore --staged <path>), run /lease release in that session, or");
	console.error("commit as that session: OMK_LEASE_AS=<session-prefix> git commit ...");
	process.exit(1);
}
