import { describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import type { SubscriptionUsageSnapshot } from "../src/core/provider-usage.ts";
import { SubscriptionUsageReader } from "../src/core/subscription-usage-reader.ts";

function session(id: string): AgentSession {
	return { sessionId: id } as AgentSession;
}

function snapshot(usedPercent: number): SubscriptionUsageSnapshot {
	return { label: "CLAUDE", windows: [{ label: "5H", usedPercent }] };
}

describe("SubscriptionUsageReader", () => {
	it("shares fresh and in-flight reads between sidebar and suggestion consumers", async () => {
		const current = session("a");
		let fetches = 0;
		let release: ((value: SubscriptionUsageSnapshot) => void) | undefined;
		const reader = new SubscriptionUsageReader(
			() => current,
			async () => {
				fetches++;
				return new Promise((resolve) => {
					release = resolve;
				});
			},
		);
		const sidebar = reader.refresh("anthropic");
		const suggestion = reader.read("anthropic");
		expect(fetches).toBe(1);
		release?.(snapshot(41));
		await Promise.all([sidebar, suggestion]);
		expect(reader.snapshot("anthropic")?.windows[0]?.usedPercent).toBe(41);
		await reader.read("anthropic");
		expect(fetches).toBe(1);
	});

	it("does not let an old session request overwrite the current session snapshot", async () => {
		let current = session("a");
		const releases = new Map<string, (value: SubscriptionUsageSnapshot) => void>();
		const reader = new SubscriptionUsageReader(
			() => current,
			async (owner) => {
				return new Promise((resolve) => {
					releases.set(owner.sessionId, resolve);
				});
			},
		);
		const oldRead = reader.read("anthropic");
		current = session("b");
		const newRead = reader.read("anthropic");
		releases.get("b")?.(snapshot(22));
		await newRead;
		releases.get("a")?.(snapshot(99));
		await oldRead;
		expect(reader.snapshot("anthropic")?.windows[0]?.usedPercent).toBe(22);
	});

	it("keeps unavailable usage distinct from a missing quota source", async () => {
		const reader = new SubscriptionUsageReader(
			() => session("a"),
			async () => {
				throw new Error("down");
			},
		);
		expect(await reader.read("anthropic")).toMatchObject({ windows: [], message: "usage unavailable" });
		expect(await reader.read("unknown-provider")).toBeUndefined();
	});
});
