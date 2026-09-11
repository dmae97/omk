import { captureNamespaceIdentity, type NamespaceIdentity } from "./namespace-identity.ts";
import { VerifiedRunError } from "./storage.ts";

export const PROCESS_GATE_ARGV = [
	"/bin/sh",
	"-c",
	'IFS= read -r gate && [ "$gate" = go ] && exec "$@"',
	"omk-process-gate",
] as const;

/** This JSON comes only from bwrap's private info FD, before any candidate code is released. */
export function identityFromSandboxInfo(bytes: string): NamespaceIdentity {
	let info: unknown;
	try {
		info = JSON.parse(bytes);
	} catch {
		throw new VerifiedRunError("process_identity");
	}
	if (
		typeof info !== "object" ||
		info === null ||
		!("child-pid" in info) ||
		typeof info["child-pid"] !== "number" ||
		!("pid-namespace" in info) ||
		typeof info["pid-namespace"] !== "number" ||
		!Number.isSafeInteger(info["pid-namespace"])
	)
		throw new VerifiedRunError("process_identity");
	const identity = captureNamespaceIdentity(info["child-pid"]);
	if (identity.namespace !== `pid:[${info["pid-namespace"]}]`) throw new VerifiedRunError("process_identity");
	return identity;
}
