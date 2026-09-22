import type { PathMetadata } from "./package-manager.ts";

export function hasLegacyPathSegment(path: string): boolean {
	return path.split(/[\\/]+/).some((segment) => segment.includes(".legacy."));
}

export function isLegacyAutoSkillResource(resource: { path: string; metadata: PathMetadata }): boolean {
	return (
		resource.metadata.source === "auto" &&
		resource.metadata.origin === "top-level" &&
		hasLegacyPathSegment(resource.path)
	);
}
