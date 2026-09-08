/** Optional product navigation, separate from verdicts, receipts, and execution authority. */
export type AdaptOrchLinkSurface = "doctor" | "wpl";

export interface AdaptOrchLinks {
	readonly plans: string;
	readonly signup: string;
	readonly contact: string;
	readonly claimBoundary: string;
}

/** Pure offline handoff. Accepts no project, prompt, session, credential, or arbitrary URL. */
export function getAdaptOrchLinks(surface: AdaptOrchLinkSurface = "wpl"): AdaptOrchLinks {
	switch (surface) {
		case "doctor":
		case "wpl":
			break;
		default:
			throw new TypeError("Unknown AdaptOrch link surface");
	}

	function link(path: string, action: string): string {
		const url = new URL(path, "https://adaptorch.com");
		url.searchParams.set("utm_source", "omk");
		url.searchParams.set("utm_medium", surface === "doctor" ? "cli" : "library");
		url.searchParams.set("utm_campaign", "omk-adaptorch-wpl");
		url.searchParams.set("utm_content", `${surface}-${action}`);
		return url.href;
	}

	return {
		plans: link("/#pricing", "plans"),
		signup: link("/app/signup", "signup"),
		contact: link("/#bookDemo", "contact"),
		claimBoundary: link("/claim-boundary", "claim-boundary"),
	};
}
