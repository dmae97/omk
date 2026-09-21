import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import type { CandidateManifest } from "./candidate.ts";
import { VerifiedRunError } from "./storage.ts";

/** The single authoritative publication point; moved only by one old-OID CAS. */
export const OMK_ACCEPTED_REF = "refs/omk/accepted";
/** Full SHA-1 or SHA-256 git object names. */
const GIT_OID_HEX = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
const GIT_TIMEOUT_MS = 30_000;
/** Fixed identity and timestamps keep the sealed commit OID a pure function of tree+parent+message. */
const SEAL_ENV = {
	GIT_AUTHOR_NAME: "OMK verified-run",
	GIT_AUTHOR_EMAIL: "omk-verified-run@localhost",
	GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
	GIT_COMMITTER_NAME: "OMK verified-run",
	GIT_COMMITTER_EMAIL: "omk-verified-run@localhost",
	GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
} as const;
/** Inherited variables that could redirect git away from the trusted root; always stripped. */
const UNSAFE_GIT_ENV_VARS = [
	"GIT_ALTERNATE_OBJECT_DIRECTORIES",
	"GIT_CEILING_DIRECTORIES",
	"GIT_COMMON_DIR",
	"GIT_DIFF_OPTS",
	"GIT_DIR",
	"GIT_EXTERNAL_DIFF",
	"GIT_INDEX_FILE",
	"GIT_NAMESPACE",
	"GIT_OBJECT_DIRECTORY",
	"GIT_PREFIX",
	"GIT_WORK_TREE",
] as const;

function gitEnv(write: boolean): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env };
	for (const name of UNSAFE_GIT_ENV_VARS) delete env[name];
	// Read-only commands may skip optional locks; ref writes must never bypass the lock that makes CAS atomic.
	if (!write) env.GIT_OPTIONAL_LOCKS = "0";
	env.LC_ALL = "C";
	return env;
}

function runGit(
	root: string,
	args: readonly string[],
	options: { write?: boolean; input?: Buffer; allowedExitCodes?: readonly number[] } = {},
): { status: number; stdout: Buffer } {
	const result = spawnSync("git", ["-C", root, ...args], {
		env: { ...gitEnv(options.write === true), ...SEAL_ENV },
		maxBuffer: MAX_GIT_OUTPUT_BYTES,
		timeout: GIT_TIMEOUT_MS,
		stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
		input: options.input,
		windowsHide: true,
	});
	if (result.error !== undefined) throw new VerifiedRunError("unsupported");
	const allowed = options.allowedExitCodes ?? [0];
	if (result.status === null || !allowed.includes(result.status)) throw new VerifiedRunError("git_plumbing");
	return { status: result.status, stdout: result.stdout };
}

function oidOf(stdout: Buffer): string {
	const oid = stdout.toString("utf8").trim();
	if (!GIT_OID_HEX.test(oid)) throw new VerifiedRunError("git_plumbing");
	return oid;
}

/**
 * Fail closed unless `root` is exactly the git work-tree top level. Publishing is
 * defined for a repository root only; subdirectory workspaces stay unsupported.
 */
export function assertGitWorkspaceRoot(root: string): void {
	let toplevel = "";
	try {
		toplevel = runGit(root, ["rev-parse", "--show-toplevel"]).stdout.toString("utf8").replace(/\n$/, "");
	} catch (error) {
		if (error instanceof VerifiedRunError) throw new VerifiedRunError("unsupported");
		throw error;
	}
	if (!toplevel || realpathSync(toplevel) !== realpathSync(root)) throw new VerifiedRunError("unsupported");
}

/** `sha1` or `sha256`; determines the zero OID length used for unborn-ref CAS. */
export function repoObjectFormat(root: string): "sha1" | "sha256" {
	const format = runGit(root, ["rev-parse", "--show-object-format"]).stdout.toString("utf8").trim();
	if (format !== "sha1" && format !== "sha256") throw new VerifiedRunError("git_plumbing");
	return format;
}

export function zeroOid(format: "sha1" | "sha256"): string {
	return "0".repeat(format === "sha1" ? 40 : 64);
}

/** Current commit OID of `ref`, or null when the ref does not resolve. */
export function resolveRef(root: string, ref: string): string | null {
	const result = runGit(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
		allowedExitCodes: [0, 1],
	});
	return result.status === 0 ? oidOf(result.stdout) : null;
}

export function objectExists(root: string, oid: string): boolean {
	return runGit(root, ["cat-file", "-e", `${oid}^{commit}`], { allowedExitCodes: [0, 1] }).status === 0;
}

function treeSortKey(name: string, directory: boolean): Buffer {
	return Buffer.from(directory ? `${name}/` : name, "utf8");
}

