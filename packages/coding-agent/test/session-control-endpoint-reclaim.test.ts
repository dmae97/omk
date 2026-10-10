/**
 * F2 follow-up: a `.control.json` left by an unclean session exit must not lock
 * out control for that session file forever. These tests pin the reclaim
 * contract — unreadable or dead-socket endpoints are replaced, while a
 * reachable peer proves a live session still owns the lease.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDurableFileIdentity } from "../src/core/durable-file-identity.ts";
import { controlEndpointPath } from "../src/core/session-control-endpoint.ts";
import { startSessionControl } from "../src/core/session-control-server.ts";
import { acquireSessionOwnerLeaseSync, type SessionOwnerLease } from "../src/core/session-owner-lease.ts";

interface Fixture {
	readonly root: string;
	readonly file: string;
	readonly lease: SessionOwnerLease;
}

function createFixture(): Fixture {
	const root = mkdtempSync(join(tmpdir(), "omk-endpoint-reclaim-"));
	const file = join(root, "session.jsonl");
	writeFileSync(file, "");
	return { root, file, lease: acquireSessionOwnerLeaseSync(file) };
}

function fixtureSession(fixture: Fixture) {
	return {
		sessionFile: fixture.file,
		sessionId: "endpoint-reclaim-fixture",
		sessionManager: { getOwnerLease: () => fixture.lease },
		isStreaming: false,
		isRetrying: false,
		pendingMessageCount: 0,
		prompt: async (_text: string, options: { preflightResult: (accepted: boolean) => void }) => {
			options.preflightResult(true);
		},
		abort: async () => {},
		abortBash() {},
		abortCompaction() {},
		abortBranchSummary() {},
	};
}

describe.skipIf(process.platform === "win32")("control endpoint reclaim", () => {
	const servers: Array<{ close(): Promise<void> }> = [];
	const fixtures: Fixture[] = [];
	afterEach(async () => {
		while (servers.length > 0) await servers.pop()?.close();
		while (fixtures.length > 0) {
			const fixture = fixtures.pop();
			if (!fixture) continue;
			try {
				fixture.lease.release();
			} finally {
				rmSync(fixture.root, { recursive: true, force: true });
			}
		}
	});

	it("reclaims an unreadable endpoint left by a dead session", async () => {
		const fixture = createFixture();
		fixtures.push(fixture);
		writeFileSync(controlEndpointPath(fixture.file), "not json", { mode: 0o600 });
		servers.push(await startSessionControl(fixtureSession(fixture)));
	});

	it("reclaims a valid endpoint whose socket is dead", async () => {
		const fixture = createFixture();
		fixtures.push(fixture);
		writeFileSync(
			controlEndpointPath(fixture.file),
			JSON.stringify({
				version: 1,
				sessionId: "endpoint-reclaim-fixture",
				sessionPath: resolveDurableFileIdentity(fixture.file).canonicalPath,
				socketPath: join(fixture.root, "gone", "rpc"),
				token: "a".repeat(64),
			}),
			{ mode: 0o600 },
		);
		servers.push(await startSessionControl(fixtureSession(fixture)));
	});

	it("refuses to steal a live session's control lease", async () => {
		const fixture = createFixture();
		fixtures.push(fixture);
		servers.push(await startSessionControl(fixtureSession(fixture)));
		await expect(startSessionControl(fixtureSession(fixture))).rejects.toThrow("already active");
	});
});
