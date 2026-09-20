/**
 * Parallel-session coordination broker — P0 of both attached designs.
 *
 * Ported from the author's reference model checks (coordination_model.py /
 * test_coordination.py, 2026-09-20) onto the proposed wire contracts in
 * contracts.ts. The safety property under test is that a grant which may still
 * own a live external effect keeps holding its claims: expiry and cancellation
 * are authorization events, never proof that the effect stopped.
 */

import { describe, expect, it } from "vitest";
import { AdmissionBroker, canonicalClaim, claimsConflict, resourcesOverlap } from "../src/coordination/index.ts";

function claim(
	canonicalKey: string,
	access: "read" | "write" = "write",
	instanceId = "shared",
	namespace: "filesystem" | "git-ref" | "socket" = "filesystem",
) {
	return canonicalClaim({ namespace, instanceId, canonicalKey, access, generation: "0" });
}

describe("resource claim algebra", () => {
	it("lets concurrent readers share a key", () => {
		expect(claimsConflict(claim("src/x", "read"), claim("src/x", "read"))).toBe(false);
	});

	it("conflicts when either side writes", () => {
		expect(claimsConflict(claim("src/x", "read"), claim("src/x"))).toBe(true);
		expect(claimsConflict(claim("src/x"), claim("src/x"))).toBe(true);
	});

	it("treats a directory as covering its descendants", () => {
		expect(claimsConflict(claim("src"), claim("src/a/x"))).toBe(true);
	});

	it("does not let a shared prefix straddle a path component", () => {
		expect(claimsConflict(claim("src/a"), claim("src/ab"))).toBe(false);
	});

	it("isolates the same key in different worktrees", () => {
		expect(claimsConflict(claim("src/x", "write", "front"), claim("src/x", "write", "back"))).toBe(false);
	});

	it("still shares a host-level resource across worktrees", () => {
		expect(
			claimsConflict(claim("tcp/3000", "write", "host", "socket"), claim("tcp/3000", "write", "host", "socket")),
		).toBe(true);
	});

	it("rejects non-canonical keys instead of guessing", () => {
		for (const key of ["/a", "../a", "a/../b", "a//b", "a/./b", ""]) {
			expect(() => claim(key), key).toThrow();
		}
	});

	it("is symmetric over a small exhaustive grid", () => {
		const keys = ["src", "src/a", "src/b", "src/ab"] as const;
		const modes = ["read", "write"] as const;
		const instances = ["s1", "s2"] as const;
		const all = keys.flatMap((k) => modes.flatMap((m) => instances.map((i) => claim(k, m, i))));
		for (const a of all) {
			for (const b of all) {
				expect(claimsConflict(a, b)).toBe(claimsConflict(b, a));
			}
		}
	});

	it("overlap ignores access and only compares identity", () => {
		expect(resourcesOverlap(claim("src/a"), claim("src/a", "read"))).toBe(true);
		expect(resourcesOverlap(claim("src/a"), claim("src/b"))).toBe(false);
	});
});

