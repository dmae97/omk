import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { prepareNativeWitnessDir } from "../../src/core/verified-run/native-witness.ts";
import { nativeExecutionDir } from "../../src/core/verified-run/rust-host-record.ts";

let root: string | undefined;
afterEach(() => {
	if (root) fs.rmSync(root, { recursive: true, force: true });
	root = undefined;
});

/** Synthetic storage fixtures: no real user state and no native execution process. */
export function privateStateRoot() {
	root = fs.mkdtempSync(join(tmpdir(), "omk-native-obsolete-"));
	const dir = nativeExecutionDir(root);
	fs.mkdirSync(dir, { mode: 0o700 });
	prepareNativeWitnessDir(join(root, "native-witness"));
	const old = new Date("2025-06-01T00:00:00.000Z");
	const identity = {
		pid: 4242,
		startTicks: "987654",
		namespace: "pid:[4026532000]",
		bootId: "0123abcd-0000-4000-8000-00000000beef",
	};
	const rows = [
		{ kind: "accepted", requestId: "a".repeat(32), hostPid: 999_999_999, hostTicks: "1" },
		{ kind: "ready", identity },
		{ kind: "committed" },
		{ kind: "detached" },
		{ kind: "finished", exitCode: 0, failure: null, durationMs: 2, stdout: "", stderr: "" },
	];
	const text = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
	fs.writeFileSync(join(dir, `${"a".repeat(32)}.jsonl`), text, { mode: 0o600 });
	const receipt = `0123abcd-0000-4000-8000-00000000beef-4026532000-4242-987654.json`;
	fs.writeFileSync(
		join(root, "native-witness", receipt),
		`${JSON.stringify({ version: 1, kind: "terminated", identity })}\n`,
		{ mode: 0o600 },
	);
	fs.writeFileSync(join(dir, `${"a".repeat(32)}.head`), `${Buffer.byteLength(text)}\n`, { mode: 0o600 });
	fs.writeFileSync(join(dir, `${"b".repeat(32)}.jsonl`), "not json\n", { mode: 0o600 });
	fs.writeFileSync(join(dir, `${"b".repeat(32)}.head`), "9\n", { mode: 0o600 });
	const live = JSON.stringify({
		kind: "accepted",
		requestId: "c".repeat(32),
		hostPid: process.pid,
		hostTicks: fs
			.readFileSync(`/proc/${process.pid}/stat`, "utf8")
			.slice(fs.readFileSync(`/proc/${process.pid}/stat`, "utf8").lastIndexOf(")") + 2)
			.trim()
			.split(/\s+/)[19],
	});
	fs.writeFileSync(join(dir, `${"c".repeat(32)}.jsonl`), `${live}\n`, { mode: 0o600 });
	fs.writeFileSync(join(dir, `${"c".repeat(32)}.head`), `${Buffer.byteLength(`${live}\n`)}\n`, { mode: 0o600 });
	for (const name of fs.readdirSync(dir)) fs.utimesSync(join(dir, name), old, old);
	return root;
}
