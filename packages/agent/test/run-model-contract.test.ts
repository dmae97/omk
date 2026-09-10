import { describe, expect, it } from "vitest";
import {
	assertModelContract,
	type ModelContract,
	ModelContractViolation,
	type ModelContractViolationCode,
	type RouteRequest,
	snapshotModelContract,
} from "../src/run-model-contract.ts";
import type { ThinkingLevel } from "../src/types.ts";

const model = { provider: "fixture-provider", id: "fixture-model" };
const levels: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
const invalidCaps: readonly unknown[] = [
	Number.NaN,
	Number.POSITIVE_INFINITY,
	Number.NEGATIVE_INFINITY,
	Number.MAX_VALUE,
	Number.MAX_SAFE_INTEGER + 1,
	Number.MIN_SAFE_INTEGER,
	Number.MIN_VALUE,
	-1,
	-0,
	0,
	0.5,
	null,
	false,
	"1",
	{},
	[],
];
const invalidIdentifiers: readonly unknown[] = [
	undefined,
	null,
	false,
	1,
	{},
	[],
	"",
	" ",
	" leading",
	"trailing ",
	"line\nbreak",
	"nul\u0000",
	"del\u007f",
	"x".repeat(257),
];
const allowlistFields = ["allowedModels", "allowedProviders", "allowedAuthOrigins"] satisfies (keyof ModelContract)[];

function contract(overrides: Partial<ModelContract> = {}): ModelContract {
	return {
		allowedModels: [{ ...model }],
		allowedProviders: [model.provider],
		allowedAuthOrigins: [model.provider],
		thinking: false,
		maxOutputTokens: 2048,
		...overrides,
	};
}

function request(overrides: Partial<RouteRequest> = {}): RouteRequest {
	return { model: { ...model }, provider: model.provider, thinking: false, ...overrides };
}

function expectViolation(action: () => void, code: ModelContractViolationCode): void {
	expect(action).toThrowError(expect.objectContaining({ name: "ModelContractViolation", code }));
}

describe("output caps", () => {
	it.each([...invalidCaps, undefined].map((value) => ({ value })))(
		"rejects invalid contract cap $value",
		({ value }) => {
			const policy = contract();
			Reflect.set(policy, "maxOutputTokens", value);
			expect(() => assertModelContract(policy, request())).toThrowError(
				expect.objectContaining({
					code: "invalid-contract-limit",
					message: "contract maxOutputTokens must be a positive safe integer",
				}),
			);
			expectViolation(() => snapshotModelContract(policy), "invalid-contract-limit");
		},
	);
	it.each(invalidCaps.map((value) => ({ value })))("rejects invalid explicit request cap $value", ({ value }) => {
		const route = request();
		Reflect.set(route, "maxOutputTokens", value);
		expect(() => assertModelContract(contract(), route)).toThrowError(
			expect.objectContaining({
				code: "invalid-request-limit",
				message: "request maxOutputTokens must be a positive safe integer",
			}),
		);
	});
	it.each([1, 2048, Number.MAX_SAFE_INTEGER])("accepts positive safe cap %s at equality", (maxOutputTokens) => {
		expect(() => assertModelContract(contract({ maxOutputTokens }), request({ maxOutputTokens }))).not.toThrow();
	});
	it("accepts exactly the positive integers at or below the cap in a boundary sweep", () => {
		const policy = contract();
		for (let limit = -1; limit <= policy.maxOutputTokens + 1; limit++) {
			const check = () => assertModelContract(policy, request({ maxOutputTokens: limit }));
			if (limit > 0 && limit <= policy.maxOutputTokens) expect(check).not.toThrow();
			else expect(check).toThrowError(ModelContractViolation);
		}
	});
	it("preserves an omitted request cap without filling or freezing the input", () => {
		const policy = contract();
		const route = request();
		const before = structuredClone({ policy, route });
		expect(assertModelContract(policy, route)).toBeUndefined();
		expect({ policy, route }).toEqual(before);
		expect(Object.hasOwn(route, "maxOutputTokens")).toBe(false);
		expect(Object.isFrozen(policy)).toBe(false);
		expect(Object.isFrozen(route)).toBe(false);
	});
});

