import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { digestBytes, VerifiedRunError } from "./storage.ts";

export interface RustHostBinding {
	readonly path: string;
	readonly sha256: string;
	readonly protocol: "omk.execution-host.v1";
}

let selected: { readonly configured: string; readonly binding: RustHostBinding } | undefined;

/** Explicit operator opt-in for single-command writer/verifier executions, never publication. */
export function rustHostReconnectEnabled(): boolean {
	if (process.env.OMK_RUST_EXECUTION_RECONNECT !== "1") return false;
	if (!rustHostBinding()) throw new VerifiedRunError("unsupported_boundary");
	return true;
}

/** Operator process configuration only; never read from project settings or a run contract. */
export function rustHostBinding(): RustHostBinding | undefined {
	const configured = process.env.OMK_RUST_EXECUTION_HOST;
	if (selected && configured !== selected.configured) throw new VerifiedRunError("native_host_changed");
	if (configured === undefined) return undefined;
	try {
		if (process.platform !== "linux" || !isAbsolute(configured)) throw new Error("path");
		const path = realpathSync(configured);
		const stat = lstatSync(path);
		if (
			!stat.isFile() ||
			stat.size > 67_108_864 ||
			(stat.mode & 0o022) !== 0 ||
			(stat.mode & 0o111) === 0 ||
			(stat.uid !== 0 && stat.uid !== process.getuid?.())
		)
			throw new Error("ownership");
		const bytes = readFileSync(path);
		if (bytes.length > 67_108_864 || !bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])))
			throw new Error("binary");
		const after = statSync(path);
		if (
			after.ino !== stat.ino ||
			after.dev !== stat.dev ||
			after.size !== stat.size ||
			after.mtimeMs !== stat.mtimeMs
		)
			throw new Error("drift");
		const binding = Object.freeze({ path, sha256: digestBytes(bytes), protocol: "omk.execution-host.v1" as const });
		if (selected && (selected.binding.path !== path || selected.binding.sha256 !== binding.sha256))
			throw new Error("drift");
		selected ??= { configured, binding };
		return selected.binding;
	} catch {
		throw new VerifiedRunError(selected ? "native_host_changed" : "unsupported_boundary");
	}
}
