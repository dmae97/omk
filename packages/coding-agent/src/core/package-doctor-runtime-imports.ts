import { importedSpecifiers, type ScannedPackageSource, sourceFilesMatching } from "./package-doctor-source-scan.ts";
import type { PackageManifestDialect } from "./package-manifest.ts";
import { isLegacyPiRuntimeImport, isSupportedLegacyPiRuntimeImport } from "./pi-compat.ts";

function declaredDependency(packageJson: unknown, specifier: string): boolean {
	if (typeof packageJson !== "object" || packageJson === null || Array.isArray(packageJson)) return false;
	const root = specifier.split("/").slice(0, 2).join("/");
	return ["dependencies", "peerDependencies", "optionalDependencies"].some((key) => {
		const declarations = (packageJson as Record<string, unknown>)[key];
		if (typeof declarations !== "object" || declarations === null || Array.isArray(declarations)) return false;
		const value = Object.getOwnPropertyDescriptor(declarations, root)?.value;
		return typeof value === "string" && value.trim().length > 0;
	});
}

export function runtimeImportCheck(
	sources: ScannedPackageSource[],
	packageJson: unknown,
	dialect: PackageManifestDialect,
) {
	const aliasedFiles = sourceFilesMatching(sources, (text) =>
		importedSpecifiers(text).some(isSupportedLegacyPiRuntimeImport),
	);
	const unsupportedFiles = sourceFilesMatching(sources, (text) =>
		importedSpecifiers(text).some(
			(specifier) => isLegacyPiRuntimeImport(specifier) && !isSupportedLegacyPiRuntimeImport(specifier),
		),
	);
	let status: "pass" | "warning" | "error" = "pass";
	let message = "No legacy Pi runtime imports detected";
	const files = [...new Set([...unsupportedFiles, ...aliasedFiles])].sort((left, right) => left.localeCompare(right));
	if (dialect === "omk" && files.length > 0) {
		const undeclared = sources.some(({ text }) =>
			importedSpecifiers(text).some(
				(specifier) => isLegacyPiRuntimeImport(specifier) && !declaredDependency(packageJson, specifier),
			),
		);
		status = undeclared ? "error" : "warning";
		message = `Native omk supplies no implicit Pi aliases. ${undeclared ? "Undeclared legacy imports require migration or an explicitly declared and installed dependency. " : "Declared legacy imports resolve only through user-installed dependencies. "}Installation and runtime compatibility are unverified; bare/computed/transitive dependency coverage is incomplete.`;
	} else if (unsupportedFiles.length > 0) {
		status = "error";
		message = "Unsupported Pi runtime imports require a compatibility shim";
	} else if (aliasedFiles.length > 0) {
		status = "warning";
		message = "Legacy Pi runtime imports will use OMK compatibility aliases";
	}
	return { id: "runtime-imports" as const, status, message, ...(files.length > 0 ? { files } : {}) };
}
