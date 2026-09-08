import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";

/** @typedef {{ id: string, checksum: string }} Task */
/** @typedef {{ job: string, modelName: string, harnessSha256: string, adapterSha256: string }} Arm */
/** @typedef {{ schemaVersion: string, runId: string, datasetRevision: string, conditionsSha256: string, tasks: Task[], arms: { A: Arm, B: Arm } }} Manifest */

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export class AuditError extends Error {
	/** @param {string} code */
	constructor(code) {
		super(code);
		this.name = "AuditError";
		this.code = code;
	}
}

/** @param {unknown} value @param {string} code @returns {Record<string, unknown>} */
export function record(value, code) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new AuditError(code);
	return Object.fromEntries(Object.entries(value));
}

/** @param {unknown} value @param {RegExp} pattern @param {string} code */
export function text(value, pattern, code) {
	if (typeof value !== "string" || !pattern.test(value)) throw new AuditError(code);
	return value;
}

/** @param {Record<string, unknown>} value @param {string[]} keys */
function exactKeys(value, keys) {
	if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
		throw new AuditError("invalid_manifest");
	}
}

/** @param {unknown} value @returns {Arm} */
function parseArm(value) {
	const arm = record(value, "invalid_manifest");
	exactKeys(arm, ["job", "modelName", "harnessSha256", "adapterSha256"]);
	const job = text(arm.job, /^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/u, "invalid_manifest");
	if (job.split("/").some((part) => !ID.test(part))) throw new AuditError("invalid_manifest");
	return {
		job,
		modelName: text(arm.modelName, /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,255}$/u, "invalid_manifest"),
		harnessSha256: text(arm.harnessSha256, SHA256, "invalid_manifest"),
		adapterSha256: text(arm.adapterSha256, SHA256, "invalid_manifest"),
	};
}

/** @param {unknown} value @returns {Manifest} */
export function parseManifest(value) {
	const raw = record(value, "invalid_manifest");
	exactKeys(raw, ["schemaVersion", "runId", "datasetRevision", "conditionsSha256", "tasks", "arms"]);
	if (raw.schemaVersion !== "omk-tb21-manifest-1") throw new AuditError("invalid_manifest");
	if (!Array.isArray(raw.tasks) || raw.tasks.length < 1 || raw.tasks.length > 1000) {
		throw new AuditError("invalid_manifest");
	}
	const tasks = raw.tasks.map((value) => {
		const task = record(value, "invalid_manifest");
		exactKeys(task, ["id", "checksum"]);
		return { id: text(task.id, ID, "invalid_manifest"), checksum: text(task.checksum, SHA256, "invalid_manifest") };
	});
	if (new Set(tasks.map((task) => task.id)).size !== tasks.length) throw new AuditError("invalid_manifest");
	const arms = record(raw.arms, "invalid_manifest");
	exactKeys(arms, ["A", "B"]);
	const A = parseArm(arms.A);
	const B = parseArm(arms.B);
	if (A.job === B.job) throw new AuditError("invalid_manifest");
	return {
		schemaVersion: raw.schemaVersion,
		runId: text(raw.runId, ID, "invalid_manifest"),
		datasetRevision: text(raw.datasetRevision, /^[a-f0-9]{40}$/u, "invalid_manifest"),
		conditionsSha256: text(raw.conditionsSha256, SHA256, "invalid_manifest"),
		tasks,
		arms: { A, B },
	};
}

/** Read only ordinary directories beneath the explicitly selected manifest directory.
 * @param {string} root @param {string} relative
 */
export function jobDirectory(root, relative) {
	let path = root;
	try {
		for (const part of relative.split("/")) {
			path = join(path, part);
			if (!lstatSync(path).isDirectory()) throw new AuditError("unsafe_job_path");
		}
	} catch {
		throw new AuditError("unsafe_job_path");
	}
	return path;
}

/** Bounded reads; errors deliberately exclude paths, parser excerpts, and private result content.
 * @param {string} path @param {"manifest" | "result"} kind
 * @returns {{ value: unknown, sha256: string }}
 */
export function readJson(path, kind) {
	const limit = kind === "manifest" ? 256 * 1024 : 8 * 1024 * 1024;
	let fd;
	let bytes;
	try {
		if (!lstatSync(path).isFile()) throw new AuditError(`invalid_${kind}_file`);
		fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
		const stat = fstatSync(fd);
		if (!stat.isFile() || stat.size > limit) throw new AuditError(`invalid_${kind}_file`);
		const buffer = Buffer.alloc(stat.size + 1);
		let length = 0;
		while (length < buffer.length) {
			const count = readSync(fd, buffer, length, buffer.length - length, null);
			if (count === 0) break;
			length += count;
		}
		if (length !== stat.size) throw new AuditError(`invalid_${kind}_file`);
		bytes = buffer.subarray(0, length);
	} catch {
		throw new AuditError(`invalid_${kind}_file`);
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
	try {
		return { value: JSON.parse(bytes.toString("utf8")), sha256: createHash("sha256").update(bytes).digest("hex") };
	} catch (error) {
		if (error instanceof SyntaxError) throw new AuditError(`invalid_${kind}_json`);
		throw error;
	}
}
