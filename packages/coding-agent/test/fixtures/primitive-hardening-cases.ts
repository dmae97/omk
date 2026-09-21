import assert from "node:assert/strict";
import { AdmissionBroker } from "../../src/coordination/broker.ts";
import {
	evaluatePermit,
	type ObservationBinding,
	OperationLifecycle,
	type PermitInput,
} from "../../src/coordination/operation.ts";
import { canonicalClaim, claimKey, claimsConflict, sameClaimSet } from "../../src/coordination/resource.ts";
import { type GrantToken, nextSequence, type ResourceClaim, sequence } from "../../src/coordination/types.ts";
import {
	brierScore,
	distributionFeatures,
	negativeLogLoss,
	selectiveExecution,
	temperatureScale,
} from "../../src/metacognition/calibration-selective.ts";
import {
	bonferroniAlpha,
	clopperPearsonUpperBound,
	minimumZeroFailureSamples,
	regularizedIncompleteBeta,
	unionBoundRisk,
	zeroFailureUpperBound,
} from "../../src/metacognition/risk.ts";

export interface HardeningCase {
	readonly id: string;
	readonly purpose: string;
	readonly run: () => void;
}
function claim(key = "src/a", generation = "0", access: "read" | "write" = "write"): ResourceClaim {
	return canonicalClaim({ namespace: "filesystem", instanceId: "repo", canonicalKey: key, access, generation });
}
function binding(): ObservationBinding {
	return { observationId: "obs-1", actionId: "act-1", targetId: "tab-1", documentGeneration: sequence("3") };
}
function permit(overrides: Partial<PermitInput> = {}): PermitInput {
	return {
		policyAllowed: true,
		intentDigest: "intent-1",
		approvalDigest: "intent-1",
		policyVersion: "p1",
		approvalPolicyVersion: "p1",
		leaseGeneration: sequence("1"),
		currentLeaseGeneration: sequence("1"),
		observationValid: true,
		cancelled: false,
		budgetAvailable: true,
		...overrides,
	};
}
function dispatched(): OperationLifecycle {
	const op = new OperationLifecycle("op");
	op.observe([binding()]);
	op.propose(binding());
	assert.equal(op.authorize(permit()).allowed, true);
	assert.equal(op.dispatch(permit()).allowed, true);
	return op;
}
function broker(capacity = 4) {
	const b = new AdmissionBroker({ capacity });
	return { b, inc: b.register("s") };
}
function near(a: number, b: number, tolerance = 1e-10): void {
	assert.ok(Number.isFinite(a) && Math.abs(a - b) <= tolerance, `${a} != ${b}, tolerance=${tolerance}`);
}

