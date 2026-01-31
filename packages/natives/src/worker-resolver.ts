declare const OMP_COMPILED: boolean | undefined;

export function resolveWorkerSpecifier(options: { compiled: string; dev: URL }): string | URL {
	if (typeof OMP_COMPILED !== "undefined" && OMP_COMPILED) {
		return options.compiled;
	}

	return options.dev;
}
