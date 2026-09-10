import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { type ModelContract, ModelContractViolation, snapshotModelContract } from "omk-agent-core";

const MAX_CONTRACT_BYTES = 64 * 1024;

export function loadModelContractOrExit(path: string): ModelContract {
	try {
		return loadModelContract(path);
	} catch (error) {
		console.error(error instanceof Error ? error.message : "Invalid --model-contract");
		process.exit(1);
	}
}

/** Read once per CLI process; neither resume nor cwd changes reload mutable policy. */
export function loadModelContract(path: string): ModelContract {
	let descriptor: number | undefined;
	try {
		descriptor = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
		const stat = fstatSync(descriptor);
		if (!stat.isFile() || stat.size > MAX_CONTRACT_BYTES) throw new TypeError("Invalid contract file");
		const buffer = Buffer.alloc(MAX_CONTRACT_BYTES + 1);
		let length = 0;
		while (length < buffer.length) {
			const size = readSync(descriptor, buffer, length, buffer.length - length, null);
			if (size === 0) break;
			length += size;
		}
		if (length > MAX_CONTRACT_BYTES) throw new TypeError("Oversized contract file");
		const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length));
		const parsed: unknown = JSON.parse(text);
		return snapshotModelContract(parsed);
	} catch (error) {
		if (error instanceof ModelContractViolation) throw error;
		throw new TypeError("--model-contract requires a readable UTF-8 JSON regular file of at most 64 KiB");
	} finally {
		if (descriptor !== undefined) closeSync(descriptor);
	}
}