export const hardeningCases: readonly HardeningCase[] = [
	{
		id: "C01",
		purpose: "post-dispatch observation cannot reopen an operation",
		run: () => {
			const op = dispatched();
			assert.throws(() => op.observe([binding()]));
			assert.equal(op.state, "dispatched");
		},
	},
	{
		id: "C02",
		purpose: "post-dispatch proposal cannot create a second dispatch",
		run: () => {
			const op = dispatched();
			assert.throws(() => op.propose(binding()));
			assert.equal(op.dispatched, true);
		},
	},
	{
		id: "C03",
		purpose: "confirmed failure cannot be overwritten by applied",
		run: () => {
			const op = dispatched();
			op.settle("failed-confirmed");
			assert.throws(() => op.settle("applied"));
			assert.equal(op.state, "failed-confirmed");
		},
	},
	{
		id: "C04",
		purpose: "final applied outcome cannot regress to unknown",
		run: () => {
			const op = dispatched();
			op.settle("applied");
			assert.throws(() => op.settle("outcome-unknown"));
			assert.equal(op.state, "applied");
		},
	},
	{
		id: "C05",
		purpose: "duplicate settlement is idempotent, including history",
		run: () => {
			const op = dispatched();
			op.settle("applied");
			const n = op.history.length;
			op.settle("applied");
			assert.equal(op.history.length, n);
		},
	},
	{
		id: "C06",
		purpose: "caller mutation does not change recorded observation",
		run: () => {
			const op = new OperationLifecycle("op");
			const x = { ...binding() };
			op.observe([x]);
			x.actionId = "unobserved";
			assert.throws(() => op.propose(x));
			op.propose(binding());
		},
	},
	{
		id: "C07",
		purpose: "dispatch cannot substitute a different self-consistent approval pair",
		run: () => {
			const op = new OperationLifecycle("op");
			op.observe([binding()]);
			op.propose(binding());
			op.authorize(permit());
			assert.deepEqual(op.dispatch(permit({ intentDigest: "i2", approvalDigest: "i2" })), {
				allowed: false,
				reason: "approval-mismatch",
			});
			assert.equal(op.dispatched, false);
		},
	},
	{
		id: "C08",
		purpose: "authorization snapshot survives caller mutation",
		run: () => {
			const op = new OperationLifecycle("op");
			op.observe([binding()]);
			op.propose(binding());
			const p = { ...permit() };
			op.authorize(p);
			p.intentDigest = "i2";
			p.approvalDigest = "i2";
			assert.equal(op.dispatch(p).allowed, false);
		},
	},
	{
		id: "C09",
		purpose: "lease rollover requires a new authorization",
		run: () => {
			const op = new OperationLifecycle("op");
			op.observe([binding()]);
			op.propose(binding());
			op.authorize(permit());
			assert.deepEqual(
				op.dispatch(permit({ leaseGeneration: sequence("2"), currentLeaseGeneration: sequence("2") })),
				{ allowed: false, reason: "stale-lease" },
			);
		},
	},
	{
		id: "C10",
		purpose: "runtime truthy strings cannot authorize",
		run: () => {
			assert.throws(() => evaluatePermit(permit({ policyAllowed: "true" as unknown as boolean })));
		},
	},
	{
		id: "C11",
		purpose: "unknown driver outcome cannot become a lifecycle state",
		run: () => {
			const op = dispatched();
			assert.throws(() => op.settle("success" as unknown as "applied"));
			assert.equal(op.state, "dispatched");
		},
	},
	{
		id: "C12",
		purpose: "postcondition must be boolean",
		run: () => {
			const op = dispatched();
			op.settle("applied");
			assert.throws(() => op.verify("false" as unknown as boolean));
		},
	},
	{
		id: "C13",
		purpose: "cancel during approval prevents dispatch",
		run: () => {
			const op = new OperationLifecycle("op");
			op.observe([binding()]);
			op.propose(binding());
			op.authorize(permit());
			assert.deepEqual(op.dispatch(permit({ cancelled: true })), { allowed: false, reason: "cancelled" });
			assert.equal(op.state, "cancelled-before-dispatch");
		},
	},
	{
		id: "C14",
		purpose: "cancel after dispatch preserves unknown until observed",
		run: () => {
			const op = dispatched();
			op.cancel();
			assert.equal(op.state, "outcome-unknown");
			op.settle("applied");
			op.verify(true);
			assert.equal(op.state, "verified");
		},
	},
	{
		id: "C15",
		purpose: "unobserved and unapproved actions stay blocked",
		run: () => {
			const op = new OperationLifecycle("op");
			assert.throws(() => op.propose(binding()));
			op.observe([binding()]);
			op.propose(binding());
			assert.throws(() => op.dispatch(permit()));
		},
	},
	{
		id: "C16",
		purpose: "valid operation reaches verified once",
		run: () => {
			const op = dispatched();
			op.settle("applied");
			op.verify(true);
			assert.throws(() => op.observe([binding()]));
			assert.throws(() => op.dispatch(permit()));
		},
	},
	{
		id: "C17",
		purpose: "broker snapshots mutable claim objects",
		run: () => {
			const { b, inc } = broker();
			const x = { ...claim() };
			const t = b.acquire({ sessionId: "s", incarnation: inc, claims: [x], now: 0, ttl: 10 });
			assert.ok(t);
			x.canonicalKey = "src/b";
			assert.equal(b.claimsOf(t)[0]?.canonicalKey, "src/a");
			assert.equal(b.acquire({ sessionId: "s", incarnation: inc, claims: [claim()], now: 1, ttl: 10 }), null);
		},
	},
	{
		id: "C18",
		purpose: "broker validates invalid canonical claims at ingress",
		run: () => {
			const { b, inc } = broker();
			assert.throws(() =>
				b.acquire({
					sessionId: "s",
					incarnation: inc,
					claims: [{ ...claim(), canonicalKey: "a/../b" }],
					now: 0,
					ttl: 10,
				}),
			);
		},
	},
	{
		id: "C19",
		purpose: "unsafe deadline addition is rejected before admission",
		run: () => {
			const { b, inc } = broker();
			assert.throws(() =>
				b.acquire({ sessionId: "s", incarnation: inc, claims: [claim()], now: Number.MAX_SAFE_INTEGER, ttl: 1 }),
			);
		},
	},
	{
		id: "C20",
		purpose: "resource generation change requires readmission",
		run: () => {
			const { b, inc } = broker();
			const token = b.acquire({ sessionId: "s", incarnation: inc, claims: [claim()], now: 0, ttl: 10 });
			assert.ok(token);
			assert.equal(b.start({ token, now: 1, actualClaims: [claim("src/a", "1")] }), false);
		},
	},
	{
		id: "C21",
		purpose: "generation does not remove a resource conflict",
		run: () => {
			assert.equal(claimsConflict(claim(), claim("src/a", "1")), true);
			assert.equal(sameClaimSet([claim()], [claim("src/a", "1")]), false);
		},
	},
	{
		id: "C22",
		purpose: "claim tuple serialization is not delimiter-ambiguous",
		run: () => {
			const a = { ...claim(), instanceId: "a\u0000b", canonicalKey: "c" };
			const b = { ...claim(), instanceId: "a", canonicalKey: "b\u0000c" };
			assert.notEqual(claimKey(a), claimKey(b));
		},
	},
	{
		id: "C23",
		purpose: "ambiguous filesystem keys are rejected",
		run: () => {
			for (const key of ["a\u0000b", "a\\b"]) {
				assert.throws(() => claim(key));
			}
		},
	},
	{
		id: "C24",
		purpose: "sequence overflow cannot escape declared wire bounds",
		run: () => {
			assert.throws(() => nextSequence(sequence("9".repeat(40))));
			assert.equal(nextSequence(sequence("99")), "100");
		},
	},
	{
		id: "C25",
		purpose: "expiry cancellation and authority restart retain live claims",
		run: () => {
			const { b, inc } = broker();
			const token = b.acquire({ sessionId: "s", incarnation: inc, claims: [claim()], now: 0, ttl: 10 });
			assert.ok(token);
			assert.equal(b.start({ token, now: 1, actualClaims: [claim()] }), true);
			b.expire(11);
			b.cancel(token);
			b.restart();
			assert.equal(b.acquire({ sessionId: "s", incarnation: inc, claims: [claim()], now: 12, ttl: 10 }), null);
			assert.equal(b.confirmTerminated(token), true);
			assert.ok(b.acquire({ sessionId: "s", incarnation: inc, claims: [claim()], now: 13, ttl: 10 }));
		},
	},
	{
		id: "C26",
		purpose: "read/read sharing and component boundaries are preserved",
		run: () => {
			assert.equal(claimsConflict(claim("src/a", "0", "read"), claim("src/a", "0", "read")), false);
			assert.equal(claimsConflict(claim("src/a"), claim("src/ab")), false);
			assert.equal(claimsConflict(claim("src/a"), claim("src/a/b")), true);
		},
	},
	{
		id: "C27",
		purpose: "zero capacity and zero weight remain distinct",
		run: () => {
			const { b, inc } = broker(0);
			assert.equal(b.acquire({ sessionId: "s", incarnation: inc, claims: [claim()], now: 0, ttl: 1 }), null);
			assert.ok(b.acquire({ sessionId: "s", incarnation: inc, claims: [claim()], now: 0, ttl: 1, weight: 0 }));
		},
	},
	{
		id: "C28",
		purpose: "temperature scaling remains defined at low temperature",
		run: () => {
			const out = temperatureScale([0.6, 0.4], 1e-4);
			near(out[0]!, 1);
			near(out[1]!, 0);
		},
	},
	{
		id: "C29",
		purpose: "smallest positive temperature preserves ties without NaN",
		run: () => {
			assert.deepEqual(temperatureScale([0.5, 0.5], Number.MIN_VALUE), [0.5, 0.5]);
		},
	},
	{
		id: "C30",
		purpose: "normal-temperature semantics remain unchanged",
		run: () => {
			near(temperatureScale([0.8, 0.2], 2)[0]!, 2 / 3);
			near(temperatureScale([0.7, 0.3], 1)[0]!, 0.7);
		},
	},
	{
		id: "C31",
		purpose: "unrepresentable upper log-loss clip is rejected",
		run: () => {
			assert.throws(() => negativeLogLoss([1], [0], Number.MIN_VALUE));
		},
	},
	{
		id: "C32",
		purpose: "empty selected set is unknown risk, not safe",
		run: () => {
			assert.deepEqual(selectiveExecution([0.2], [0], 0.9, [true]), { admitted: 0, coverage: 0, risk: undefined });
		},
	},
	{
		id: "C33",
		purpose: "scoring and singleton confidence retain interpretation",
		run: () => {
			near(brierScore([1, 0], [1, 0]), 0);
			assert.equal(distributionFeatures([1]).margin, undefined);
			assert.ok(Number.isFinite(negativeLogLoss([1], [0])));
		},
	},
	{
		id: "C34",
		purpose: "zero-failure extreme tail agrees with closed form",
		run: () => {
			near(clopperPearsonUpperBound(0, 100, 1e-20), zeroFailureUpperBound(100, 1e-20), 1e-13);
		},
	},
	{
		id: "C35",
		purpose: "very small alpha with failures does not round to CDF one",
		run: () => {
			near(clopperPearsonUpperBound(2, 100, 1e-20), 0.4167555998371675, 1e-10);
		},
	},
	{
		id: "C36",
		purpose: "invalid incomplete-beta arguments are rejected",
		run: () => {
			assert.throws(() => regularizedIncompleteBeta(-1, 3, 0.5));
			assert.throws(() => regularizedIncompleteBeta(1, 3, NaN));
		},
	},
	{
		id: "C37",
		purpose: "Bonferroni cannot emit zero alpha",
		run: () => {
			assert.throws(() => bonferroniAlpha(Number.MIN_VALUE, 2, 1));
		},
	},
	{
		id: "C38",
		purpose: "Bonferroni comparison count must remain exact",
		run: () => {
			assert.throws(() => bonferroniAlpha(0.05, Number.MAX_SAFE_INTEGER, 2));
			near(bonferroniAlpha(0.05, 10, 2), 0.0025);
		},
	},
	{
		id: "C39",
		purpose: "published ordinary CP examples remain valid",
		run: () => {
			near(clopperPearsonUpperBound(2, 100, 0.05), 0.0616192003960407, 1e-10);
			near(clopperPearsonUpperBound(0, 300, 0.05), 0.00993608194445771, 1e-10);
		},
	},
	{
		id: "C40",
		purpose: "absent evidence and deterministic boundaries remain explicit",
		run: () => {
			assert.throws(() => clopperPearsonUpperBound(0, 0, 0.05));
			assert.equal(clopperPearsonUpperBound(3, 3, 0.05), 1);
			assert.equal(minimumZeroFailureSamples(0.01, 0.05), 299);
			near(unionBoundRisk([0.7, 0.8]), 1);
		},
	},
];

