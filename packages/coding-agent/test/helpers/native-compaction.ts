import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import { openRunAuthority } from "../../src/core/verified-run/authority-runtime.ts";
import type { AuthorityStoreHooks } from "../../src/core/verified-run/authority-store.ts";
import { workspaceClaim } from "../../src/core/verified-run/owned-execution.ts";
import { digestObject } from "../../src/core/verified-run/storage.ts";

export function compactNativeAuthority(
	runPath: string,
	executionId: string,
	cancel = false,
	hooks?: AuthorityStoreHooks,
) {
	const authority = openRunAuthority(runPath, hooks ? { hooks } : {});
	try {
		const grant = [...authority.store.state.grants.values()].find((item) => item.commandId === executionId);
		if (!grant) throw new Error("original grant missing");
		if (cancel) expect(authority.store.cancel(grant.token)).toBe(true);
		mkdirSync(join(runPath, "compaction"), { recursive: true });
		const sessionId = "disposable";
		const incarnation = authority.store.register(sessionId);
		const disposable = authority.store.acquire({
			sessionId,
			incarnation,
			commandId: `disposable-${incarnation}`,
			intentDigest: digestObject("compaction"),
			claims: workspaceClaim(join(runPath, "compaction"), "read", 1),
			now: Date.now(),
			ttl: 60_000,
		});
		if (disposable.status !== "granted") throw new Error("compaction fixture blocked");
		expect(authority.store.cancel(disposable.token)).toBe(true);
		expect(authority.store.compact(Date.now()).dropped).toBeGreaterThan(0);
		return grant;
	} finally {
		authority.store.release();
	}
}
