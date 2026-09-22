import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeExclusiveFileDurablySync } from "../durable-file-io.ts";
import { ownedGitDirectory } from "./git-sandbox-layout.ts";
import { type GitWorkerRequest, serializeGitRequest, writeGitControl } from "./git-worker-protocol.ts";
import { digestBytes, digestObject, readRegularFile, VerifiedRunError } from "./storage.ts";

const MODULES = [
	"canonical-json",
	"durable-file-directory",
	"durable-file-io",
	"durable-file-mode",
	"verified-run/storage",
	"verified-run/candidate-policy",
	"verified-run/git-candidate-preflight",
	"verified-run/git-execution",
	"verified-run/git-plumbing",
	"verified-run/git-worker-protocol",
	"verified-run/git-publication-worker",
] as const;
export interface GitWorkerRuntime {
	readonly files: readonly { readonly path: string; readonly bytes: Buffer }[];
	readonly extension: "ts" | "js";
	readonly digest: string;
}

/** Read only installed trusted modules. Model output cannot select a loader or module path. */
export function loadGitWorkerRuntime(): GitWorkerRuntime {
	if (process.release.name !== "node" || "bun" in process.versions || !import.meta.url.startsWith("file:"))
		throw new VerifiedRunError("unsupported_git_runtime");
	const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
	const core = fileURLToPath(new URL("../", import.meta.url));
	try {
		const files = MODULES.map((name) => ({
			path: `core/${name}.${extension}`,
			bytes: readRegularFile(join(core, `${name}.${extension}`), 1_048_576),
		}));
		const nodeDigest = digestBytes(readRegularFile(realpathSync(process.execPath), 256 * 1024 * 1024));
		return {
			files,
			extension,
			digest: digestObject({
				version: "owned-git-v1",
				nodeDigest,
				files: files.map(({ path, bytes }) => ({ path, digest: digestBytes(bytes) })),
			}),
		};
	} catch {
		throw new VerifiedRunError("unsupported_git_runtime");
	}
}

export interface GitWorkerStage {
	readonly root: string;
	readonly worker: string;
	readonly request: string;
	readonly dispatchId: string;
}
export function prepareGitWorker(
	workspace: string,
	runtime: GitWorkerRuntime,
	request: GitWorkerRequest,
): GitWorkerStage {
	const git = ownedGitDirectory(workspace);
	const root = mkdtempSync(join(git, "omk-publish-"));
	try {
		const payload = serializeGitRequest(request);
		if (Buffer.byteLength(JSON.stringify(payload)) > 128 * 1024 * 1024) throw new VerifiedRunError("storage_limit");
		for (const file of runtime.files) {
			const target = join(root, "runtime", file.path);
			mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
			writeExclusiveFileDurablySync(target, file.bytes);
		}
		writeExclusiveFileDurablySync(join(root, "runtime", "package.json"), Buffer.from('{"type":"module"}\n'));
		writeGitControl(join(root, "request.json"), payload);
		const dispatchId = root.slice(git.length + 1);
		return {
			root,
			dispatchId,
			worker: `/workspace/.git/${dispatchId}/runtime/core/verified-run/git-publication-worker.${runtime.extension}`,
			request: `/workspace/.git/${dispatchId}/request.json`,
		};
	} catch (error) {
		rmSync(root, { recursive: true, force: true });
		throw error;
	}
}
