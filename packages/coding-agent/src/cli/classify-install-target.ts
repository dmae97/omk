/**
 * Classify an install spec as a marketplace plugin reference or a plain npm package.
 *
 * Rules (applied in order):
 *  1. Starts with `@` (scoped npm) -> always npm.
 *  2. Contains `@` after the first character -> split on the LAST `@`.
 *     If the right-hand side is a known marketplace name, it's a marketplace ref.
 *     Otherwise it's an npm spec (e.g. `pkg@1.2.3`).
 *  3. No `@` -> npm.
 */
export function classifyInstallTarget(
	spec: string,
	knownMarketplaces: Set<string>,
): { type: "marketplace"; name: string; marketplace: string } | { type: "npm"; spec: string } {
	// Rule 1: scoped npm package — @ at position 0 is never a marketplace separator.
	if (spec.startsWith("@")) return { type: "npm", spec };
	// Rule 2: @ somewhere after the first character.
	const atIdx = spec.lastIndexOf("@");
	if (atIdx > 0) {
		const rhs = spec.slice(atIdx + 1);
		if (knownMarketplaces.has(rhs)) {
			return { type: "marketplace", name: spec.slice(0, atIdx), marketplace: rhs };
		}
		// Not a known marketplace — treat as npm version specifier.
		return { type: "npm", spec };
	}
	// Rule 3: no @ at all.
	return { type: "npm", spec };
}
