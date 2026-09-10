import path from "node:path";

export function normalizeSandboxPath(value: string): string {
	return path
		.resolve(value)
		.replace(/\\/g, "/")
		.replace(/\/+$/g, (suffix) => (value === suffix ? "/" : ""));
}

export function isInsideSandboxPath(parent: string, child: string): boolean {
	const root = normalizeSandboxPath(parent);
	const candidate = normalizeSandboxPath(child);
	return candidate === root || candidate.startsWith(root === "/" ? "/" : `${root}/`);
}

export function matchesSandboxPath(pattern: string, candidate: string): boolean {
	const prefix = pattern.endsWith("/**")
		? pattern.slice(0, -3)
		: pattern.endsWith("/*")
			? pattern.slice(0, -2)
			: pattern;
	return isInsideSandboxPath(prefix, candidate);
}
