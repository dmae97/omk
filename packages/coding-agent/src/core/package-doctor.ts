import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { runtimeImportCheck } from "./package-doctor-runtime-imports.ts";
import {
	PACKAGE_DOCTOR_SUPPORTED_EVENTS,
	scanPackageExtensionSources,
	sourceFilesMatching,
	subscribedEvents,
} from "./package-doctor-source-scan.ts";
import {
	type PackageManifestDiagnostic,
	type PackageManifestDialect,
	type PackageManifestKey,
	PackageManifestPolicyError,
	resolvePackageManifest,
	resolvePackageManifestDialect,
} from "./package-manifest.ts";

export interface PackageDoctorResources {
	extensions: string[];
	skills: string[];
	prompts: string[];
	themes: string[];
}

export interface PackageDoctorInput {
	source: string;
	packageRoot: string;
	resources: PackageDoctorResources;
	packageManifestDialect?: PackageManifestDialect;
}

export interface PackageDoctorCheck {
	id:
		| "manifest"
		| "resources"
		| "runtime-imports"
		| "storage-paths"
		| "lifecycle-events"
		| "headless-ui"
		| "resume-awareness"
		| "scan-coverage";
	status: "pass" | "warning" | "error";
	message: string;
	files?: string[];
}

export interface PackageDoctorResult {
	schemaVersion: 1;
	source: string;
	package: { name?: string; version?: string };
	manifest: {
		selected: PackageManifestKey | "convention";
		shadowedPi: boolean;
		diagnostics: Array<{ path: string; message: string }>;
	};
	resources: Record<keyof PackageDoctorResources, number>;
	inspectedFiles: string[];
	checks: PackageDoctorCheck[];
	compatible: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function packageMetadata(value: unknown): { name?: string; version?: string } {
	if (!isRecord(value)) return {};
	return {
		...(typeof value.name === "string" ? { name: value.name.slice(0, 256) } : {}),
		...(typeof value.version === "string" ? { version: value.version.slice(0, 128) } : {}),
	};
}

function sanitizePackageSource(redacted: string): string {
	if (redacted.startsWith("npm:")) return redacted;
	const hasGitPrefix = redacted.startsWith("git:");
	const candidate = hasGitPrefix ? redacted.slice("git:".length) : redacted;
	if (/^(?:https?|ssh|git):\/\//iu.test(candidate)) {
		try {
			const url = new URL(candidate);
			url.username = "";
			url.password = "";
			url.search = "";
			url.hash = "";
			return `${hasGitPrefix ? "git:" : ""}${url.toString()}`;
		} catch {
			return "<remote-package>";
		}
	}
	if (hasGitPrefix) return "<git-package>";
	return `local:${basename(resolve(redacted))}`;
}

function check(
	status: PackageDoctorCheck["status"],
	id: PackageDoctorCheck["id"],
	message: string,
	files: string[] = [],
): PackageDoctorCheck {
	return {
		id,
		status,
		message: message.slice(0, 4096),
		...(files.length > 0
			? {
					files: [...new Set(files)].sort((left, right) => left.localeCompare(right)),
				}
			: {}),
	};
}

function headlessUiCheck(uiFiles: string[], unguardedFiles: string[]): PackageDoctorCheck {
	if (uiFiles.length === 0) return check("pass", "headless-ui", "No UI-only behavior detected");
	if (unguardedFiles.length === 0) return check("pass", "headless-ui", "UI use is guarded for headless modes");
	return check("warning", "headless-ui", "UI use is not guarded by ctx.hasUI or ctx.mode", unguardedFiles);
}

/** Static-only compatibility inspection. Extension modules are never imported or executed. */
export function inspectPackageCompatibility(input: PackageDoctorInput): PackageDoctorResult {
	const dialect = resolvePackageManifestDialect(input.packageManifestDialect);
	const root = resolve(input.packageRoot);
	let packageJson: unknown = {};
	let packageJsonDiagnostics: PackageManifestDiagnostic[] = [];
	try {
		packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as unknown;
	} catch {
		packageJsonDiagnostics = [{ path: "package.json", message: "package.json must contain valid JSON" }];
	}
	let manifest: ReturnType<typeof resolvePackageManifest>;
	let manifestPolicyError = false;
	try {
		manifest = resolvePackageManifest(packageJson, dialect);
	} catch (error) {
		if (!(error instanceof PackageManifestPolicyError)) throw error;
		manifestPolicyError = true;
		manifest = resolvePackageManifest(packageJson, "omk+pi");
		packageJsonDiagnostics.push({ path: "pi", message: error.message });
	}
	const manifestDiagnostics = [...packageJsonDiagnostics, ...manifest.diagnostics];
	const { sources, skipped } = scanPackageExtensionSources(root, input.resources.extensions);
	const allText = sources.map((source) => source.text).join("\n");
	const storageFiles = sourceFilesMatching(sources, (text) =>
		/(?:~\/\.pi|["']\.pi["']|PI_CODING_AGENT_DIR|PI_TODO_PATH)/u.test(text),
	);
	const allEvents = sources.flatMap((source) => subscribedEvents(source.text));
	const unsupportedEvents = [
		...new Set(allEvents.filter((event) => !PACKAGE_DOCTOR_SUPPORTED_EVENTS.has(event))),
	].sort((left, right) => left.localeCompare(right));
	const lifecycleFiles = sourceFilesMatching(sources, (text) =>
		subscribedEvents(text).some((event) => !PACKAGE_DOCTOR_SUPPORTED_EVENTS.has(event)),
	);
	const uiFiles = sourceFilesMatching(sources, (text) => /\bctx\.ui\b/u.test(text));
	const unguardedUiFiles = sourceFilesMatching(
		sources,
		(text) => /\bctx\.ui\b/u.test(text) && !/\bctx\.hasUI\b|\bctx\.mode\b/u.test(text),
	);
	const resumeRelevant = storageFiles.length > 0 || /\bappendEntry\b|\bgetEntries\b|session_switch/u.test(allText);
	const resumeAware =
		!resumeRelevant ||
		(allEvents.includes("session_start") && /["']resume["']|\.reason\s*===?\s*["']resume["']/u.test(allText));
	const totalResources = Object.values(input.resources).reduce((sum, entries) => sum + entries.length, 0);

	const checks: PackageDoctorCheck[] = [
		check(
			manifestDiagnostics.length === 0 ? "pass" : "error",
			"manifest",
			manifestPolicyError
				? 'Pi-only manifests require migration to an "omk" manifest'
				: manifestDiagnostics.length > 0
					? "The selected package manifest is malformed"
					: manifest.key === null
						? "Using convention directories"
						: `Using package.json ${manifest.key} manifest`,
			manifestDiagnostics.map((diagnostic) => diagnostic.path),
		),
		check(totalResources > 0 ? "pass" : "error", "resources", `${totalResources} package resource(s) resolved`),
		runtimeImportCheck(sources, packageJson, dialect),
		check(
			storageFiles.length === 0 ? "pass" : "warning",
			"storage-paths",
			storageFiles.length === 0
				? "No hard-coded .pi storage paths detected"
				: "Hard-coded Pi storage paths may bypass OMK configuration",
			storageFiles,
		),
		check(
			unsupportedEvents.length === 0 ? "pass" : "error",
			"lifecycle-events",
			unsupportedEvents.length === 0
				? "Lifecycle event names are supported"
				: `Unsupported lifecycle event(s): ${unsupportedEvents.join(", ")}`,
			lifecycleFiles,
		),
		headlessUiCheck(uiFiles, unguardedUiFiles),
		check(
			resumeAware ? "pass" : "warning",
			"resume-awareness",
			resumeAware
				? "No resume-state incompatibility detected"
				: "Persistent state does not show a session_start resume path",
		),
		check(
			skipped.length === 0 ? "pass" : "warning",
			"scan-coverage",
			skipped.length === 0
				? `${sources.length} extension file(s) inspected statically${dialect === "omk" ? "; bare/computed/transitive dependency coverage is incomplete" : ""}`
				: `Static scan skipped ${skipped.length} file(s)`,
			skipped,
		),
	];

	return {
		schemaVersion: 1,
		source: sanitizePackageSource(input.source),
		package: packageMetadata(packageJson),
		manifest: {
			selected: manifest.key ?? "convention",
			shadowedPi: manifest.key === "omk" && manifest.present.pi,
			diagnostics: manifestDiagnostics,
		},
		resources: {
			extensions: input.resources.extensions.length,
			skills: input.resources.skills.length,
			prompts: input.resources.prompts.length,
			themes: input.resources.themes.length,
		},
		inspectedFiles: sources.map((source) => source.file).sort((left, right) => left.localeCompare(right)),
		checks,
		compatible: checks.every((item) => item.status !== "error"),
	};
}
