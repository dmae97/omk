import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { AuthorityStore, authorityStorePath } from "../src/core/verified-run/authority-store.ts";
import { executeOwnedGitPublication } from "../src/core/verified-run/git-effect-supervisor.ts";
import { GitOperationBudget } from "../src/core/verified-run/git-execution.ts";
import { digestObject } from "../src/core/verified-run/storage.ts";

it("never settles somebody else's quarantined grant when dispatch is refused", async () => {
	const root = mkdtempSync(join(tmpdir(), "git-reservation-"));
	const workspace = join(root, "repo");
	mkdirSync(workspace);
	if (spawnSync("git", ["init", "-q", workspace]).status !== 0) throw new Error("git fixture failed");
	const store = AuthorityStore.open(authorityStorePath(join(root, "state")), { capacity: 2 });
	try {
		store.reconcile();
		const incarnation = store.register("s");
		const claims = [
			{ namespace: "git-ref", instanceId: "test", canonicalKey: "ref", access: "write", generation: "1" },
		];
		const admission = store.acquire({
			sessionId: "s",
			incarnation,
			commandId: "old",
			intentDigest: "a".repeat(64),
			claims,
			now: Date.now(),
			ttl: 60_000,
		});
		if (admission.status !== "granted") throw new Error("grant fixture failed");
		store.effectStarted(admission.token, claims);
		store.cancel(admission.token);
		const head = store.head;
		const manifest = { version: 1 as const, files: [], directories: [] };
		await expect(
			executeOwnedGitPublication({
				workspace,
				authority: { store, sessionId: "s", incarnation },
				token: admission.token,
				claims,
				runtime: { files: [], extension: "ts", digest: "a".repeat(64) },
				budget: new GitOperationBudget(),
				deadlineNs: (process.hrtime.bigint() + 1_000_000_000n).toString(),
				cleanupMs: 1000,
				input: {
					manifest,
					contents: new Map(),
					parentOid: "0".repeat(40),
					zeroOid: "0".repeat(40),
					runId: "old",
					candidateDigest: digestObject(manifest),
					receiptDigest: "b".repeat(64),
				},
				onPrepared: () => {
					throw new Error("must not prepare");
				},
			}),
		).rejects.toThrow(/authority/);
		expect(store.state.grants.get(admission.token.grantSequence)).toMatchObject({
			state: "quarantined",
			effectLive: true,
		});
		expect(store.head).toEqual(head);
	} finally {
		store.release();
		rmSync(root, { recursive: true, force: true });
	}
});
