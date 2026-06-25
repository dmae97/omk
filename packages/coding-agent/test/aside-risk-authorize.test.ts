import { describe, expect, it } from "vitest";
import { type AuthorizerPolicy, authorize } from "../examples/extensions/aside-computer-use/risk-authorize.ts";
import type { BrowserAction } from "../examples/extensions/aside-computer-use/types.ts";

const policy: AuthorizerPolicy = {
	deniedActions: ["payment", "account_deletion", "credential_export"],
	privilegedR3Actions: [],
	allowedOrigins: ["http://localhost:*", "https://github.com"],
	allowReadAnyOrigin: false,
};

describe("authorize", () => {
	it("R0 read-only respects allowReadAnyOrigin=false and denies foreign reads", () => {
		const local: BrowserAction = { kind: "screenshot", url: "http://localhost:3000/app", description: "" };
		expect(authorize(local, "R0", policy).decision).toBe("allow");
		const foreign: BrowserAction = { kind: "screenshot", url: "https://random.example", description: "" };
		expect(authorize(foreign, "R0", policy).decision).toBe("deny");
	});

	it("R0 read-only allows foreign reads only when allowReadAnyOrigin=true", () => {
		const loose: AuthorizerPolicy = { ...policy, allowReadAnyOrigin: true };
		const foreign: BrowserAction = { kind: "screenshot", url: "https://random.example", description: "" };
		expect(authorize(foreign, "R0", loose).decision).toBe("allow");
	});

	it("R1 is allowed on an allowed origin", () => {
		const local: BrowserAction = { kind: "click_locator", url: "http://localhost:3000/x", description: "" };
		expect(authorize(local, "R1", policy).decision).toBe("allow");
	});

	it("R1/R2/R3 mutating actions with unresolved, non-web, or foreign origins are denied", () => {
		expect(authorize({ kind: "click_locator", description: "" }, "R1", policy).decision).toBe("deny");
		expect(authorize({ kind: "submit", url: "file:///tmp/form.html", description: "" }, "R2", policy).decision).toBe(
			"deny",
		);
		expect(authorize({ kind: "submit", url: "https://evil.com", description: "" }, "R2", policy).decision).toBe(
			"deny",
		);
		expect(authorize({ kind: "delete", url: "https://evil.com", description: "" }, "R3", policy).decision).toBe(
			"deny",
		);
	});

	it("R2 external mutation requires approval even on allowed origin", () => {
		const a: BrowserAction = { kind: "submit", url: "http://localhost:3000/comment", description: "" };
		expect(authorize(a, "R2", policy).decision).toBe("approve");
	});

	it("R3 is denied by default", () => {
		const a: BrowserAction = { kind: "delete", url: "http://localhost:3000/x", description: "" };
		expect(authorize(a, "R3", policy).decision).toBe("deny");
	});

	it("R3 legacy exact critical privilege only requires approval", () => {
		const priv: AuthorizerPolicy = { ...policy, privilegedR3Actions: ["delete"] };
		const a: BrowserAction = { kind: "delete", url: "http://localhost:3000/x", description: "" };
		expect(authorize(a, "R3", priv).decision).toBe("approve");
	});

	it("R3 generic click privilege does not authorize critical click actions", () => {
		const priv: AuthorizerPolicy = { ...policy, privilegedR3Actions: ["click"] };
		const a: BrowserAction = { kind: "click", url: "http://localhost:3000/pay", description: "Pay now" };
		expect(authorize(a, "R3", priv).decision).toBe("deny");
	});

	it("R3 structured privilege returns approval only when kind, origin, and exact target match", () => {
		const expiresAt = new Date(Date.now() + 60_000).toISOString();
		const priv: AuthorizerPolicy = {
			...policy,
			privilegedR3ActionGrants: [
				{
					kind: "click",
					origin: "http://localhost:3000",
					selectorOrLabel: "Pay now",
					expiresAt,
					reason: "test bounded critical click",
				},
			],
		};
		const allowed: BrowserAction = { kind: "click", url: "http://localhost:3000/pay", description: "Pay now" };
		const mismatched: BrowserAction = { kind: "click", url: "http://localhost:3000/pay", description: "Delete" };
		expect(authorize(allowed, "R3", priv).decision).toBe("approve");
		expect(authorize(mismatched, "R3", priv).decision).toBe("deny");
	});

	it("denied actions are absolute and override everything", () => {
		const a: BrowserAction = { kind: "payment", url: "http://localhost:3000/x", description: "" };
		const out = authorize(a, "R2", policy);
		expect(out.decision).toBe("deny");
		expect(out.reason).toContain("denied list");
	});

	it("reason and schemeful targetOrigin are populated", () => {
		const a: BrowserAction = { kind: "submit", url: "https://github.com/owner/repo", description: "open PR" };
		const out = authorize(a, "R2", policy);
		expect(out.targetOrigin).toBe("https://github.com");
		expect(out.risk).toBe("R2");
		expect(out.reason).toContain("approval");
	});
});
