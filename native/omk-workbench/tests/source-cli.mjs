import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { AuthorityStore, authorityStorePath } from "../../../packages/coding-agent/src/core/verified-run/authority-store.ts";
import { journalPath } from "../../../packages/coding-agent/src/core/verified-run/journal.ts";
import { dagFixture } from "../../../packages/coding-agent/test/verified-run-dag-fixture.ts";

const repository = fileURLToPath(new URL("../../../", import.meta.url));

test("real Node CLI authority observations stream through the native binary without EOF or journal mutation", { timeout: 90_000 }, async () => {
    const binary = process.env.WORKBENCH_TEST_BINARY;
    assert.ok(binary, "WORKBENCH_TEST_BINARY must name the built native executable");
    const root = mkdtempSync(join(tmpdir(), "workbench-stream-cli-"));
    let child;
    let closed;
    let store;
    try {
        const f = dagFixture(root);
        await f.coordinator.start(f.contract, f.command, f.approval);
        const journal = readFileSync(journalPath(f.runPath));
        function observe() {
            const result = spawnSync(process.execPath, ["--import", "tsx", "packages/coding-agent/src/cli.ts", "run", "graph", "dag", "--state-dir", f.stateRoot], {
                cwd: repository, env: { PATH: process.env.PATH, HOME: root, OMK_OFFLINE: "1", OMK_SKIP_VERSION_CHECK: "1" },
                encoding: "utf8", timeout: 30_000, maxBuffer: 1_048_576,
            });
            assert.equal(result.status, 0, result.stderr);
            return result.stdout;
        }
        child = spawn(binary, ["--stream"], { cwd: root, env: {}, stdio: ["pipe", "pipe", "pipe"] });
        closed = once(child, "close");
        // Start the iterator before sending input, with no transcript collector.
        const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
        const iterator = lines[Symbol.asyncIterator]();
        async function send(snapshot) {
            const pending = iterator.next();
            child.stdin.write(snapshot);
            let timer;
            try {
                const next = await Promise.race([
                    pending,
                    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("snapshot was not flushed before EOF")), 5000); }),
                ]);
                assert.equal(next.done, false);
                const value = JSON.parse(next.value);
                assert.deepEqual(value, JSON.parse(snapshot));
                return value;
            } finally {
                clearTimeout(timer);
            }
        }
        const first = observe();
        const initial = await send(first);
        assert.equal(initial.proofVerdict, "verified");
        store = AuthorityStore.open(authorityStorePath(f.stateRoot), { capacity: 16 });
        store.reconcile();
        const incarnation = store.register("dag");
        const grant = store.acquire({
            sessionId: "dag", incarnation, commandId: "stream-observation", intentDigest: "a".repeat(64),
            claims: [{ namespace: "git-ref", instanceId: "stream-fixture", canonicalKey: "ref", access: "write", generation: "0" }],
            now: Date.now(), ttl: 60_000,
        });
        assert.equal(grant.status, "granted");
        const reserved = await send(observe());
        assert.equal(reserved.proofVerdict, "inconclusive");
        assert.equal(store.cancel(grant.token), true);
        const last = observe();
        const cancelled = await send(last);
        assert.equal(cancelled.proofVerdict, "verified");
        assert.equal(initial.cursor.revision, reserved.cursor.revision);
        assert.equal(initial.cursor.revision, cancelled.cursor.revision);
        assert.ok(cancelled.cursor.authorityRevision > reserved.cursor.authorityRevision);
        child.stdin.end(last + first); // duplicate and stale observations produce no extra output
        const [code, signal] = await closed;
        assert.equal(signal, null);
        assert.equal(code, 0);
        assert.equal((await iterator.next()).done, true);
        assert.deepEqual(readFileSync(journalPath(f.runPath)), journal);
    } finally {
        store?.release();
        if (child) {
            if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
            await closed;
        }
        rmSync(root, { recursive: true, force: true });
    }
});
