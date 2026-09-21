import { expect, test } from "vitest";
import { AdmissionBroker } from "../src/coordination/broker.ts";
import { canonicalClaim } from "../src/coordination/resource.ts";
import type { ResourceClaim } from "../src/coordination/types.ts";

const claim = canonicalClaim({
	namespace: "filesystem",
	instanceId: "repo",
	canonicalKey: "src/a",
	access: "write",
	generation: "0",
});

test("sparse claims cannot acquire authority or expire an existing reservation", () => {
	const broker = new AdmissionBroker({ capacity: 2 });
	const incarnation = broker.register("s");
	const input = { sessionId: "s", incarnation, now: 0, ttl: 10 };
	const token = broker.acquire({ ...input, claims: [claim] });
	expect(token).not.toBeNull();
	if (!token) throw new Error("fixture reservation failed");

	expect(() => broker.acquire({ ...input, now: 20, claims: new Array<ResourceClaim>(1) })).toThrow(TypeError);
	expect(broker.stateOf(token)).toBe("reserved");
	expect(broker.claimsOf(token)).toEqual([claim]);
});

test("sparse actual claims cannot start an effect under a nonempty reservation", () => {
	const broker = new AdmissionBroker({ capacity: 1 });
	const incarnation = broker.register("s");
	const token = broker.acquire({ sessionId: "s", incarnation, now: 0, ttl: 10, claims: [claim] });
	if (!token) throw new Error("fixture reservation failed");

	expect(() => broker.start({ token, now: 1, actualClaims: new Array<ResourceClaim>(1) })).toThrow(TypeError);
	expect(broker.stateOf(token)).toBe("reserved");
	expect(broker.start({ token, now: 1, actualClaims: [claim] })).toBe(true);
});
