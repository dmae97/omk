import type { CandidateManifest } from "./candidate.ts";
import { assertPublishablePath, safeCandidatePath } from "./candidate-policy.ts";
import { digestBytes, VerifiedRunError } from "./storage.ts";

/** Validate every entry before the first Git object write, including legacy candidates. */
export function preflightGitCandidate(manifest: CandidateManifest, contents: ReadonlyMap<string, Buffer>): void {
	if (manifest.version !== 1 || !Array.isArray(manifest.directories) || !Array.isArray(manifest.files))
		throw new VerifiedRunError("integrity");
	const directories = new Set(manifest.directories);
	const paths = new Set<string>();
	const checkPath = (path: string) => {
		safeCandidatePath(path);
		assertPublishablePath(path);
		if (paths.has(path)) throw new VerifiedRunError("integrity");
		paths.add(path);
		const slash = path.lastIndexOf("/");
		if (slash !== -1 && !directories.has(path.slice(0, slash))) throw new VerifiedRunError("integrity");
	};
	for (const directory of manifest.directories) checkPath(directory);
	for (const file of manifest.files) {
		checkPath(file.path);
		if (file.mode !== 0o644 && file.mode !== 0o755) throw new VerifiedRunError("mode_unrepresentable");
		const bytes = contents.get(file.digest);
		if (
			!bytes ||
			!Number.isSafeInteger(file.size) ||
			file.size < 0 ||
			bytes.length !== file.size ||
			digestBytes(bytes) !== file.digest
		)
			throw new VerifiedRunError("integrity");
	}
}