describe("admission broker", () => {
	function setup(capacity = 4) {
		const broker = new AdmissionBroker({ capacity });
		const front = broker.register("front");
		const back = broker.register("back");
		return { broker, front, back };
	}

	function grant(broker: AdmissionBroker, incarnation: string, claims = [claim("src/a")], ttl = 10, weight = 1) {
		const token = broker.acquire({ sessionId: "front", incarnation, claims, now: 0, ttl, weight });
		expect(token).not.toBeNull();
		return token!;
	}

	it("refuses a second writer for the same key", () => {
		const { broker, front, back } = setup();
		grant(broker, front);
		expect(
			broker.acquire({ sessionId: "back", incarnation: back, claims: [claim("src/a")], now: 0, ttl: 10 }),
		).toBeNull();
	});

	it("admits a disjoint claim", () => {
		const { broker, front, back } = setup();
		grant(broker, front);
		expect(
			broker.acquire({ sessionId: "back", incarnation: back, claims: [claim("src/b")], now: 0, ttl: 10 }),
		).not.toBeNull();
	});

	it("admits a bundle only when every claim is free", () => {
		const { broker, front, back } = setup();
		grant(broker, front);
		expect(
			broker.acquire({
				sessionId: "back",
				incarnation: back,
				claims: [claim("src/b"), claim("src/a")],
				now: 0,
				ttl: 10,
			}),
		).toBeNull();
		expect(
			broker.acquire({ sessionId: "back", incarnation: back, claims: [claim("src/b")], now: 0, ttl: 10 }),
		).not.toBeNull();
	});

	it("releases a reservation that expired before any effect started", () => {
		const { broker, front, back } = setup();
		const token = grant(broker, front);
		expect(broker.start({ token, now: 10, actualClaims: [claim("src/a")] })).toBe(false);
		expect(
			broker.acquire({ sessionId: "back", incarnation: back, claims: [claim("src/a")], now: 11, ttl: 10 }),
		).not.toBeNull();
	});

	it("keeps the claim held when a running effect outlives its authorization", () => {
		const { broker, front, back } = setup();
		const token = grant(broker, front);
		expect(broker.start({ token, now: 1, actualClaims: [claim("src/a")] })).toBe(true);
		expect(
			broker.acquire({ sessionId: "back", incarnation: back, claims: [claim("src/a")], now: 11, ttl: 10 }),
		).toBeNull();
		expect(broker.stateOf(token)).toBe("quarantined");
	});

	it("reassigns only after termination is confirmed", () => {
		const { broker, front, back } = setup();
		const token = grant(broker, front);
		broker.start({ token, now: 1, actualClaims: [claim("src/a")] });
		broker.expire(12);
		expect(broker.confirmTerminated(token)).toBe(true);
		expect(
			broker.acquire({ sessionId: "back", incarnation: back, claims: [claim("src/a")], now: 13, ttl: 10 }),
		).not.toBeNull();
	});

	it("quarantines a cancelled running effect but frees a cancelled reservation", () => {
		const { broker, front, back } = setup();
		const running = grant(broker, front);
		broker.start({ token: running, now: 1, actualClaims: [claim("src/a")] });
		broker.cancel(running);
		expect(broker.stateOf(running)).toBe("quarantined");
		expect(
			broker.acquire({ sessionId: "back", incarnation: back, claims: [claim("src/a")], now: 2, ttl: 10 }),
		).toBeNull();

		const { broker: b2, front: f2, back: k2 } = setup();
		const reserved = grant(b2, f2);
		b2.cancel(reserved);
		expect(b2.stateOf(reserved)).toBe("cancelled");
		expect(
			b2.acquire({ sessionId: "back", incarnation: k2, claims: [claim("src/a")], now: 2, ttl: 10 }),
		).not.toBeNull();
	});

	it("never lets a settled token act on a successor grant", () => {
		const { broker, front, back } = setup();
		const token = grant(broker, front);
		broker.confirmTerminated(token);
		const fresh = broker.acquire({ sessionId: "back", incarnation: back, claims: [claim("src/a")], now: 1, ttl: 10 });
		expect(fresh).not.toBeNull();
		expect(broker.start({ token, now: 2, actualClaims: [claim("src/a")] })).toBe(false);
		expect(broker.confirmTerminated(token)).toBe(false);
		expect(broker.stateOf(fresh!)).toBe("reserved");
	});

	it("keeps an unknown effect held across an authority restart", () => {
		const { broker, front, back } = setup();
		const token = grant(broker, front);
		broker.start({ token, now: 1, actualClaims: [claim("src/a")] });
		broker.restart();
		expect(broker.start({ token, now: 2, actualClaims: [claim("src/a")] })).toBe(false);
		expect(
			broker.acquire({ sessionId: "back", incarnation: back, claims: [claim("src/a")], now: 3, ttl: 10 }),
		).toBeNull();
		expect(broker.confirmTerminated(token)).toBe(true);
	});

	it("invalidates a token when its session re-registers", () => {
		const { broker, front } = setup();
		const token = grant(broker, front);
		broker.register("front");
		expect(broker.start({ token, now: 1, actualClaims: [claim("src/a")] })).toBe(false);
	});

	it("refuses a start whose actual claims exceed the reservation", () => {
		const { broker, front } = setup();
		const token = grant(broker, front);
		expect(broker.start({ token, now: 1, actualClaims: [claim("src/a"), claim("src/b")] })).toBe(false);
	});

	it("admits nothing at zero capacity", () => {
		const broker = new AdmissionBroker({ capacity: 0 });
		const inc = broker.register("x");
		expect(broker.acquire({ sessionId: "x", incarnation: inc, claims: [claim("x")], now: 0, ttl: 1 })).toBeNull();
	});

	it("rejects malformed numeric input instead of coercing", () => {
		const { broker, front } = setup();
		for (const ttl of [0, -1, Number.NaN, 1.1]) {
			expect(() =>
				broker.acquire({ sessionId: "front", incarnation: front, claims: [claim("x")], now: 0, ttl }),
			).toThrow();
		}
	});

	it("refuses an empty scope rather than treating it as no scope", () => {
		const { broker, front } = setup();
		expect(() => broker.acquire({ sessionId: "front", incarnation: front, claims: [], now: 0, ttl: 10 })).toThrow();
	});

	it("rejects an acquire from a superseded session incarnation", () => {
		const { broker, front } = setup();
		broker.register("front");
		expect(() =>
			broker.acquire({ sessionId: "front", incarnation: front, claims: [claim("src/a")], now: 0, ttl: 10 }),
		).toThrow(/stale session/i);
	});

	it("holds the safety invariant across randomized transitions", () => {
		for (let seed = 0; seed < 50; seed += 1) {
			let state = seed + 1;
			const rand = (n: number): number => {
				state = (state * 1103515245 + 12345) & 0x7fffffff;
				return state % n;
			};
			const broker = new AdmissionBroker({ capacity: 3 });
			const sessions = ["f", "b", "t"].map((s) => ({ id: s, inc: broker.register(s) }));
			const live: Array<ReturnType<AdmissionBroker["acquire"]>> = [];
			for (let now = 0; now < 200; now += 1) {
				const action = rand(6);
				const who = sessions[rand(sessions.length)]!;
				if (action === 0) {
					const key = ["src/a", "src/b", "src"][rand(3)]!;
					const token = broker.acquire({
						sessionId: who.id,
						incarnation: who.inc,
						claims: [claim(key, rand(2) === 0 ? "read" : "write")],
						now,
						ttl: 1 + rand(5),
					});
					if (token) live.push(token);
				} else if (action === 1 && live.length > 0) {
					const token = live[rand(live.length)]!;
					if (token) broker.start({ token, now, actualClaims: broker.claimsOf(token) });
				} else if (action === 2 && live.length > 0) {
					const token = live[rand(live.length)]!;
					if (token) broker.cancel(token);
				} else if (action === 3 && live.length > 0) {
					const token = live[rand(live.length)]!;
					if (token) broker.confirmTerminated(token);
				} else if (action === 4) {
					broker.expire(now);
				} else if (action === 5 && rand(20) === 0) {
					broker.restart();
				}
				expect(broker.isSafe(), `seed=${seed} step=${now}`).toBe(true);
			}
		}
	});
});