describe("logical dispatch scope", () => {
	const denied = [
		[{ provider: "other" }, "provider-mismatch"],
		[{ model: { ...model, provider: "other" } }, "provider-mismatch"],
		[{ model: { ...model, provider: "other" }, provider: "other" }, "provider-not-allowed"],
		[{ model: { ...model, id: "other" } }, "model-not-allowed"],
		[{ authOrigin: "other" }, "auth-origin-not-allowed"],
		[{ thinking: true }, "thinking-not-allowed"],
		[{ maxOutputTokens: 2049 }, "output-limit-exceeded"],
	] satisfies [Partial<RouteRequest>, ModelContractViolationCode][];
	it.each(denied)("denies %j with %s", (override, code) => {
		expectViolation(() => assertModelContract(contract(), request(override)), code);
	});
	it("matches a provider/id pair, not independent allowlists", () => {
		const other = { provider: "other", id: "other-model" };
		const policy = contract({ allowedModels: [model, other], allowedProviders: [model.provider, other.provider] });
		const route = request({ model: { ...model, provider: other.provider }, provider: other.provider });
		expectViolation(() => assertModelContract(policy, route), "model-not-allowed");
	});
	it("checks the default auth origin against its own allowlist", () => {
		expectViolation(
			() => assertModelContract(contract({ allowedAuthOrigins: ["resolver"] }), request()),
			"auth-origin-not-allowed",
		);
	});
	it("accepts an allowed logical resolver distinct from the provider", () => {
		const policy = contract({ allowedAuthOrigins: ["resolver"] });
		expect(() => assertModelContract(policy, request({ authOrigin: "resolver" }))).not.toThrow();
	});
	it("uses exact identities without wildcards or case folding", () => {
		expectViolation(
			() => assertModelContract(contract({ allowedProviders: ["*"] }), request()),
			"provider-not-allowed",
		);
		const policy = contract({ allowedAuthOrigins: [model.provider.toUpperCase()] });
		expectViolation(() => assertModelContract(policy, request()), "auth-origin-not-allowed");
	});
});

describe("thinking permission and effective level", () => {
	it.each([false, true])("permits thinking=%s when enabled without a level pin", (thinking) => {
		expect(() => assertModelContract(contract({ thinking: true }), request({ thinking }))).not.toThrow();
	});
	it.each(levels)("accepts the pinned %s level and preserves it in snapshots", (thinkingLevel) => {
		const policy = contract({ thinking: true, thinkingLevel });
		expect(() =>
			assertModelContract(policy, request({ thinking: thinkingLevel !== "off", thinkingLevel })),
		).not.toThrow();
		expect(snapshotModelContract(policy).thinkingLevel).toBe(thinkingLevel);
	});
	it.each(levels.filter((level) => level !== "off"))(
		"treats missing effort as off, not pinned %s",
		(thinkingLevel) => {
			expectViolation(
				() => assertModelContract(contract({ thinking: true, thinkingLevel }), request()),
				"thinking-level-mismatch",
			);
		},
	);
	it("accepts absent effort for an off pin", () => {
		expect(() => assertModelContract(contract({ thinkingLevel: "off" }), request())).not.toThrow();
	});
	it("defaults absent effort to off independently of the legacy thinking flag", () => {
		const policy = contract({ thinking: true, thinkingLevel: "off" });
		expect(() => assertModelContract(policy, request({ thinking: true }))).not.toThrow();
	});
	it.each(["low", "medium"] satisfies ThinkingLevel[])("rejects lower effort %s for a high pin", (thinkingLevel) => {
		const policy = contract({ thinking: true, thinkingLevel: "high" });
		expectViolation(
			() => assertModelContract(policy, request({ thinking: true, thinkingLevel })),
			"thinking-level-mismatch",
		);
	});
	it("rejects contradictory thinking flags and explicit effort", () => {
		expectViolation(() => snapshotModelContract(contract({ thinkingLevel: "high" })), "invalid-contract");
		expectViolation(
			() => assertModelContract(contract({ thinking: true }), request({ thinkingLevel: "high" })),
			"invalid-request",
		);
		const route = request({ thinking: true, thinkingLevel: "off" });
		expectViolation(() => assertModelContract(contract({ thinking: true }), route), "invalid-request");
	});
});