/** Rebuild the manifest's exact directory hierarchy with `git mktree`; only regular files exist in candidates. */
function buildTree(root: string, manifest: CandidateManifest, contents: ReadonlyMap<string, Buffer>): string {
	const blobOids = new Map<string, string>();
	for (const file of manifest.files) {
		const bytes = contents.get(file.digest);
		if (!bytes || bytes.length !== file.size) throw new VerifiedRunError("integrity");
		blobOids.set(
			file.digest,
			oidOf(runGit(root, ["hash-object", "-w", "--stdin"], { write: true, input: bytes }).stdout),
		);
	}
	const children = new Map<string, { files: CandidateManifest["files"][number][]; dirs: string[] }>();
	children.set("", { files: [], dirs: [] });
	for (const directory of manifest.directories) children.set(directory, { files: [], dirs: [] });
	for (const file of manifest.files) {
		const parent = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
		children.get(parent)?.files.push(file);
	}
	for (const directory of manifest.directories) {
		const parent = directory.includes("/") ? directory.slice(0, directory.lastIndexOf("/")) : "";
		children.get(parent)?.dirs.push(directory);
	}
	const treeOids = new Map<string, string>();
	const ordered = [...manifest.directories].sort((left, right) => right.length - left.length);
	for (const directory of ordered) {
		const entries = children.get(directory);
		if (!entries) throw new VerifiedRunError("integrity");
		treeOids.set(directory, mintTree(root, entries, treeOids, blobOids));
	}
	const top = children.get("");
	if (!top) throw new VerifiedRunError("integrity");
	return mintTree(root, top, treeOids, blobOids);
}

function mintTree(
	root: string,
	entries: { files: CandidateManifest["files"][number][]; dirs: string[] },
	treeOids: ReadonlyMap<string, string>,
	blobOids: ReadonlyMap<string, string>,
): string {
	const lines: { key: Buffer; line: string }[] = [];
	for (const file of entries.files) {
		const name = file.path.slice(file.path.lastIndexOf("/") + 1);
		const oid = blobOids.get(file.digest);
		if (!oid) throw new VerifiedRunError("integrity");
		lines.push({
			key: treeSortKey(name, false),
			line: `${file.mode & 0o111 ? "100755" : "100644"} blob ${oid}\t${name}`,
		});
	}
	for (const directory of entries.dirs) {
		const name = directory.slice(directory.lastIndexOf("/") + 1);
		const oid = treeOids.get(directory);
		if (!oid) throw new VerifiedRunError("integrity");
		lines.push({ key: treeSortKey(name, true), line: `040000 tree ${oid}\t${name}` });
	}
	lines.sort((left, right) => Buffer.compare(left.key, right.key));
	return oidOf(
		runGit(root, ["mktree"], {
			write: true,
			input: Buffer.from(lines.map((entry) => `${entry.line}\n`).join(""), "utf8"),
		}).stdout,
	);
}

export interface SealCandidateInput {
	readonly manifest: CandidateManifest;
	readonly contents: ReadonlyMap<string, Buffer>;
	readonly parentOid: string;
	readonly zeroOid: string;
	readonly runId: string;
	readonly candidateDigest: string;
	readonly receiptDigest: string;
}

/**
 * Seal the stored candidate bytes into a deterministic commit: same manifest,
 * parent and binding fields always produce the same OID, so a replayed publish
 * never creates a second object identity for the same candidate.
 */
export function sealCandidateCommit(root: string, input: SealCandidateInput): string {
	const tree = buildTree(root, input.manifest, input.contents);
	const args = ["commit-tree", tree];
	if (input.parentOid !== input.zeroOid) args.push("-p", input.parentOid);
	args.push(
		"-m",
		`omk: verified candidate\n\nrun: ${input.runId}\ncandidate: ${input.candidateDigest}\nreceipt: ${input.receiptDigest}\n`,
	);
	return oidOf(runGit(root, args, { write: true }).stdout);
}

export class GitRefCasError extends Error {
	readonly ref: string;
	constructor(ref: string) {
		super(`git update-ref rejected ${ref}`);
		this.name = "GitRefCasError";
		this.ref = ref;
	}
}

/** One old-OID compare-and-swap on a single ref. Throws GitRefCasError on any rejection; callers re-resolve to classify. */
export function casRef(root: string, ref: string, newOid: string, expectedOldOid: string): void {
	try {
		runGit(root, ["update-ref", ref, newOid, expectedOldOid], { write: true });
	} catch (error) {
		if (error instanceof VerifiedRunError) throw new GitRefCasError(ref);
		throw error;
	}
}
