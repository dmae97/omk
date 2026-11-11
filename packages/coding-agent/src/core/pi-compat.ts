export type PiCompatibilityTarget = "coding-agent" | "agent-core" | "agent-core-node" | "ai" | "ai-oauth" | "tui";

const PI_NAMESPACES = ["@earendil-works", "@mariozechner"] as const;

export const LEGACY_PI_RUNTIME_ALIASES: Readonly<Record<string, PiCompatibilityTarget>> = Object.freeze(
	Object.fromEntries(
		PI_NAMESPACES.flatMap((namespace) => [
			[`${namespace}/pi-coding-agent`, "coding-agent"],
			[`${namespace}/pi-agent-core`, "agent-core"],
			[`${namespace}/pi-agent-core/node`, "agent-core-node"],
			[`${namespace}/pi-ai`, "ai"],
			[`${namespace}/pi-ai/compat`, "ai"],
			[`${namespace}/pi-ai/oauth`, "ai-oauth"],
			[`${namespace}/pi-tui`, "tui"],
		]),
	) as Record<string, PiCompatibilityTarget>,
);

const LEGACY_PI_IMPORT =
	/^@(mariozechner|earendil-works|oh-my-pi)\/pi-(?:agent-core|ai|coding-agent|natives|tui|utils)(?:\/|$)/u;

export function isLegacyPiRuntimeImport(specifier: string): boolean {
	return LEGACY_PI_IMPORT.test(specifier);
}

export function isSupportedLegacyPiRuntimeImport(specifier: string): boolean {
	return Object.getOwnPropertyDescriptor(LEGACY_PI_RUNTIME_ALIASES, specifier) !== undefined;
}

const LEGACY_PI_IMPORT_MENTION =
	/@(?:mariozechner|earendil-works|oh-my-pi)\/pi-(?:agent-core|ai|coding-agent|natives|tui|utils)\b/u;

/**
 * Migration hint appended to a native-mode extension load failure that names a legacy Pi package.
 * Since OMK 2.0 an omitted dialect is "omk", so Pi compatibility needs the explicit opt-in.
 */
export function legacyPiImportHint(message: string, dialect: "omk" | "omk+pi"): string {
	if (dialect !== "omk" || !LEGACY_PI_IMPORT_MENTION.test(message)) return "";
	return " (legacy Pi import: OMK 2.0 loads extensions with the native omk dialect by default. Migrate the import to an omk package, or opt into compatibility with --package-manifest-dialect omk+pi. Diagnose with: omk package doctor <source> --package-manifest-dialect omk)";
}