/** Mulberry32 is a reproducible test generator, never a security primitive. */
function generator(seed: number): (n: number) => number {
	let a = seed >>> 0;
	return (n: number): number => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
	};
}
function independentOverlap(a: ResourceClaim, b: ResourceClaim): boolean {
	if (a.namespace !== b.namespace || a.instanceId !== b.instanceId) return false;
	const x = a.canonicalKey.split("/"),
		y = b.canonicalKey.split("/");
	for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return false;
	return true;
}
export function checkTransitionCoverage(): Record<string, number> {
	const counts = {
		acquire: 0,
		read: 0,
		write: 0,
		start: 0,
		started: 0,
		cancel: 0,
		terminate: 0,
		expire: 0,
		restart: 0,
		reincarnate: 0,
	};
	for (let seed = 1; seed <= 64; seed++) {
		const rand = generator(seed),
			b = new AdmissionBroker({ capacity: 4 });
		let inc = b.register("s");
		const entries: Array<{ token: GrantToken; claims: readonly ResourceClaim[]; live: boolean }> = [];
		for (let now = 0; now < 512; now++) {
			const action = rand(8),
				entry = entries.length ? entries[rand(entries.length)] : undefined;
			if (action <= 1) {
				const mode = rand(2) ? "write" : "read";
				counts[mode]++;
				counts.acquire++;
				const claims = [claim(["src", "src/a", "src/b", "other"][rand(4)]!, "0", mode)];
				const token = b.acquire({ sessionId: "s", incarnation: inc, claims, now, ttl: 1 + rand(8) });
				if (token) entries.push({ token, claims, live: false });
			} else if (action === 2 && entry) {
				counts.start++;
				if (b.start({ token: entry.token, now, actualClaims: entry.claims })) {
					entry.live = true;
					counts.started++;
				}
			} else if (action === 3 && entry) {
				counts.cancel++;
				b.cancel(entry.token);
			} else if (action === 4 && entry) {
				counts.terminate++;
				if (b.confirmTerminated(entry.token)) entry.live = false;
			} else if (action === 5) {
				counts.expire++;
				b.expire(now);
			} else if (action === 6) {
				counts.restart++;
				b.restart();
			} else if (action === 7) {
				counts.reincarnate++;
				inc = b.register("s");
			}
			const active = entries.filter((e) => !["terminated", "cancelled"].includes(b.stateOf(e.token) ?? ""));
			assert.ok(active.length <= 4);
			for (const e of entries)
				if (e.live) assert.ok(active.includes(e), `live effect released: seed=${seed} now=${now}`);
			for (let i = 0; i < active.length; i++)
				for (let j = i + 1; j < active.length; j++) {
					const a = active[i]!.claims[0]!,
						c = active[j]!.claims[0]!;
					assert.ok(
						!(independentOverlap(a, c) && (a.access === "write" || c.access === "write")),
						`conflict seed=${seed} now=${now}`,
					);
				}
		}
	}
	for (const key of ["read", "write", "start", "cancel", "terminate", "restart"] as const)
		assert.ok(counts[key] > 1000, `${key} under-covered`);
	assert.ok(counts.started > 50, "few accepted starts");
	return counts;
}
