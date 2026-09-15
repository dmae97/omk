import { type NamespaceIdentity, probeNamespace } from "../src/core/verified-run/namespace-identity.ts";

/**
 * Poll until `identity` reports `gone`, or the budget expires.
 *
 * A resolved execution promise means the broker observed the child's streams
 * close — not that Linux has finished tearing the PID namespace down.
 * `probeNamespace` only reports `gone` once the sandbox init is a zombie or
 * reaped, so asserting it at the instant of resolution races OS teardown and
 * intermittently observes `alive` under CI process contention.
 *
 * Production already fail-closes on an identity that is not yet `gone` (see
 * `work-recovery.ts`, which refuses recovery admission), so bounding the wait
 * keeps the assertion strict — the namespace must still become `gone` — without
 * requiring teardown to win a scheduler race.
 */
export async function waitForNamespaceGone(
	identity: NamespaceIdentity,
	timeoutMs = 5000,
): Promise<"alive" | "gone" | "unknown"> {
	const deadline = performance.now() + timeoutMs;
	let result = probeNamespace(identity);
	while (result !== "gone" && performance.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 10));
		result = probeNamespace(identity);
	}
	return result;
}