describe.each(allowlistFields)("%s input validation", (field) => {
	const oversized = Array.from({ length: 65 }, () => (field === "allowedModels" ? model : model.provider));
	const values: readonly unknown[] = [undefined, null, false, {}, "fixture", [], [null], new Array(1), oversized];
	it.each(values.map((value) => ({ value })))("rejects malformed or unbounded list $value", ({ value }) => {
		const policy = contract();
		Reflect.set(policy, field, value);
		expectViolation(() => assertModelContract(policy, request()), "invalid-contract");
		expectViolation(() => snapshotModelContract(policy), "invalid-contract");
	});
});

describe("runtime JSON validation", () => {
	it("rejects unknown policy fields without echoing their values", () => {
		const policy = contract();
		Reflect.set(policy, "unsupportedPolicy", "raw-private-fixture");
		expect(() => snapshotModelContract(policy)).toThrowError(new ModelContractViolation("invalid-contract"));
	});
	it.each([undefined, null, false, 1, "fixture", []].map((value) => ({ value })))(
		"rejects non-object $value",
		({ value }) => {
			const inputs = { policy: contract(), route: request() };
			Reflect.set(inputs, "policy", value);
			Reflect.set(inputs, "route", value);
			expectViolation(() => snapshotModelContract(inputs.policy), "invalid-contract");
			expectViolation(() => assertModelContract(inputs.policy, request()), "invalid-contract");
			expectViolation(() => assertModelContract(contract(), inputs.route), "invalid-request");
		},
	);
	it.each(invalidIdentifiers.map((value) => ({ value })))("rejects invalid identity $value", ({ value }) => {
		for (const field of ["provider", "id"]) {
			const identity = { ...model };
			Reflect.set(identity, field, value);
			expectViolation(() => snapshotModelContract(contract({ allowedModels: [identity] })), "invalid-contract");
			expectViolation(() => assertModelContract(contract(), request({ model: identity })), "invalid-request");
		}
		for (const field of ["allowedProviders", "allowedAuthOrigins"]) {
			const policy = contract();
			Reflect.set(policy, field, [value]);
			expectViolation(() => snapshotModelContract(policy), "invalid-contract");
		}
		const route = request();
		Reflect.set(route, "provider", value);
		expectViolation(() => assertModelContract(contract(), route), "invalid-request");
		if (value !== undefined) {
			const authRoute = request();
			Reflect.set(authRoute, "authOrigin", value);
			expectViolation(() => assertModelContract(contract(), authRoute), "invalid-request");
		}
	});
	it.each([undefined, null, 0, "off", "false", {}, []].map((value) => ({ value })))(
		"rejects thinking $value",
		({ value }) => {
			const policy = contract();
			const route = request();
			Reflect.set(policy, "thinking", value);
			Reflect.set(route, "thinking", value);
			expectViolation(() => snapshotModelContract(policy), "invalid-contract");
			expectViolation(() => assertModelContract(contract(), route), "invalid-request");
		},
	);
	it.each([null, false, 1, "", "HIGH", "unknown", {}, []].map((value) => ({ value })))(
		"rejects effort $value",
		({ value }) => {
			const policy = contract({ thinking: true });
			const route = request({ thinking: true });
			Reflect.set(policy, "thinkingLevel", value);
			Reflect.set(route, "thinkingLevel", value);
			expectViolation(() => snapshotModelContract(policy), "invalid-contract");
			expectViolation(() => assertModelContract(contract(), route), "invalid-request");
		},
	);
	it("accepts the inclusive allowlist and identity bounds", () => {
		const identity = { provider: "p".repeat(256), id: "m".repeat(256) };
		const policy = contract({
			allowedModels: Array.from({ length: 64 }, () => identity),
			allowedProviders: Array.from({ length: 64 }, () => identity.provider),
			allowedAuthOrigins: Array.from({ length: 64 }, () => identity.provider),
		});
		expect(() =>
			assertModelContract(snapshotModelContract(policy), request({ model: identity, provider: identity.provider })),
		).not.toThrow();
	});
});

