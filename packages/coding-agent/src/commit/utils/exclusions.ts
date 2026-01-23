const EXCLUDED_FILES = [
	"Cargo.lock",
	"package-lock.json",
	"npm-shrinkwrap.json",
	"yarn.lock",
	"pnpm-lock.yaml",
	"shrinkwrap.yaml",
	"bun.lock",
	"bun.lockb",
	"deno.lock",
	"composer.lock",
	"Gemfile.lock",
	"poetry.lock",
	"Pipfile.lock",
	"pdm.lock",
	"uv.lock",
	"go.sum",
	"flake.lock",
	"pubspec.lock",
	"Podfile.lock",
	"Packages.resolved",
	"mix.lock",
	"packages.lock.json",
];

export function isExcludedFile(path: string): boolean {
	const lower = path.toLowerCase();
	return EXCLUDED_FILES.some((name) => lower.endsWith(name.toLowerCase()));
}

export function filterExcludedFiles<T extends { filename: string }>(files: T[]): T[] {
	return files.filter((file) => !isExcludedFile(file.filename));
}
