import { describe, expect, it } from "vitest";
import { getAdaptOrchLinks } from "../src/index.ts";

describe("AdaptOrch service links", () => {
	it.each(["doctor", "wpl"] as const)("uses fixed HTTPS destinations and bounded attribution for %s", (surface) => {
		const links = getAdaptOrchLinks(surface);
		const destinations = {
			plans: ["/", "#pricing"],
			signup: ["/app/signup", ""],
			contact: ["/", "#bookDemo"],
			claimBoundary: ["/claim-boundary", ""],
		};
		for (const [action, href] of Object.entries(links)) {
			const url = new URL(href);
			expect(url.origin).toBe("https://adaptorch.com");
			expect(url.username).toBe("");
			expect(url.password).toBe("");
			expect(destinations).toHaveProperty(action, [url.pathname, url.hash]);
			expect(Object.fromEntries(url.searchParams)).toEqual({
				utm_source: "omk",
				utm_medium: surface === "doctor" ? "cli" : "library",
				utm_campaign: "omk-adaptorch-wpl",
				utm_content: `${surface}-${action === "claimBoundary" ? "claim-boundary" : action}`,
			});
		}
	});

	it("uses library attribution when called without an explicit surface", () => {
		expect(getAdaptOrchLinks()).toEqual(getAdaptOrchLinks("wpl"));
	});

	it.each(["https://untrusted.invalid", "private-session", "toString", null])(
		"rejects an untyped caller's unknown surface without reflecting it",
		(surface) => {
			expect(() => Reflect.apply(getAdaptOrchLinks, undefined, [surface])).toThrow(
				new TypeError("Unknown AdaptOrch link surface"),
			);
		},
	);

	it("returns independent navigation objects without changing verification state", () => {
		const links = getAdaptOrchLinks();
		Reflect.set(links, "signup", "https://untrusted.invalid");
		expect(getAdaptOrchLinks().signup).toMatch(/^https:\/\/adaptorch\.com\/app\/signup\?/);
		expect(getAdaptOrchLinks()).not.toHaveProperty("shouldSubmit");
		expect(getAdaptOrchLinks()).not.toHaveProperty("canApply");
	});
});
