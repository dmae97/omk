import { lstatSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { type NamespaceIdentity, probeNamespace } from "./namespace-identity.ts";
import { VerifiedRunError } from "./storage.ts";

/**
 * Durable termination receipts written by the Rust execution host after it
 * observed the namespace init gone within the same boot. They let restart
 * reconciliation settle an effect whose live probe became inconclusive
 * (reboot, PID reuse) after the parent crashed before recording the witness.
 */
export const nativeWitnessDir = (stateRoot: string): string => join(stateRoot, "native-witness");

const MAX_RECEIPT_BYTES = 1024;

function ownerOnly(path: string, directory: boolean): boolean {
	const stat = lstatSync(path);
	return (
		(directory ? stat.isDirectory() : stat.isFile()) &&
		stat.uid === process.getuid?.() &&
		(stat.mode & (directory ? 0o077 : 0o022)) === 0 &&
		(directory || stat.size <= MAX_RECEIPT_BYTES)
	);
}

/** Create or adopt the private receipt directory the native host requires. */
export function prepareNativeWitnessDir(dir: string): string {
	try {
		mkdirSync(dir, { mode: 0o700 });
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
			throw new VerifiedRunError("witness");
	}
	if (!ownerOnly(dir, true)) throw new VerifiedRunError("witness");
	return dir;
}

function receiptName(identity: NamespaceIdentity): string {
	const inode = /^pid:\[(\d+)\]$/.exec(identity.namespace)?.[1];
	if (!inode) throw new VerifiedRunError("integrity");
	return `${identity.bootId}-${inode}-${identity.pid}-${identity.startTicks}.json`;
}

function receiptBytes(identity: NamespaceIdentity): string {
	return `{"version":1,"kind":"terminated","identity":{"pid":${identity.pid},"startTicks":"${identity.startTicks}","namespace":"${identity.namespace}","bootId":"${identity.bootId}"}}\n`;
}

/** Exact canonical bytes in an owner-only file; anything else is not a witness. */
export function nativeWitnessRecorded(dir: string, identity: NamespaceIdentity): boolean {
	try {
		const path = join(dir, receiptName(identity));
		return ownerOnly(dir, true) && ownerOnly(path, false) && readFileSync(path, "utf8") === receiptBytes(identity);
	} catch {
		return false;
	}
}

/** Live probe first; a receipt only resolves `unknown`, never contradicts `alive`. */
export function probeWithNativeWitness(identity: NamespaceIdentity, dir: string): "alive" | "gone" | "unknown" {
	const status = probeNamespace(identity);
	return status === "unknown" && nativeWitnessRecorded(dir, identity) ? "gone" : status;
}

/** After the authority durably recorded termination the receipt is redundant. */
export function discardNativeWitness(dir: string, identity: NamespaceIdentity): void {
	try {
		unlinkSync(join(dir, receiptName(identity)));
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
	}
}
