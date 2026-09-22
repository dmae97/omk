import { VerifiedRunError } from "./storage.ts";

/** Whole-tree inclusion, with explicit metadata exclusions and sensitive-name rejection. */
export const CANDIDATE_POLICY = Object.freeze({
	version: "whole-tree-sensitive-names-v1",
	excludedRoots: Object.freeze([".git", ".omk"]),
	deniedNames: Object.freeze([
		".env",
		".env.local",
		".env.production",
		".env.development",
		".npmrc",
		".netrc",
		".pypirc",
		"credentials.json",
		"id_rsa",
		"id_ed25519",
	]),
	deniedSuffixes: Object.freeze([".pem", ".key"]),
});
const denied = new Set(CANDIDATE_POLICY.deniedNames);

export function safeCandidatePath(path: string): void {
	if (
		!path ||
		Buffer.from(path, "utf8").toString("utf8") !== path ||
		/[\\\u0000-\u001f\u007f]/.test(path) ||
		path.split("/").some((part) => ["", ".", "..", ".git", ".omk"].includes(part))
	)
		throw new VerifiedRunError("file_type");
}

export function assertPublishablePath(path: string): void {
	const name = path.slice(path.lastIndexOf("/") + 1);
	if (denied.has(name) || CANDIDATE_POLICY.deniedSuffixes.some((suffix) => name.endsWith(suffix)))
		throw new VerifiedRunError("secret_path");
}