describe("immutable policy snapshots", () => {
	it("projects identities without inspecting unrelated model headers", () => {
		const fullModel = {
			...model,
			baseUrl: "https://example.invalid",
			headers: { Authorization: "synthetic-fixture" },
		};
		Object.defineProperty(fullModel, "headers", {
			get: () => {
				throw new Error("unrelated header accessed");
			},
		});
		Reflect.set(fullModel, "unrelated", fullModel);
		expect(snapshotModelContract(contract({ allowedModels: [fullModel] }))).toEqual(contract());
	});
	it("detaches the graph while leaving the caller's graph mutable and unchanged", () => {
		const policy = contract({ thinking: true, thinkingLevel: "high" });
		const before = structuredClone(policy);
		const snapshot = snapshotModelContract(policy);
		expect(policy).toEqual(before);
		expect(snapshot).not.toBe(policy);
		for (const value of [policy, policy.allowedModels, policy.allowedProviders, policy.allowedAuthOrigins]) {
			expect(Object.isFrozen(value)).toBe(false);
		}
		for (const field of allowlistFields) expect(snapshot[field]).not.toBe(policy[field]);
		for (const identity of policy.allowedModels) {
			expect(Object.isFrozen(identity)).toBe(false);
			Reflect.set(identity, "id", "changed");
		}
		Reflect.set(policy.allowedModels, "1", { ...model, id: "new" });
		Reflect.set(policy.allowedProviders, "0", "changed");
		Reflect.set(policy.allowedAuthOrigins, "0", "changed");
		Reflect.set(policy, "thinking", false);
		Reflect.set(policy, "thinkingLevel", "off");
		Reflect.set(policy, "maxOutputTokens", 1);
		expect(snapshot).toEqual(before);
		for (const value of [
			snapshot,
			snapshot.allowedModels,
			snapshot.allowedProviders,
			snapshot.allowedAuthOrigins,
			...snapshot.allowedModels,
		]) {
			expect(Object.isFrozen(value)).toBe(true);
			expect(Reflect.set(value, "injected", true)).toBe(false);
		}
		expect(Reflect.set(snapshot, "maxOutputTokens", 4096)).toBe(false);
		expect(() => assertModelContract(snapshot, request({ thinking: true, thinkingLevel: "high" }))).not.toThrow();
	});
});

describe("safe closed violation codes", () => {
	it("exposes an Error with a stable safe message", () => {
		const error = new ModelContractViolation("model-not-allowed");
		expect(error).toBeInstanceOf(Error);
		expect(error.code).toBe("model-not-allowed");
		expect(error.message).toBe("Model is not allowed by the model contract");
	});
	const invalidCodes: readonly unknown[] = [
		"raw-private-fixture",
		"__proto__",
		"toString",
		"constructor",
		undefined,
		null,
		false,
		{},
	];
	it.each(invalidCodes.map((value) => ({ value })))("closes invalid runtime code $value safely", ({ value }) => {
		const supplied = { code: "invalid-contract" } satisfies { code: ModelContractViolationCode };
		Reflect.set(supplied, "code", value);
		const error = new ModelContractViolation(supplied.code);
		expect(error.code).toBe("invalid-contract");
		expect(error.message).toBe("Invalid model contract shape");
	});
});
