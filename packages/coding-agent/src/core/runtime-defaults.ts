export interface AmbientResourceFlagInput {
	noSkills?: boolean;
	noPromptTemplates?: boolean;
	noContextFiles?: boolean;
}

export interface AmbientResourceFlagOutput {
	noSkills: boolean;
	noPromptTemplates: boolean;
	noContextFiles: boolean;
}

export function shouldUseOmkAmbientIsolation(_appName: string): boolean {
	return false;
}

export function resolveAmbientResourceFlags(
	appName: string,
	input: AmbientResourceFlagInput,
): AmbientResourceFlagOutput {
	const isolateAmbientResources = shouldUseOmkAmbientIsolation(appName);
	return {
		noSkills: input.noSkills ?? isolateAmbientResources,
		noPromptTemplates: input.noPromptTemplates ?? isolateAmbientResources,
		noContextFiles: input.noContextFiles ?? isolateAmbientResources,
	};
}

export function shouldIncludeProjectDeprecationWarnings(appName: string): boolean {
	return appName !== "omk";
}
